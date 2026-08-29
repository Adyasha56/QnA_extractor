import { randomUUID } from "crypto";
import { OcrPage, Answer, AnswerRegion, BoundingBox, OcrElement } from "../models/extraction";
import { VisionProvider } from "../clients/visionProvider";
import { unionBbox, stripQuestionPrefix } from "./questionExtractor";

// ─── Patterns ────────────────────────────────────────────────────────────────

// Same sub-label set as question extractor.
const SUB_LABEL = String.raw`[a-z]|i{1,3}|iv|v|vi{1,3}|vii|viii|ix|x{1,2}|xi|xii`;

// Optional "Q", "Q.", "Question" prefix — students commonly label answers "Q1", "Q3(a)".
const Q_PREFIX = String.raw`(?:[Qq](?:uestion\s*)?\.?\s*)?`;

// Lines that open a new answer section (student writes the question number).
const SECTION_PATTERNS: Array<{
  re: RegExp;
  buildNumber: (m: RegExpMatchArray) => string;
}> = [
  // "3(a)." | "3(a): " | "3(a) " | "3(a)" | "Q3(a):" (standalone on its own line)
  {
    re: new RegExp(String.raw`^${Q_PREFIX}(\d+)\s*\(\s*(${SUB_LABEL})\s*\)(?:\s*[.:\s]|$)`, "i"),
    buildNumber: (m) => `${m[1]}(${m[2].toLowerCase()})`,
  },
  {
    re: new RegExp(String.raw`^${Q_PREFIX}(\d+)\s*[.:)]\s*\(\s*(${SUB_LABEL})\s*\)`, "i"),
    buildNumber: (m) => `${m[1]}(${m[2].toLowerCase()})`,
  },
  {
    re: new RegExp(String.raw`^${Q_PREFIX}(\d+)\s+\(\s*(${SUB_LABEL})\s*\)`, "i"),
    buildNumber: (m) => `${m[1]}(${m[2].toLowerCase()})`,
  },
  // "1." | "1: " | "Q1." | "Question 1:" | standalone "1."
  {
    re: new RegExp(String.raw`^${Q_PREFIX}(\d+)\s*[.:)]\s*`),
    buildNumber: (m) => m[1],
  },
];

// "Ans:", "Ans:-", "Ans." etc. — signals start of the actual answer text.
const ANS_PREFIX_RE = /^[Aa]ns(?:wer)?\s*[-:.]+\s*/;

type RawLine = {
  text: string;
  pageNumber: number;
  bbox: BoundingBox;
};

export type AnswerExtractionOptions = {
  visionProvider?: VisionProvider;
  imageUrl?: string;
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp";
};

// ─── Public API ──────────────────────────────────────────────────────────────

export async function extractAnswers(
  pages: OcrPage[],
  options: AnswerExtractionOptions = {}
): Promise<Answer[]> {
  // Gemini is the authoritative source for handwritten answer extraction.
  // Tesseract OCR is unreliable for handwriting and must not override AI results.
  // If AI is available, attempt it first. Any AI failure falls through to
  // local Tesseract parsing so the pipeline never crashes.
  if (options.visionProvider && (options.imageUrl || options.imageBase64)) {
    try {
      return await extractAnswersWithAI(options.visionProvider, options, pages);
    } catch {
      // AI failed (network error, timeout, malformed response, etc.).
      // Fall back to Tesseract deterministic parsing.
    }
  }

  const lines = reconstructLines(pages);
  return parseAnswersFromLines(lines);
}

// ─── Line reconstruction (identical strategy to question extractor) ───────────

function reconstructLines(pages: OcrPage[]): RawLine[] {
  const lines: RawLine[] = [];

  for (const page of pages) {
    const sorted = [...page.elements].sort((a, b) => {
      const dy = a.bbox.y - b.bbox.y;
      return Math.abs(dy) < 10 ? a.bbox.x - b.bbox.x : dy;
    });

    const groups: OcrElement[][] = [];
    for (const el of sorted) {
      const last = groups[groups.length - 1];
      const refY = last?.[0]?.bbox.y ?? -Infinity;
      if (last && Math.abs(el.bbox.y - refY) < 10) {
        last.push(el);
      } else {
        groups.push([el]);
      }
    }

    for (const group of groups) {
      const text = group.map((e) => e.text).join(" ").trim();
      if (!text) continue;
      lines.push({
        text,
        pageNumber: page.pageNumber,
        bbox: unionBbox(group.map((e) => e.bbox)),
      });
    }
  }

  return lines;
}

// ─── Deterministic parser ────────────────────────────────────────────────────

