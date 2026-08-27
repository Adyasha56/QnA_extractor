/**
 * Experimental benchmark: ask Gemini to locate handwritten answer blocks
 * and return bounding-box coordinates.
 *
 * COORDINATE SYSTEM
 * -----------------
 * Gemini is instructed to return pixel coordinates measured from the
 * top-left corner of the page image supplied (x increases rightward,
 * y increases downward). These coordinates are specific to the image
 * resolution passed in and are NOT the same as the Python OCR service's
 * PDF-point coordinates. Do not mix the two systems.
 *
 * This module is self-contained and experimental — it does NOT modify the
 * production extraction or mapping pipeline.
 */

import { VisionProvider, VisionImageSource } from "../clients/visionProvider";
import { RenderedPage } from "../clients/pythonClient";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single answer block as reported by Gemini with spatial coordinates.
 * bbox is null when Gemini could not locate the block in the image.
 */
export type GeminiAnswerRegion = {
  detectedQuestionNumber: string;
  text: string;
  /** Pixel coordinates in the supplied page image (top-left origin).
   *  null when Gemini omitted or returned an unusable bbox. */
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

export type GeminiRegionBenchmarkResult = {
  /** Gemini's raw parsed JSON — kept as-is for inspection. */
  rawResponse: unknown;
  /** Validated and normalised answer regions. */
  regions: GeminiAnswerRegion[];
  /** Number of items Gemini returned that failed bbox validation. */
  malformedCount: number;
};

// ─── Prompt ──────────────────────────────────────────────────────────────────

/**
 * Gemini is instructed to return pixel coordinates measured from the
 * top-left corner of the supplied image. x=0,y=0 is the top-left pixel.
 * Width and height are the bounding box dimensions in pixels.
 */
const REGION_PROMPT = `You are analysing a scanned student answer sheet (page image).

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
- "detectedQuestionNumber" — the question number as handwritten by the student (e.g. "1", "3(a)").
- "text" — the full transcribed handwritten text of the answer.
- "bbox" — pixel coordinates in this image (top-left origin, x rightward, y downward).
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
  const questionNumber = entry.detectedQuestionNumber.trim();
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
      // Gemini supplied a bbox object but the numbers are invalid.
      malformed.count += 1;
    }
  }
  // entry.bbox === null → bbox stays null, not counted as malformed.

  return { detectedQuestionNumber: questionNumber, text, bbox };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ask Gemini to locate handwritten answer blocks on a single page image and
 * return their bounding boxes for benchmarking.
 *
 * Throws if the vision provider call fails (network error, timeout, etc.).
 * Does NOT fall back to any deterministic extractor.
 *
 * @param provider  An initialised VisionProvider (typically GeminiVisionClient).
 * @param image     The page image to analyse (URL or base64 PNG/JPEG/WEBP).
 */
export async function benchmarkGeminiRegions(
  provider: VisionProvider,
  image: VisionImageSource
): Promise<GeminiRegionBenchmarkResult> {
  const rawResponse = await provider.analyze({ image, prompt: REGION_PROMPT });

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

// ─── Phase 7C: rendered-page benchmark ──────────────────────────────────────
//
// Gemini receives actual rendered PNG bytes (not raw PDF). Pixel coordinates
// returned by Gemini are converted to PDF-point coordinates using the exact
// dimensions reported by the Python render service for each page.
//
// Conversion (requirement §10, no hard-coded dimensions):
//   pdfX      = pixelX      * (pdfWidth  / imageWidth)
//   pdfY      = pixelY      * (pdfHeight / imageHeight)
//   pdfW      = pixelWidth  * (pdfWidth  / imageWidth)
//   pdfH      = pixelHeight * (pdfHeight / imageHeight)

// ─── Types ────────────────────────────────────────────────────────────────────

export type PdfPointBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** One answer region as returned by Gemini for a rendered page, with both
 *  the original pixel bbox (for debugging) and the converted PDF-point bbox. */
export type GeminiRegionWithConversion = {
  detectedQuestionNumber: string;
  text: string;
  /**
   * Gemini's raw pixel bbox, preserved for debugging.
   * null only when bbox values are non-finite (cannot be represented).
   * Present even for geometrically invalid bboxes (out-of-bounds, negative),
   * so the caller can inspect what Gemini actually returned.
   */
  pixelBbox: { x: number; y: number; width: number; height: number } | null;
  /**
   * Pixel bbox converted to PDF points using the actual page dimensions.
   * null when pixelBbox is null or fails geometric validation.
   */
  pdfBbox: PdfPointBbox | null;
};

/** Benchmark result for one rendered page. */
export type RenderedPageBenchmarkResult = {
  pageNumber: number;
  pdfWidth: number;
  pdfHeight: number;
  imageWidth: number;
  imageHeight: number;
  regions: GeminiRegionWithConversion[];
  /** Gemini items on this page that failed bbox validation. */
  malformedCount: number;
};

/** Overall benchmark result across all pages. */
export type RenderedBenchmarkResult = {
  pages: RenderedPageBenchmarkResult[];
  totalMalformed: number;
};

// ─── Coordinate conversion ────────────────────────────────────────────────────

/**
 * Convert a pixel-space bounding box to PDF-point space using the actual
 * page dimensions. No dimensions are hard-coded.
 *
 * @param pixelBbox  Bbox in the rendered image's pixel coordinate system.
 * @param pdfWidth   Page width in PDF points  (from Python RenderedPage).
 * @param pdfHeight  Page height in PDF points (from Python RenderedPage).
 * @param imageWidth  Rendered image width in pixels.
 * @param imageHeight Rendered image height in pixels.
 */
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

type RawBbox = { x: unknown; y: unknown; width: unknown; height: unknown };

/**
 * Validate a raw bbox object against both numeric and geometric constraints.
 *
 * Returns the parsed pixel bbox when all checks pass, null otherwise.
 * If the numbers are finite but geometrically invalid the caller still
 * receives them via the separate pixelBbox field.
 */
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
    // Gemini explicitly set bbox null — accepted, not malformed.
    return { pixelBbox: null, valid: false };
  }

  const b = raw as RawBbox;

  if (
    !isFiniteNumber(b.x) ||
    !isFiniteNumber(b.y) ||
    !isFiniteNumber(b.width) ||
    !isFiniteNumber(b.height)
  ) {
    malformed.count += 1;
    return { pixelBbox: null, valid: false };
  }

  // Numbers are finite — capture for debugging regardless of geometry.
  const pixelBbox = { x: b.x, y: b.y, width: b.width, height: b.height };

  if (b.x < 0 || b.y < 0) {
    malformed.count += 1;
    return { pixelBbox, valid: false };
  }

  if (b.width <= 0 || b.height <= 0) {
    malformed.count += 1;
    return { pixelBbox, valid: false };
  }

  if (b.x + b.width > imageWidth || b.y + b.height > imageHeight) {
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
  const questionNumber = entry.detectedQuestionNumber.trim();
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

/**
 * Run the Gemini region benchmark on pre-rendered PDF page images.
 *
 * For each RenderedPage (from Python /render-pages):
 * 1. Sends the PNG base64 image to Gemini via the VisionProvider.
 * 2. Validates Gemini's pixel bbox values (finite, non-negative, in-bounds).
 * 3. Converts valid pixel bboxes to PDF-point coordinates using the actual
 *    page dimensions — no dimensions are hard-coded.
 *
 * Throws if the provider call fails for any page (network error, timeout, etc.).
 * Does NOT modify the production answer extraction or mapping pipeline.
 *
 * @param provider       An initialised VisionProvider (GeminiVisionClient).
 * @param renderedPages  Pages from the Python /render-pages endpoint.
 */
export async function benchmarkGeminiRegionsFromRenderedPages(
  provider: VisionProvider,
  renderedPages: RenderedPage[]
): Promise<RenderedBenchmarkResult> {
  const pages: RenderedPageBenchmarkResult[] = [];
  let totalMalformed = 0;

  for (const rendered of renderedPages) {
    const image: VisionImageSource = {
      type: "base64",
      data: rendered.imageBase64,
      mediaType: "image/png",
    };

    const rawResponse = await provider.analyze({ image, prompt: REGION_PROMPT });

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
