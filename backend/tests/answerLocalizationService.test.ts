/**
 * Phase 8 — answerLocalizationService unit tests.
 *
 * All external calls (renderPages, localizeHandwriting, benchmarkGeminiRegionsFromRenderedPages)
 * are mocked. convertPixelToPdfBbox runs as real code so coordinate math is verified.
 * No network access. No disk writes.
 */

import { localizeAnswerRegions } from "../src/services/answerLocalizationService";
import { Answer } from "../src/models/extraction";
import { VisionProvider } from "../src/clients/visionProvider";
import {
  renderPages,
  localizeHandwriting,
  RenderedPage,
  LocalizeHandwritingResponse,
} from "../src/clients/pythonClient";
import { fetchAsBase64 } from "../src/clients/geminiVisionClient";
import {
  benchmarkGeminiRegionsFromRenderedPages,
  RenderedBenchmarkResult,
} from "../src/services/geminiRegionBenchmark";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("../src/clients/pythonClient");
jest.mock("../src/clients/geminiVisionClient");

// Preserve real convertPixelToPdfBbox so coordinate math is exercised.
jest.mock("../src/services/geminiRegionBenchmark", () => ({
  ...jest.requireActual("../src/services/geminiRegionBenchmark"),
  benchmarkGeminiRegionsFromRenderedPages: jest.fn(),
}));

const mockRenderPages = renderPages as jest.MockedFunction<typeof renderPages>;
const mockLocalizeHandwriting = localizeHandwriting as jest.MockedFunction<
  typeof localizeHandwriting
>;
const mockFetchAsBase64 = fetchAsBase64 as jest.MockedFunction<typeof fetchAsBase64>;
const mockBenchmarkGemini =
  benchmarkGeminiRegionsFromRenderedPages as jest.MockedFunction<
    typeof benchmarkGeminiRegionsFromRenderedPages
  >;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_VISION_PROVIDER: VisionProvider = { analyze: jest.fn() };

const RENDERED_PAGE_1: RenderedPage = {
  pageNumber: 1,
  pdfWidth: 595,
  pdfHeight: 842,
  imageWidth: 1190,
  imageHeight: 1684,
  imageBase64: "fake-base64-page1",
};

const RENDERED_PAGE_2: RenderedPage = {
  pageNumber: 2,
  pdfWidth: 595,
  pdfHeight: 842,
  imageWidth: 1190,
  imageHeight: 1684,
  imageBase64: "fake-base64-page2",
};

function makeAnswer(
  questionNumber: string,
  text = "Some answer text"
): Answer {
  return {
    id: `answer_${questionNumber.replace(/[^a-z0-9]/gi, "")}`,
    text,
    detectedQuestionNumber: questionNumber,
    regions: [],
  };
}

function makeLocalizeOk(
  localizedBbox: { x: number; y: number; width: number; height: number }
): LocalizeHandwritingResponse {
  return {
    geminiBbox: { x: 0, y: 0, width: 100, height: 100 },
    localizedBbox,
    confidence: 0.12,
    diagnostics: {
      component_count: 5,
      foreground_pixel_ratio: 0.12,
      crop_width: 100,
      crop_height: 100,
    },
    imageWidth: 1190,
    imageHeight: 1684,
  };
}

function makeLocalizeNull(): LocalizeHandwritingResponse {
  return {
    geminiBbox: { x: 0, y: 0, width: 100, height: 100 },
    localizedBbox: null,
    confidence: 0,
    diagnostics: {
      component_count: 0,
      foreground_pixel_ratio: 0,
      crop_width: 100,
      crop_height: 100,
    },
    imageWidth: 1190,
    imageHeight: 1684,
  };
}

function makeGeminiResult(
  pageNumber: number,
  regions: RenderedBenchmarkResult["pages"][0]["regions"],
  rendered: RenderedPage = RENDERED_PAGE_1
): RenderedBenchmarkResult {
  return {
    pages: [
      {
        pageNumber,
        pdfWidth: rendered.pdfWidth,
        pdfHeight: rendered.pdfHeight,
        imageWidth: rendered.imageWidth,
        imageHeight: rendered.imageHeight,
        regions,
        malformedCount: 0,
      },
    ],
    totalMalformed: 0,
  };
}

const ANSWER_SHEET_URL = "https://example.com/answer-sheet.pdf";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderPages.mockResolvedValue([RENDERED_PAGE_1]);
  mockFetchAsBase64.mockResolvedValue({ data: "fake-image-base64", mimeType: "image/jpeg" });
});

