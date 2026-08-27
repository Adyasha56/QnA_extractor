/**
 * GeminiVisionClient tests.
 * All Gemini SDK calls and fetch calls are mocked — no real API is invoked.
 */

// ─── Mock the Gemini SDK before any imports ───────────────────────────────────

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn(),
}));

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiVisionClient, buildGeminiClientFromEnv } from "../src/clients/geminiVisionClient";
import { buildVisionClientFromEnv } from "../src/clients/visionClientFactory";

const MockGAI = jest.mocked(GoogleGenerativeAI);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Set up a Gemini mock that returns responseText from generateContent. */
function setupGeminiMock(responseText: string) {
  const mockGenerateContent = jest.fn().mockResolvedValue({
    response: { text: () => responseText },
  });
  MockGAI.mockImplementation(
    () =>
      ({
        getGenerativeModel: jest.fn().mockReturnValue({
          generateContent: mockGenerateContent,
        }),
      } as unknown as GoogleGenerativeAI)
  );
  return { mockGenerateContent };
}

/** Set up a global.fetch mock for URL-source tests. */
function setupFetchMock(opts: { ok?: boolean; contentType?: string; body?: string; status?: number } = {}) {
  const { ok = true, contentType = "application/pdf", body = "fake pdf bytes", status = 200 } = opts;
  const arrayBuffer = Buffer.from(body).buffer;
  (global.fetch as jest.Mock).mockResolvedValue({
    ok,
    status,
    headers: {
      get: (name: string) => (name === "content-type" ? contentType : null),
    },
    arrayBuffer: () => Promise.resolve(arrayBuffer),
  });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as unknown as typeof fetch;
  // Clear env keys so each test starts clean
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
});

// ─── GeminiVisionClient — base64 image source ─────────────────────────────────

describe("GeminiVisionClient — base64 source", () => {
  const BASE64_INPUT = {
    image: {
      type: "base64" as const,
      data: Buffer.from("fake image").toString("base64"),
      mediaType: "image/png" as const,
    },
    prompt: "Extract questions as JSON.",
  };

  it("returns parsed JSON from a plain Gemini response", async () => {
    setupGeminiMock('[{"number":"1","text":"What is a variable?"}]');
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    const result = await client.analyze(BASE64_INPUT);
    expect(result).toEqual([{ number: "1", text: "What is a variable?" }]);
  });

  it("strips markdown fences before parsing", async () => {
    setupGeminiMock('```json\n[{"number":"2","text":"Explain TCP."}]\n```');
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    const result = await client.analyze(BASE64_INPUT);
    expect(result).toEqual([{ number: "2", text: "Explain TCP." }]);
  });

  it("passes the image as inlineData to generateContent", async () => {
    const { mockGenerateContent } = setupGeminiMock("[]");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await client.analyze(BASE64_INPUT);

    const [call] = mockGenerateContent.mock.calls;
    const parts = call[0] as unknown[];
    expect(parts).toContainEqual({
      inlineData: {
        data: BASE64_INPUT.image.data,
        mimeType: "image/png",
      },
    });
  });

  it("includes the prompt as a text part", async () => {
    const { mockGenerateContent } = setupGeminiMock("[]");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await client.analyze(BASE64_INPUT);

    const parts = mockGenerateContent.mock.calls[0][0] as unknown[];
    expect(parts).toContainEqual({ text: BASE64_INPUT.prompt });
  });

  it("uses the model name passed to the constructor", async () => {
    setupGeminiMock("[]");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await client.analyze(BASE64_INPUT);

    const instance = MockGAI.mock.results[0].value as { getGenerativeModel: jest.Mock };
    expect(instance.getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.5-flash" })
    );
  });

  it("uses GEMINI_MODEL env var when no model passed to constructor", async () => {
    process.env.GEMINI_MODEL = "gemini-custom-model";
    setupGeminiMock("[]");
    const client = new GeminiVisionClient("test-key");
    await client.analyze(BASE64_INPUT);

    const instance = MockGAI.mock.results[0].value as { getGenerativeModel: jest.Mock };
    expect(instance.getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-custom-model" })
    );
  });
});

