import { OcrPage, Question, BoundingBox, OcrElement } from "../models/extraction";
import { VisionProvider } from "../clients/visionProvider";

// ─── Question-number patterns ────────────────────────────────────────────────
//
// Checked in order; the first match wins.
// Sub-part patterns MUST come before the simple-number pattern so that
// "3(a)." is not parsed as question "3" with text "(a)...".
//
// Supported sub-part labels: a-z, roman numerals i–xii.

const SUB_LABEL = String.raw`[a-z]|i{1,3}|iv|v|vi{1,3}|vii|viii|ix|x{1,2}|xi|xii`;

const QUESTION_PATTERNS: Array<{
  re: RegExp;
  buildNumber: (m: RegExpMatchArray) => string;
}> = [
  // "3(a)." | "3(a):" | "3(a) "  — sub-part immediately after number
  {
    re: new RegExp(
      String.raw`^(\d+)\s*\(\s*(${SUB_LABEL})\s*\)\s*[.:\s]`,
      "i"
    ),
    buildNumber: (m) => `${m[1]}(${m[2].toLowerCase()})`,
  },
  // "3. (a)" | "3: (a)"  — separator between number and sub-part
  {
    re: new RegExp(
      String.raw`^(\d+)\s*[.:)]\s*\(\s*(${SUB_LABEL})\s*\)`,
      "i"
    ),
    buildNumber: (m) => `${m[1]}(${m[2].toLowerCase()})`,
  },
  // "3 (a)"  — space only between number and sub-part
  {
    re: new RegExp(
      String.raw`^(\d+)\s+\(\s*(${SUB_LABEL})\s*\)`,
      "i"
    ),
    buildNumber: (m) => `${m[1]}(${m[2].toLowerCase()})`,
  },
  // "1."  | "1)"  | "1:" | "Q1." | "Question 1:"
  {
    re: /^(?:[Qq](?:uestion\s*)?\.?\s*)?(\d+)\s*[.:)]\s+/,
    buildNumber: (m) => m[1],
  },
];

type RawLine = {
  text: string;
  pageNumber: number;
  bbox: BoundingBox;
};

export type QuestionExtractionOptions = {
  visionProvider?: VisionProvider;
  /** Public URL of the document image for AI-assisted extraction. */
  imageUrl?: string;
  /** base64 image data (alternative to imageUrl). */
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp";
};

// ─── Public API ──────────────────────────────────────────────────────────────

export async function extractQuestions(
  pages: OcrPage[],
  options: QuestionExtractionOptions = {}
): Promise<Question[]> {
  // 1. Try deterministic extraction from OCR elements.
  const lines = reconstructLines(pages);
  const deterministic = parseQuestionsFromLines(lines);

  if (deterministic.length > 0) {
    return deterministic;
  }

  // 2. Deterministic found nothing — attempt AI if a provider is configured.
  if (options.visionProvider && (options.imageUrl || options.imageBase64)) {
    return extractQuestionsWithAI(options.visionProvider, options);
  }

  return [];
}

// ─── Line reconstruction ─────────────────────────────────────────────────────

/**
 * Group individual OCR elements into visual lines (same Y-band), preserving
 * page number. Elements within 10 pts vertically are considered co-linear.
 */
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

function parseQuestionsFromLines(lines: RawLine[]): Question[] {
  // First pass: locate every line that begins a question.
  type QuestionStart = { lineIndex: number; number: string; prefixLen: number };
  const starts: QuestionStart[] = [];

  for (let i = 0; i < lines.length; i++) {
    const result = matchQuestionLine(lines[i].text);
    if (result) {
      starts.push({ lineIndex: i, number: result.number, prefixLen: result.prefix.length });
    }
  }

  if (starts.length === 0) return [];

  // Second pass: extract text + bbox for each question.
  const questions: Question[] = [];

  for (let qi = 0; qi < starts.length; qi++) {
    const { lineIndex, number, prefixLen } = starts[qi];
    const nextLineIndex =
      qi + 1 < starts.length ? starts[qi + 1].lineIndex : lines.length;

    const questionLines = lines.slice(lineIndex, nextLineIndex);
    const firstLineText = questionLines[0].text.slice(prefixLen).trim();
    const continuationText = questionLines
      .slice(1)
      .map((l) => l.text)
      .join(" ")
      .trim();
    const text = [firstLineText, continuationText].filter(Boolean).join(" ");

    questions.push({
      id: numberToId(number),
      number,
      text,
      order: qi + 1,
      sourcePage: questionLines[0].pageNumber,
      bbox: unionBbox(questionLines.map((l) => l.bbox)),
    });
  }

  return questions;
}

function matchQuestionLine(
  text: string
): { number: string; prefix: string } | null {
  for (const { re, buildNumber } of QUESTION_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return { number: buildNumber(m), prefix: m[0] };
    }
  }
  return null;
}

// ─── AI-assisted extraction ──────────────────────────────────────────────────

const QUESTION_EXTRACTION_PROMPT = `You are analysing a scanned question paper.
Extract every question with its exact printed number.

Return ONLY a JSON array — no explanations, no markdown fences:
[
  {"number": "1", "text": "What is a variable in programming?"},
  {"number": "3(a)", "text": "What is an operating system?"},
  {"number": "3(b)", "text": "Give two examples."}
]

Rules:
- Preserve exact numbering including sub-parts such as "3(a)", "3(b)", "12(i)", "12(ii)".
- Treat every sub-part as a separate entry.
- Do NOT include answers or the title.
- Output ONLY the JSON array.`;

async function extractQuestionsWithAI(
  provider: VisionProvider,
  options: QuestionExtractionOptions
): Promise<Question[]> {
  const image =
    options.imageBase64
      ? {
          type: "base64" as const,
          data: options.imageBase64,
          mediaType: options.imageMediaType ?? ("image/png" as const),
        }
      : { type: "url" as const, url: options.imageUrl! };

  const raw = await provider.analyze({ image, prompt: QUESTION_EXTRACTION_PROMPT });
  return validateAndBuildQuestions(raw);
}

type RawAIQuestion = { number: unknown; text: unknown };

function validateAndBuildQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) {
    throw new Error("Vision provider returned invalid structure: expected a JSON array.");
  }

  const questions: Question[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as RawAIQuestion;
    if (typeof item?.number !== "string" || typeof item?.text !== "string") {
      continue; // skip malformed entries rather than failing entirely
    }
    const number = item.number.trim();
    const text = item.text.trim();
    if (!number) continue;

    questions.push({
      id: numberToId(number),
      number,
      text,
      order: i + 1,
      sourcePage: 1, // page not available from AI; caller may enrich later
      // bbox intentionally absent — AI does not provide reliable coordinates
    });
  }

  return questions;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function unionBbox(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function numberToId(number: string): string {
  return "q_" + number.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
}