function parseAnswersFromLines(lines: RawLine[]): Answer[] {
  // Locate section boundaries: lines that begin with a question number.
  type Section = { lineIndex: number; number: string };
  const sections: Section[] = [];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, buildNumber } of SECTION_PATTERNS) {
      const m = lines[i].text.match(re);
      if (m) {
        sections.push({ lineIndex: i, number: buildNumber(m) });
        break;
      }
    }
  }

  if (sections.length === 0) return [];

  const answers: Answer[] = [];

  for (let si = 0; si < sections.length; si++) {
    const { lineIndex, number } = sections[si];
    const nextSectionIndex =
      si + 1 < sections.length ? sections[si + 1].lineIndex : lines.length;

    // All lines in this section: [questionLabel line, ...content lines]
    const sectionLines = lines.slice(lineIndex, nextSectionIndex);

    // Skip the question-label line (index 0) — student restatement, not the answer.
    let contentLines = sectionLines.slice(1);

    // If an "Ans:" prefix line exists, start from there.
    const ansIdx = contentLines.findIndex((l) => ANS_PREFIX_RE.test(l.text));
    if (ansIdx >= 0) {
      const ansLine = contentLines[ansIdx];
      const afterPrefix = ansLine.text.replace(ANS_PREFIX_RE, "").trim();
      contentLines = [
        ...(afterPrefix ? [{ ...ansLine, text: afterPrefix }] : []),
        ...contentLines.slice(ansIdx + 1),
      ];
    }

    // Filter noise (single chars, horizontal rules, etc.)
    const meaningful = contentLines.filter((l) => l.text.trim().length > 2);

    const text = meaningful.map((l) => l.text).join(" ").trim();

    const regions: AnswerRegion[] = meaningful.map((l) => ({
      page: l.pageNumber,
      bbox: l.bbox,
      text: l.text,
    }));

    answers.push({
      id: `answer_${randomUUID().slice(0, 8)}`,
      text,
      detectedQuestionNumber: number,
      regions,
    });
  }

  return answers;
}

// ─── AI-assisted extraction ──────────────────────────────────────────────────

const ANSWER_EXTRACTION_PROMPT = `You are analysing a scanned student answer sheet.
Extract every answer block.

Return ONLY a JSON array — no explanations, no markdown fences:
[
  {"questionNumber": "1", "answerText": "A variable is a named memory location..."},
  {"questionNumber": "3(a)", "answerText": "An operating system manages..."},
  {"questionNumber": "5", "answerText": null}
]

Rules:
- Include ALL questions visible on the sheet, even if answers are out of order.
- Set answerText to null when the answer is blank or missing.
- Preserve exact handwritten question numbers including sub-parts like "3(a)", "3(b)".
- Return ONLY the bare number/label — strip any leading "Q", "Q.", or "Question" prefix.
  E.g. a sheet labeled "Q1", "Q.1", or "Question 1" must be returned as "1", not "Q1".
  Likewise "Q3(a)" must be returned as "3(a)".
- Do NOT invent question numbers.
- Output ONLY the JSON array.`;

async function extractAnswersWithAI(
  provider: VisionProvider,
  options: AnswerExtractionOptions,
  pages: OcrPage[]
): Promise<Answer[]> {
  const image =
    options.imageBase64
      ? {
          type: "base64" as const,
          data: options.imageBase64,
          mediaType: options.imageMediaType ?? ("image/png" as const),
        }
      : { type: "url" as const, url: options.imageUrl! };

  const raw = await provider.analyze({ image, prompt: ANSWER_EXTRACTION_PROMPT });
  return validateAndBuildAnswers(raw);
}

type RawAIAnswer = { questionNumber: unknown; answerText: unknown };

/**
 * Normalize raw answer text: strip a bare "Ans:", "Ans:-" etc. prefix that
 * Gemini may return as the entire answerText for effectively-blank answers.
 * The deterministic path already strips this prefix via ANS_PREFIX_RE.
 */
function normalizeAnswerText(raw: string): string {
  return raw.replace(/^ans(?:wer)?\s*[-:.]+\s*/i, "").trim();
}

function validateAndBuildAnswers(raw: unknown): Answer[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      "Vision provider returned invalid structure: expected a JSON array."
    );
  }

  const answers: Answer[] = [];

  for (const item of raw) {
    const entry = item as RawAIAnswer;

    if (typeof entry?.questionNumber !== "string") continue;
    const number = stripQuestionPrefix(entry.questionNumber);
    if (!number) continue;

    const rawText =
      typeof entry.answerText === "string" ? entry.answerText.trim() : "";
    const text = normalizeAnswerText(rawText);

    // AI does not supply bounding boxes; regions is empty.
    // Spatial data must come from the Python service (Phase 8 localization).
    answers.push({
      id: `answer_${randomUUID().slice(0, 8)}`,
      text,
      detectedQuestionNumber: number,
      regions: [],
    });
  }

  return answers;
}
