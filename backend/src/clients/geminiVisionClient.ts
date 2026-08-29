import { GoogleGenerativeAI } from "@google/generative-ai";
import { VisionProvider, VisionAnalysisInput } from "./visionProvider";

const DEFAULT_MODEL = "gemini-3.5-flash";
const REQUEST_TIMEOUT_MS = 60_000;

// ─── Helper: fetch a URL and return base64 + MIME type ────────────────────────

export async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download document for Gemini analysis (HTTP ${response.status})`
    );
  }
  const rawType = response.headers.get("content-type") ?? "application/octet-stream";
  const mimeType = rawType.split(";")[0].trim();
  const buffer = await response.arrayBuffer();
  return { data: Buffer.from(buffer).toString("base64"), mimeType };
}

// ─── Helper: strip markdown fences and parse JSON ─────────────────────────────

export function parseJsonFromText(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error(
      `Gemini returned a non-JSON response: ${text.slice(0, 300)}`
    );
  }
}

// ─── GeminiVisionClient ────────────────────────────────────────────────────────

export class GeminiVisionClient implements VisionProvider {
  private readonly genai: GoogleGenerativeAI;
  private readonly model: string;

  constructor(
    apiKey: string,
    model: string = process.env.GEMINI_MODEL ?? DEFAULT_MODEL
  ) {
    this.genai = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async analyze(input: VisionAnalysisInput): Promise<unknown> {
    let imageData: { data: string; mimeType: string };

    if (input.image.type === "url") {
      imageData = await fetchAsBase64(input.image.url);
    } else {
      imageData = {
        data: input.image.data,
        mimeType: input.image.mediaType,
      };
    }

    const geminiModel = this.genai.getGenerativeModel({ model: this.model });

    const generatePromise = geminiModel.generateContent([
      { text: input.prompt },
      { inlineData: { data: imageData.data, mimeType: imageData.mimeType } },
    ]);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Gemini API request timed out")),
        REQUEST_TIMEOUT_MS
      );
    });

    let text: string;
    try {
      const result = await Promise.race([generatePromise, timeoutPromise]);
      clearTimeout(timer);
      text = result.response.text();
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error) throw err;
      throw new Error(`Gemini API request failed: ${String(err)}`);
    }

    if (!text || !text.trim()) {
      throw new Error("Gemini returned an empty response");
    }

    return parseJsonFromText(text);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function buildGeminiClientFromEnv(): GeminiVisionClient | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiVisionClient(key);
}

// ─── Error classification ──────────────────────────────────────────────────────

// Detects a rate-limit/quota/overload error from Gemini, as opposed to a
// genuine bug — lets callers surface "try again shortly" instead of a
// generic failure.
export function isAiUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|too many requests|quota|rate limit|\b503\b|service unavailable|overloaded|high demand/i.test(
    message
  );
}