// ─── 1. Valid bbox → localized PDF region ────────────────────────────────────

describe("valid Gemini bbox → localized PDF region", () => {
  it("populates regions for an answer when Gemini and OpenCV both succeed", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "A variable stores data.",
          pixelBbox: { x: 100, y: 200, width: 400, height: 100 },
          pdfBbox: { x: 50, y: 100, width: 200, height: 50 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 110, y: 210, width: 380, height: 80 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(1);
  });

  it("region has correct page number", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 100, y: 200, width: 400, height: 100 },
          pdfBbox: { x: 50, y: 100, width: 200, height: 50 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 110, y: 210, width: 380, height: 80 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions[0].page).toBe(1);
  });

  it("region bbox uses PDF-point coordinates, not raw pixels", async () => {
    // imageWidth=1190, pdfWidth=595 → scaleX=0.5; same for Y.
    // localizedBbox pixels: x=200, y=400, w=800, h=200
    // expected PDF: x=100, y=200, w=400, h=100
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 100, y: 200, width: 800, height: 200 },
          pdfBbox: { x: 50, y: 100, width: 400, height: 100 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 200, y: 400, width: 800, height: 200 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);
    const bbox = result[0].regions[0].bbox;

    expect(bbox.x).toBeCloseTo(100);
    expect(bbox.y).toBeCloseTo(200);
    expect(bbox.width).toBeCloseTo(400);
    expect(bbox.height).toBeCloseTo(100);
  });

  it("does not mutate the input answers array", async () => {
    const answers = [makeAnswer("1")];
    const original = JSON.stringify(answers);
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 0, y: 0, width: 100, height: 50 },
          pdfBbox: { x: 0, y: 0, width: 50, height: 25 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 10, y: 10, width: 80, height: 40 })
    );

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(JSON.stringify(answers)).toBe(original);
  });
});

// ─── 2. Multiple answers ──────────────────────────────────────────────────────

describe("multiple answers", () => {
  it("populates regions for each matched answer", async () => {
    const answers = [makeAnswer("1"), makeAnswer("2")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer one.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
        {
          detectedQuestionNumber: "2",
          text: "Answer two.",
          pixelBbox: { x: 0, y: 200, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 100, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting
      .mockResolvedValueOnce(makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 }))
      .mockResolvedValueOnce(makeLocalizeOk({ x: 5, y: 205, width: 390, height: 70 }));

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(1);
    expect(result[1].regions).toHaveLength(1);
  });

  it("calls localizeHandwriting once per valid Gemini region", async () => {
    const answers = [makeAnswer("1"), makeAnswer("2")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer one.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
        {
          detectedQuestionNumber: "2",
          text: "Answer two.",
          pixelBbox: { x: 0, y: 200, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 100, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(mockLocalizeHandwriting).toHaveBeenCalledTimes(2);
  });
});

// ─── 3. Out-of-order answers ──────────────────────────────────────────────────

describe("out-of-order answers", () => {
  it("matches answer Q4 before Q3 when sheet is out of order", async () => {
    const answers = [makeAnswer("4"), makeAnswer("3")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "4",
          text: "Answer four.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
        {
          detectedQuestionNumber: "3",
          text: "Answer three.",
          pixelBbox: { x: 0, y: 200, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 100, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    // Q4 is first, Q3 is second — both get regions
    expect(result[0].detectedQuestionNumber).toBe("4");
    expect(result[0].regions).toHaveLength(1);
    expect(result[1].detectedQuestionNumber).toBe("3");
    expect(result[1].regions).toHaveLength(1);
  });

  it("preserves the original answer order in the returned array", async () => {
    const answers = [makeAnswer("4"), makeAnswer("3")];
    mockBenchmarkGemini.mockResolvedValue(makeGeminiResult(1, []));

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].detectedQuestionNumber).toBe("4");
    expect(result[1].detectedQuestionNumber).toBe("3");
  });
});

// ─── 4. Sub-parts ─────────────────────────────────────────────────────────────

describe("sub-part answers", () => {
  it("matches 3(a) and 3(b) as separate answers", async () => {
    const answers = [makeAnswer("3(a)"), makeAnswer("3(b)")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "3(a)",
          text: "Part a answer.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
        {
          detectedQuestionNumber: "3(b)",
          text: "Part b answer.",
          pixelBbox: { x: 0, y: 200, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 100, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    const a = result.find((r) => r.detectedQuestionNumber === "3(a)");
    const b = result.find((r) => r.detectedQuestionNumber === "3(b)");
    expect(a?.regions).toHaveLength(1);
    expect(b?.regions).toHaveLength(1);
  });

  it("does not cross-assign sub-part regions", async () => {
    const answers = [makeAnswer("3(a)"), makeAnswer("3(b)")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "3(a)",
          text: "Part a.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    const b = result.find((r) => r.detectedQuestionNumber === "3(b)");
    expect(b?.regions).toHaveLength(0);
  });
});

// ─── 5. Blank Q5 (empty text) → no region (req 13) ──────────────────────────

describe("empty-text answers", () => {
  it("does not add a region for a blank answer even when Gemini provides a bbox", async () => {
    const answers = [makeAnswer("5", "")]; // blank
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "5",
          text: "",
          pixelBbox: { x: 0, y: 500, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 250, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 505, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0);
  });

  it("does not call localizeHandwriting for blank answers", async () => {
    const answers = [makeAnswer("5", "")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "5",
          text: "",
          pixelBbox: { x: 0, y: 500, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 250, width: 200, height: 40 },
        },
      ])
    );

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(mockLocalizeHandwriting).not.toHaveBeenCalled();
  });

  it("still processes non-blank answers alongside a blank one", async () => {
    const answers = [makeAnswer("1", "Real answer."), makeAnswer("5", "")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Real answer.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
        {
          detectedQuestionNumber: "5",
          text: "",
          pixelBbox: { x: 0, y: 500, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 250, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result.find((a) => a.detectedQuestionNumber === "1")?.regions).toHaveLength(1);
    expect(result.find((a) => a.detectedQuestionNumber === "5")?.regions).toHaveLength(0);
  });
});

// ─── 6. Missing Gemini bbox → no region (req 7) ──────────────────────────────

describe("missing Gemini bbox", () => {
  it("keeps regions empty when Gemini returns null pixelBbox", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Some answer.",
          pixelBbox: null,
          pdfBbox: null,
        },
      ])
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0);
  });

  it("does not call localizeHandwriting when pixelBbox is null", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Some answer.",
          pixelBbox: null,
          pdfBbox: null,
        },
      ])
    );

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(mockLocalizeHandwriting).not.toHaveBeenCalled();
  });

  it("pipeline continues normally when Gemini returns no bbox", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(makeGeminiResult(1, []));

    await expect(
      localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER)
    ).resolves.not.toThrow();
  });
});

