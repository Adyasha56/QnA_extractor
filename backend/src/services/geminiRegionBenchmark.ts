// Locates handwritten answer blocks via Gemini and returns bounding boxes.
//
// Gemini does not reliably honor a request for literal pixel coordinates —
// it sometimes reverts to its own internal normalized grid. Asking instead
// for coordinates as fractions of image width/height in [0,1], then
// converting to real pixel space in code, is the pattern that holds up
// call-to-call. These pixel coordinates are separate from the Python OCR
// service's PDF-point coordinates — the two are not interchangeable.
//
// benchmarkGeminiRegionsFromRenderedPages() below is used by the production
// pipeline (answerLocalizationService.ts); benchmarkGeminiRegions() is not.

import { VisionProvider, VisionImageSource } from "../clients/visionProvider";
import { RenderedPage } from "../clients/pythonClient";
import { stripQuestionPrefix } from "./questionExtractor";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeminiAnswerRegion = {
  detectedQuestionNumber: string;
  text: string;
  /** Pixel coordinates, top-left origin. Null when Gemini couldn't locate it. */
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

export type GeminiRegionBenchmarkResult = {
  rawResponse: unknown;
  regions: GeminiAnswerRegion[];
  malformedCount: number;
};

// ─── Prompt ──────────────────────────────────────────────────────────────────

// Real dimensions are stated as context only — the model still answers in
// fractions, converted to pixels afterward (see the module comment above).
function buildRegionPrompt(imageWidth: number, imageHeight: number): string {
  return `You are analysing a scanned student answer sheet (page image).
This image is ${imageWidth} pixels wide and ${imageHeight} pixels tall.

For every handwritten answer block you can see, return a JSON array with this exact shape — no explanations, no markdown fences:
[
  {
    "detectedQuestionNumber": "1",
    "text": "A variable is a named storage location...",
    "bbox": { "x": 0.12, "y": 0.34, "w": 0.48, "h": 0.09 }
  },
  {
    "detectedQuestionNumber": "3(a)",
    "text": "An operating system manages hardware...",
    "bbox": { "x": 0.12, "y": 0.46, "w": 0.48, "h": 0.075 }
  }
]

Rules:
- "detectedQuestionNumber" — the bare question number/label (e.g. "1", "3(a)").
  Strip any leading "Q", "Q.", or "Question" prefix — e.g. "Q1" or "Question 1"
  on the page must be returned as "1", not "Q1". This must exactly match how
  a separate extraction pass labels the same answer, so consistency matters.
- "text" — the full transcribed handwritten text of the answer.
- "bbox" — coordinates as FRACTIONS of this image's width/height, each in
  [0, 1], top-left origin (0,0), bottom-right (1,1) — regardless of the
  actual pixel dimensions stated above.
  x, y = top-left corner of the answer block, as a fraction.
  w, h = width/height of the block, also as a fraction.
  If you cannot locate the bounding box, set "bbox" to null.
- Include ALL visible answer blocks, even blank ones.
- Output ONLY the JSON array.`;
}

// Used only by the unused experimental benchmarkGeminiRegions() path below,
// where the image's real pixel dimensions aren't known ahead of time.
const GENERIC_REGION_PROMPT = `You are analysing a scanned student answer sheet (page image).

For every handwritten answer block you can see, return a JSON array with this exact shape — no explanations, no markdown fences:
[
  {
    "detectedQuestionNumber": "1",
    "text": "A variable is a named storage location...",
    "bbox": { "x": 120, "y": 340, "width": 980, "height": 210 }
  },
  {
    "detectedQuestionNumber": "3(a)",
    "text": "An operating system manages hardware...",
    "bbox": { "x": 120, "y": 560, "width": 980, "height": 175 }
  }
]

Rules:
- "detectedQuestionNumber" — the bare question number/label (e.g. "1", "3(a)").
  Strip any leading "Q", "Q.", or "Question" prefix — e.g. "Q1" or "Question 1"
  on the page must be returned as "1", not "Q1".
- "text" — the full transcribed handwritten text of the answer.
- "bbox" — REAL PIXEL coordinates within this image's own actual pixel
  dimensions (top-left origin, x rightward, y downward). Do NOT use a
  normalized 0-1000 scale or any fixed canvas size — measure against this
  specific image's real width and height.
  x, y = top-left corner of the answer block.
  width, height = extent of the block in pixels.
  If you cannot locate the bounding box, set "bbox" to null.
- Include ALL visible answer blocks, even blank ones.
- Output ONLY the JSON array.`;

// ─── Validation ───────────────────────────────────────────────────────────────

type RawItem = {
  detectedQuestionNumber?: unknown;
  text?: unknown;
  bbox?: unknown;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseRawItem(
  item: unknown,
  malformed: { count: number }
): GeminiAnswerRegion | null {
  const entry = item as RawItem;

  if (typeof entry?.detectedQuestionNumber !== "string") return null;
  const questionNumber = stripQuestionPrefix(entry.detectedQuestionNumber);
  if (!questionNumber) return null;

  const text = typeof entry.text === "string" ? entry.text.trim() : "";

  let bbox: GeminiAnswerRegion["bbox"] = null;

  if (entry.bbox !== null && entry.bbox !== undefined) {
    const b = entry.bbox as Record<string, unknown>;
    if (
      isFiniteNumber(b.x) &&
      isFiniteNumber(b.y) &&
      isFiniteNumber(b.width) &&
      isFiniteNumber(b.height)
    ) {
      bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
    } else {
      malformed.count += 1;
    }
  }

  return { detectedQuestionNumber: questionNumber, text, bbox };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function benchmarkGeminiRegions(
  provider: VisionProvider,
  image: VisionImageSource
): Promise<GeminiRegionBenchmarkResult> {
  const rawResponse = await provider.analyze({ image, prompt: GENERIC_REGION_PROMPT });

  if (!Array.isArray(rawResponse)) {
    throw new Error(
      "Gemini region benchmark: expected a JSON array but received: " +
        JSON.stringify(rawResponse).slice(0, 200)
    );
  }

  const malformed = { count: 0 };
  const regions: GeminiAnswerRegion[] = [];

  for (const item of rawResponse) {
    const region = parseRawItem(item, malformed);
    if (region) regions.push(region);
  }

  return { rawResponse, regions, malformedCount: malformed.count };
}

// ─── Rendered-page benchmark ─────────────────────────────────────────────────
//
// Gemini receives actual rendered PNG bytes. Its pixel coordinates are then
// converted to PDF-point coordinates using the exact dimensions the Python
// render service reported for that page:
//   pdfX = pixelX * (pdfWidth / imageWidth), and similarly for y/width/height.

export type PdfPointBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GeminiRegionWithConversion = {
  detectedQuestionNumber: string;
  text: string;
  /** Gemini's raw pixel bbox, kept even when geometrically invalid, for debugging. */
  pixelBbox: { x: number; y: number; width: number; height: number } | null;
  /** pixelBbox converted to PDF points. Null when pixelBbox is null/invalid. */
  pdfBbox: PdfPointBbox | null;
};

export type RenderedPageBenchmarkResult = {
  pageNumber: number;
  pdfWidth: number;
  pdfHeight: number;
  imageWidth: number;
  imageHeight: number;
  regions: GeminiRegionWithConversion[];
  malformedCount: number;
};

export type RenderedBenchmarkResult = {
  pages: RenderedPageBenchmarkResult[];
  totalMalformed: number;
};

// ─── Coordinate conversion ────────────────────────────────────────────────────

export function convertPixelToPdfBbox(
  pixelBbox: { x: number; y: number; width: number; height: number },
  pdfWidth: number,
  pdfHeight: number,
  imageWidth: number,
  imageHeight: number
): PdfPointBbox {
  const scaleX = pdfWidth / imageWidth;
  const scaleY = pdfHeight / imageHeight;
  return {
    x: pixelBbox.x * scaleX,
    y: pixelBbox.y * scaleY,
    width: pixelBbox.width * scaleX,
    height: pixelBbox.height * scaleY,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

// Matches buildRegionPrompt's shape: fractions in [0,1] under "w"/"h", kept
// distinct from the pixel bbox's "width"/"height" so a mix-up is obvious.
type RawFractionalBbox = { x: unknown; y: unknown; w: unknown; h: unknown };

function parseRenderedBbox(
  raw: unknown,
  imageWidth: number,
  imageHeight: number,
  malformed: { count: number }
): {
  pixelBbox: { x: number; y: number; width: number; height: number } | null;
  valid: boolean;
} {
  if (raw === null || raw === undefined) {
    return { pixelBbox: null, valid: false };
  }

  const b = raw as RawFractionalBbox;

  if (
    !isFiniteNumber(b.x) ||
    !isFiniteNumber(b.y) ||
    !isFiniteNumber(b.w) ||
    !isFiniteNumber(b.h)
  ) {
    malformed.count += 1;
    return { pixelBbox: null, valid: false };
  }

  const pixelBbox = {
    x: b.x * imageWidth,
    y: b.y * imageHeight,
    width: b.w * imageWidth,
    height: b.h * imageHeight,
  };

  if (pixelBbox.x < 0 || pixelBbox.y < 0) {
    malformed.count += 1;
    return { pixelBbox, valid: false };
  }

  if (pixelBbox.width <= 0 || pixelBbox.height <= 0) {
    malformed.count += 1;
    return { pixelBbox, valid: false };
  }

  if (pixelBbox.x + pixelBbox.width > imageWidth || pixelBbox.y + pixelBbox.height > imageHeight) {
    malformed.count += 1;
    return { pixelBbox, valid: false };
  }

  return { pixelBbox, valid: true };
}

function parseRenderedItem(
  item: unknown,
  imageWidth: number,
  imageHeight: number,
  pdfWidth: number,
  pdfHeight: number,
  malformed: { count: number }
): GeminiRegionWithConversion | null {
  const entry = item as RawItem;

  if (typeof entry?.detectedQuestionNumber !== "string") return null;
  const questionNumber = stripQuestionPrefix(entry.detectedQuestionNumber);
  if (!questionNumber) return null;

  const text = typeof entry.text === "string" ? entry.text.trim() : "";

  const { pixelBbox, valid } = parseRenderedBbox(
    entry.bbox,
    imageWidth,
    imageHeight,
    malformed
  );

  const pdfBbox =
    valid && pixelBbox !== null
      ? convertPixelToPdfBbox(pixelBbox, pdfWidth, pdfHeight, imageWidth, imageHeight)
      : null;

  return { detectedQuestionNumber: questionNumber, text, pixelBbox, pdfBbox };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function benchmarkGeminiRegionsFromRenderedPages(
  provider: VisionProvider,
  renderedPages: RenderedPage[],
  mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png"
): Promise<RenderedBenchmarkResult> {
  const pages: RenderedPageBenchmarkResult[] = [];
  let totalMalformed = 0;

  for (const rendered of renderedPages) {
    const image: VisionImageSource = {
      type: "base64",
      data: rendered.imageBase64,
      mediaType,
    };

    const rawResponse = await provider.analyze({
      image,
      prompt: buildRegionPrompt(rendered.imageWidth, rendered.imageHeight),
    });

    if (!Array.isArray(rawResponse)) {
      throw new Error(
        `Gemini region benchmark (page ${rendered.pageNumber}): expected a JSON array but received: ` +
          JSON.stringify(rawResponse).slice(0, 200)
      );
    }

    const malformed = { count: 0 };
    const regions: GeminiRegionWithConversion[] = [];

    for (const item of rawResponse) {
      const region = parseRenderedItem(
        item,
        rendered.imageWidth,
        rendered.imageHeight,
        rendered.pdfWidth,
        rendered.pdfHeight,
        malformed
      );
      if (region) regions.push(region);
    }

    totalMalformed += malformed.count;

    pages.push({
      pageNumber: rendered.pageNumber,
      pdfWidth: rendered.pdfWidth,
      pdfHeight: rendered.pdfHeight,
      imageWidth: rendered.imageWidth,
      imageHeight: rendered.imageHeight,
      regions,
      malformedCount: malformed.count,
    });
  }

  return { pages, totalMalformed };
}
