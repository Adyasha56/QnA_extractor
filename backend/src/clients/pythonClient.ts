import { OcrPage } from "../models/extraction";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

// 2-minute ceiling — large PDFs with Tesseract OCR can be slow.
const REQUEST_TIMEOUT_MS = 120_000;

// ─── Error type ───────────────────────────────────────────────────────────────

export class PythonClientError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "PythonClientError";
  }
}

// ─── Rendered-page types ──────────────────────────────────────────────────────

/** One PDF page rendered to PNG at the Python service's fixed scale. */
export type RenderedPage = {
  pageNumber: number;
  /** Page width in PDF points (from PyMuPDF page.rect.width). */
  pdfWidth: number;
  /** Page height in PDF points (from PyMuPDF page.rect.height). */
  pdfHeight: number;
  /** Rendered image width in pixels (pdfWidth × render scale). */
  imageWidth: number;
  /** Rendered image height in pixels (pdfHeight × render scale). */
  imageHeight: number;
  /** Base64-encoded PNG bytes — no disk writes, no file references. */
  imageBase64: string;
};

// ─── Shared HTTP helper ───────────────────────────────────────────────────────

async function pythonPost<T>(
  path: string,
  body: Record<string, unknown>,
  validateFn: (data: unknown) => data is T,
  errorLabel: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${PYTHON_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const msg = isTimeout
      ? "Python service request timed out"
      : `Python service unreachable: ${err instanceof Error ? err.message : String(err)}`;
    throw new PythonClientError(msg, 502);
  }

  clearTimeout(timer);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PythonClientError(
      `Python service returned HTTP ${response.status}: ${text}`,
      502
    );
  }

  const data: unknown = await response.json();

  if (!validateFn(data)) {
    throw new PythonClientError(
      `Python service ${errorLabel} response has unexpected shape`,
      502
    );
  }

  return data;
}

// ─── /process ────────────────────────────────────────────────────────────────

type ProcessResponse = { pages: OcrPage[] };

function isProcessResponse(data: unknown): data is ProcessResponse {
  if (typeof data !== "object" || data === null) return false;
  return Array.isArray((data as Record<string, unknown>).pages);
}

/**
 * Send a Cloudinary document URL to the Python processing service and
 * return the OCR pages it produces.
 */
export async function processDocument(documentUrl: string): Promise<OcrPage[]> {
  const result = await pythonPost(
    "/process",
    { url: documentUrl },
    isProcessResponse,
    "/process"
  );
  return result.pages;
}

// ─── /localize/handwriting ───────────────────────────────────────────────────

/** Response from the Phase 7D OpenCV handwriting localizer. */
export type LocalizeHandwritingResponse = {
  geminiBbox: { x: number; y: number; width: number; height: number };
  /** Tight bbox around detected ink in pixel coordinates. null = no ink found. */
  localizedBbox: { x: number; y: number; width: number; height: number } | null;
  confidence: number;
  diagnostics: {
    component_count: number;
    foreground_pixel_ratio: number;
    crop_width: number;
    crop_height: number;
  };
  imageWidth: number;
  imageHeight: number;
};

function isLocalizeHandwritingResponse(
  data: unknown
): data is LocalizeHandwritingResponse {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.confidence === "number" &&
    typeof d.imageWidth === "number" &&
    typeof d.imageHeight === "number" &&
    "geminiBbox" in d &&
    "localizedBbox" in d &&
    "diagnostics" in d
  );
}

/**
 * Ask the Python service to tighten a Gemini coarse bbox using OpenCV.
 * Returns a tight pixel bbox around detected ink, or null when no ink is found.
 */
export async function localizeHandwriting(
  imageBase64: string,
  geminiBbox: { x: number; y: number; width: number; height: number }
): Promise<LocalizeHandwritingResponse> {
  return pythonPost(
    "/localize/handwriting",
    { imageBase64, geminiBbox },
    isLocalizeHandwritingResponse,
    "/localize/handwriting"
  );
}

// ─── /render-pages ────────────────────────────────────────────────────────────

type RenderPagesResponse = { pages: RenderedPage[] };

function isRenderPagesResponse(data: unknown): data is RenderPagesResponse {
  if (typeof data !== "object" || data === null) return false;
  return Array.isArray((data as Record<string, unknown>).pages);
}

/**
 * Ask the Python service to render each page of a PDF to a PNG image.
 * Returns one RenderedPage per PDF page with pixel dimensions and base64 PNG.
 * Only PDF documents are supported; the Python service returns 400 for images.
 */
export async function renderPages(documentUrl: string): Promise<RenderedPage[]> {
  const result = await pythonPost(
    "/render-pages",
    { url: documentUrl },
    isRenderPagesResponse,
    "/render-pages"
  );
  return result.pages;
}