// ─── 7. OpenCV localization failure → no region (req 8) ──────────────────────

describe("OpenCV localization failure", () => {
  it("keeps regions empty when localizedBbox is null", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(makeLocalizeNull());

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0);
  });

  it("keeps regions empty when localizeHandwriting throws", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockRejectedValue(new Error("OpenCV service unavailable"));

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0);
  });

  it("processes remaining answers when one OpenCV call fails", async () => {
    const answers = [makeAnswer("1"), makeAnswer("2")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer one.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
        {
          detectedQuestionNumber: "2",
          text: "Answer two.",
          pixelBbox: { x: 0, y: 200, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 100, width: 200, height: 40 },
        },
      ])
    );
    // Q1 fails, Q2 succeeds
    mockLocalizeHandwriting
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(makeLocalizeOk({ x: 5, y: 205, width: 390, height: 70 }));

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0); // Q1 failed
    expect(result[1].regions).toHaveLength(1); // Q2 succeeded
  });
});

// ─── 8. Multi-page answer ────────────────────────────────────────────────────

describe("multi-page answers", () => {
  it("accumulates regions from multiple pages for the same answer", async () => {
    mockRenderPages.mockResolvedValue([RENDERED_PAGE_1, RENDERED_PAGE_2]);

    const answers = [makeAnswer("1")];
    const twoPageResult: RenderedBenchmarkResult = {
      pages: [
        {
          pageNumber: 1,
          pdfWidth: 595, pdfHeight: 842,
          imageWidth: 1190, imageHeight: 1684,
          regions: [
            {
              detectedQuestionNumber: "1",
              text: "First part.",
              pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
              pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
            },
          ],
          malformedCount: 0,
        },
        {
          pageNumber: 2,
          pdfWidth: 595, pdfHeight: 842,
          imageWidth: 1190, imageHeight: 1684,
          regions: [
            {
              detectedQuestionNumber: "1",
              text: "Second part.",
              pixelBbox: { x: 0, y: 50, width: 400, height: 80 },
              pdfBbox: { x: 0, y: 25, width: 200, height: 40 },
            },
          ],
          malformedCount: 0,
        },
      ],
      totalMalformed: 0,
    };
    mockBenchmarkGemini.mockResolvedValue(twoPageResult);
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(2);
  });

  it("assigns correct page numbers to each region", async () => {
    mockRenderPages.mockResolvedValue([RENDERED_PAGE_1, RENDERED_PAGE_2]);

    const answers = [makeAnswer("1")];
    const twoPageResult: RenderedBenchmarkResult = {
      pages: [
        {
          pageNumber: 1,
          pdfWidth: 595, pdfHeight: 842,
          imageWidth: 1190, imageHeight: 1684,
          regions: [
            {
              detectedQuestionNumber: "1",
              text: "First part.",
              pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
              pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
            },
          ],
          malformedCount: 0,
        },
        {
          pageNumber: 2,
          pdfWidth: 595, pdfHeight: 842,
          imageWidth: 1190, imageHeight: 1684,
          regions: [
            {
              detectedQuestionNumber: "1",
              text: "Second part.",
              pixelBbox: { x: 0, y: 50, width: 400, height: 80 },
              pdfBbox: { x: 0, y: 25, width: 200, height: 40 },
            },
          ],
          malformedCount: 0,
        },
      ],
      totalMalformed: 0,
    };
    mockBenchmarkGemini.mockResolvedValue(twoPageResult);
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 5, y: 105, width: 390, height: 70 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    const pages = result[0].regions.map((r) => r.page);
    expect(pages).toContain(1);
    expect(pages).toContain(2);
  });
});

