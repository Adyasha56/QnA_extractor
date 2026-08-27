/**
 * VisionProvider — abstraction over a vision AI model.
 *
 * Callers pass an image (URL or base64) plus a prompt and receive an unknown
 * value that must be validated before use. Implementations must never return
 * bounding-box coordinates — all spatial information comes from the Python
 * document-processing service.
 */
export type VisionImageSource =
  | { type: "url"; url: string }
  | { type: "base64"; data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };

export type VisionAnalysisInput = {
  image: VisionImageSource;
  prompt: string;
  maxTokens?: number;
};

export interface VisionProvider {
  analyze(input: VisionAnalysisInput): Promise<unknown>;
}
