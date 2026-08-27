import Anthropic from "@anthropic-ai/sdk";
import { VisionProvider, VisionAnalysisInput } from "./visionProvider";

export class AnthropicVisionClient implements VisionProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async analyze(input: VisionAnalysisInput): Promise<unknown> {
    const imageBlock: Anthropic.ImageBlockParam =
      input.image.type === "url"
        ? {
            type: "image",
            source: { type: "url", url: input.image.url },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: input.image.mediaType,
              data: input.image.data,
            },
          };

    const message = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: input.maxTokens ?? 4096,
      messages: [
        {
          role: "user",
          content: [imageBlock, { type: "text", text: input.prompt }],
        },
      ],
    });

    const rawText =
      message.content[0].type === "text" ? message.content[0].text : "";

    return parseJsonFromText(rawText);
  }
}

function parseJsonFromText(text: string): unknown {
  // Strip markdown code fences Claude sometimes adds
  const stripped = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error(
      `Vision provider returned non-JSON: ${text.slice(0, 300)}`
    );
  }
}

/**
 * Build an AnthropicVisionClient from the ANTHROPIC_API_KEY environment
 * variable, or return null if the key is absent.
 */
export function buildAnthropicClientFromEnv(): AnthropicVisionClient | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new AnthropicVisionClient(key);
}