// ─── 8b. Image answer sheet (non-PDF source) ─────────────────────────────────
//
// Regression coverage for extending exact-region highlighting to image
// (JPEG/PNG) answer sheets, not just PDFs — the assignment explicitly
// requires highlighting to work regardless of upload format.

describe("image answer sheet (non-PDF source)", () => {
  it("fetches the raw image instead of calling renderPages", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(makeGeminiResult(1, [], { ...RENDERED_PAGE_1, pdfWidth: 800, pdfHeight: 600, imageWidth: 800, imageHeight: 600 }));

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER, {
      isPdf: false,
      imageWidth: 800,
      imageHeight: 600,
    });

    expect(mockFetchAsBase64).toHaveBeenCalledWith(ANSWER_SHEET_URL);
    expect(mockRenderPages).not.toHaveBeenCalled();
  });

  it("builds a synthetic page whose pdfWidth/pdfHeight equal the image's own pixel dimensions", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(makeGeminiResult(1, []));

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER, {
      isPdf: false,
      imageWidth: 800,
      imageHeight: 600,
    });

    const [, renderedPagesArg] = mockBenchmarkGemini.mock.calls[0];
    expect(renderedPagesArg).toEqual([
      expect.objectContaining({
        pageNumber: 1,
        pdfWidth: 800,
        pdfHeight: 600,
        imageWidth: 800,
        imageHeight: 600,
        imageBase64: "fake-image-base64",
      }),
    ]);
  });

  it("passes the image's real mediaType (not hard-coded PNG) to the Gemini benchmark call", async () => {
    mockFetchAsBase64.mockResolvedValue({ data: "jpeg-bytes", mimeType: "image/jpeg; charset=binary" });
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(makeGeminiResult(1, []));

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER, {
      isPdf: false,
      imageWidth: 800,
      imageHeight: 600,
    });

    const [, , mediaTypeArg] = mockBenchmarkGemini.mock.calls[0];
    expect(mediaTypeArg).toBe("image/jpeg");
  });

  it("region bbox equals the raw pixel bbox (scale factor 1) rather than being scaled down", async () => {
    // pdfWidth/pdfHeight are set equal to imageWidth/imageHeight for images,
    // so convertPixelToPdfBbox's scale factor is 1 — output must equal input.
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 100, y: 200, width: 400, height: 100 },
          pdfBbox: null, // irrelevant — real conversion logic recomputes this
        },
      ], { pageNumber: 1, pdfWidth: 800, pdfHeight: 600, imageWidth: 800, imageHeight: 600, imageBase64: "fake-image-base64" })
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 110, y: 210, width: 380, height: 80 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER, {
      isPdf: false,
      imageWidth: 800,
      imageHeight: 600,
    });

    const bbox = result[0].regions[0].bbox;
    expect(bbox).toEqual({ x: 110, y: 210, width: 380, height: 80 });
  });

  it("throws (best-effort caller handles it) when given invalid image dimensions", async () => {
    const answers = [makeAnswer("1")];
    await expect(
      localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER, {
        isPdf: false,
        imageWidth: 0,
        imageHeight: 0,
      })
    ).rejects.toThrow(/invalid image dimensions/i);
  });

  it("defaults to isPdf: true when no source is given (backward compatible)", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(makeGeminiResult(1, []));

    await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(mockRenderPages).toHaveBeenCalledWith(ANSWER_SHEET_URL);
    expect(mockFetchAsBase64).not.toHaveBeenCalled();
  });
});