// ─── GeminiVisionClient — URL image source ────────────────────────────────────

describe("GeminiVisionClient — URL source", () => {
  const URL_INPUT = {
    image: { type: "url" as const, url: "https://cloudinary.com/doc.pdf" },
    prompt: "Extract questions.",
  };

  it("fetches the URL and sends content as inlineData", async () => {
    setupFetchMock({ contentType: "application/pdf", body: "pdf bytes" });
    const { mockGenerateContent } = setupGeminiMock("[]");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await client.analyze(URL_INPUT);

    expect(global.fetch).toHaveBeenCalledWith(URL_INPUT.image.url);
    const parts = mockGenerateContent.mock.calls[0][0] as unknown[];
    const inlinePart = parts.find(
      (p) => typeof p === "object" && p !== null && "inlineData" in p
    ) as { inlineData: { mimeType: string } } | undefined;
    expect(inlinePart?.inlineData.mimeType).toBe("application/pdf");
  });

  it("throws when the URL fetch fails", async () => {
    setupFetchMock({ ok: false, status: 403 });
    setupGeminiMock("[]");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await expect(client.analyze(URL_INPUT)).rejects.toThrow(/HTTP 403/);
  });
});

// ─── GeminiVisionClient — error handling ─────────────────────────────────────

describe("GeminiVisionClient — error handling", () => {
  const INPUT = {
    image: {
      type: "base64" as const,
      data: "abc",
      mediaType: "image/jpeg" as const,
    },
    prompt: "Extract.",
  };

  it("throws on malformed JSON response", async () => {
    setupGeminiMock("this is not json at all");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await expect(client.analyze(INPUT)).rejects.toThrow(/non-JSON/i);
  });

  it("throws when Gemini returns an empty string", async () => {
    setupGeminiMock("");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await expect(client.analyze(INPUT)).rejects.toThrow(/empty response/i);
  });

  it("throws when Gemini returns a whitespace-only string", async () => {
    setupGeminiMock("   \n  ");
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await expect(client.analyze(INPUT)).rejects.toThrow(/empty response/i);
  });

  it("re-throws Gemini API errors with a descriptive message", async () => {
    MockGAI.mockImplementation(
      () =>
        ({
          getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: jest.fn().mockRejectedValue(new Error("quota exceeded")),
          }),
        } as unknown as GoogleGenerativeAI)
    );
    const client = new GeminiVisionClient("test-key", "gemini-3.5-flash");
    await expect(client.analyze(INPUT)).rejects.toThrow("quota exceeded");
  });
});

// ─── buildGeminiClientFromEnv ─────────────────────────────────────────────────

describe("buildGeminiClientFromEnv", () => {
  it("returns null when GEMINI_API_KEY is not set", () => {
    const client = buildGeminiClientFromEnv();
    expect(client).toBeNull();
  });

  it("returns a GeminiVisionClient when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "my-test-key";
    const client = buildGeminiClientFromEnv();
    expect(client).toBeInstanceOf(GeminiVisionClient);
  });

  it("uses GEMINI_API_KEY to initialise GoogleGenerativeAI", () => {
    process.env.GEMINI_API_KEY = "key-abc";
    buildGeminiClientFromEnv();
    // GeminiVisionClient eagerly constructs GoogleGenerativeAI in its constructor.
    expect(MockGAI).toHaveBeenCalledWith("key-abc");
  });
});

// ─── buildVisionClientFromEnv ─────────────────────────────────────────────────

describe("buildVisionClientFromEnv — provider selection", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("returns null when GEMINI_API_KEY is not set", () => {
    expect(buildVisionClientFromEnv()).toBeNull();
  });

  it("returns a GeminiVisionClient when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const provider = buildVisionClientFromEnv();
    expect(provider).toBeInstanceOf(GeminiVisionClient);
  });

  it("does NOT select Anthropic even when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-key";
    // No GEMINI_API_KEY set
    const provider = buildVisionClientFromEnv();
    expect(provider).toBeNull();
  });

  it("returns Gemini when both keys are set — Anthropic is never auto-selected", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    const provider = buildVisionClientFromEnv();
    expect(provider).toBeInstanceOf(GeminiVisionClient);
  });
});
