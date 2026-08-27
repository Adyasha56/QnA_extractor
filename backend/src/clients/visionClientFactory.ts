import { VisionProvider } from "./visionProvider";
import { buildGeminiClientFromEnv } from "./geminiVisionClient";

/**
 * Return the active VisionProvider based on environment variables.
 *
 * Priority: Gemini (GEMINI_API_KEY) → null.
 *
 * Anthropic is intentionally excluded from automatic selection to satisfy
 * the ₹0 mandatory-cost constraint. AnthropicVisionClient remains available
 * for future explicit opt-in.
 *
 * Returns null when GEMINI_API_KEY is absent; callers fall back to
 * deterministic extraction only.
 */
export function buildVisionClientFromEnv(): VisionProvider | null {
  return buildGeminiClientFromEnv();
}