// ─── 9. Coordinate conversion ────────────────────────────────────────────────

describe("coordinate conversion (pixel → PDF points)", () => {
  it("converts x coordinate correctly: pixel * (pdfWidth / imageWidth)", async () => {
    // scale = 595/1190 = 0.5; pixelX=200 → pdfX=100
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 100, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 50, y: 50, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 200, y: 300, width: 600, height: 160 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);
    const bbox = result[0].regions[0].bbox;

    // scaleX = 595/1190 = 0.5
    expect(bbox.x).toBeCloseTo(100);   // 200 * 0.5
    expect(bbox.width).toBeCloseTo(300); // 600 * 0.5
  });

  it("converts y coordinate correctly: pixel * (pdfHeight / imageHeight)", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 0, y: 100, width: 400, height: 80 },
          pdfBbox: { x: 0, y: 50, width: 200, height: 40 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 0, y: 400, width: 400, height: 200 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);
    const bbox = result[0].regions[0].bbox;

    // scaleY = 842/1684 ≈ 0.5
    expect(bbox.y).toBeCloseTo(200);    // 400 * 0.5
    expect(bbox.height).toBeCloseTo(100); // 200 * 0.5
  });

  it("uses OpenCV localizedBbox for conversion, not Gemini pixelBbox", async () => {
    const answers = [makeAnswer("1")];
    const geminiPixelBbox = { x: 0, y: 100, width: 900, height: 200 }; // coarse
    const opencvLocalizedBbox = { x: 50, y: 120, width: 700, height: 160 }; // tight

    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: geminiPixelBbox,
          pdfBbox: { x: 0, y: 50, width: 450, height: 100 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(makeLocalizeOk(opencvLocalizedBbox));

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);
    const bbox = result[0].regions[0].bbox;

    // scaleX = 0.5; OpenCV x=50 → pdf x=25 (not Gemini's 0)
    expect(bbox.x).toBeCloseTo(25);
    expect(bbox.width).toBeCloseTo(350); // 700 * 0.5, not 900 * 0.5
  });
});

// ─── 10. No fabricated coordinates ───────────────────────────────────────────

describe("no fabricated coordinates", () => {
  it("never uses Gemini raw pixelBbox as a final region directly", async () => {
    // Even if we have a pixelBbox from Gemini, we only add a region if
    // OpenCV confirms ink. If OpenCV returns null, regions must stay empty.
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 0, y: 100, width: 900, height: 200 },
          pdfBbox: { x: 0, y: 50, width: 450, height: 100 },
        },
      ])
    );
    // OpenCV finds nothing
    mockLocalizeHandwriting.mockResolvedValue(makeLocalizeNull());

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0);
  });

  it("never adds a region when Gemini pixelBbox is null", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: null,
          pdfBbox: null,
        },
      ])
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);

    expect(result[0].regions).toHaveLength(0);
    expect(mockLocalizeHandwriting).not.toHaveBeenCalled();
  });

  it("region bbox values are always finite numbers, never NaN or Infinity", async () => {
    const answers = [makeAnswer("1")];
    mockBenchmarkGemini.mockResolvedValue(
      makeGeminiResult(1, [
        {
          detectedQuestionNumber: "1",
          text: "Answer.",
          pixelBbox: { x: 100, y: 200, width: 400, height: 100 },
          pdfBbox: { x: 50, y: 100, width: 200, height: 50 },
        },
      ])
    );
    mockLocalizeHandwriting.mockResolvedValue(
      makeLocalizeOk({ x: 110, y: 210, width: 380, height: 80 })
    );

    const result = await localizeAnswerRegions(ANSWER_SHEET_URL, answers, MOCK_VISION_PROVIDER);
    const bbox = result[0].regions[0].bbox;

    expect(Number.isFinite(bbox.x)).toBe(true);
    expect(Number.isFinite(bbox.y)).toBe(true);
    expect(Number.isFinite(bbox.width)).toBe(true);
    expect(Number.isFinite(bbox.height)).toBe(true);
  });
});
