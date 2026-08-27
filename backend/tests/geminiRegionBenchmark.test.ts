/**
 * Tests for the experimental Gemini region benchmark service.
 * The VisionProvider is mocked — no real Gemini calls are made.
 */

import {
  benchmarkGeminiRegions,
  benchmarkGeminiRegionsFromRenderedPages,
  convertPixelToPdfBbox,
} from "../src/services/geminiRegionBenchmark";
import { RenderedPage } from "../src/clients/pythonClient";
import { VisionProvider, VisionAnalysisInput } from "../src/clients/visionProvider";

// ─── Mock provider factory ────────────────────────────────────────────────────

function makeProvider(response: unknown): VisionProvider {
  return {
    analyze: jest.fn().mockResolvedValue(response),
  };
}

function makeFailingProvider(error: Error): VisionProvider {
  return {
    analyze: jest.fn().mockRejectedValue(error),
  };
}

const IMAGE_BASE64 = {
  type: "base64" as const,
  data: Buffer.from("fake page image").toString("base64"),
  mediaType: "image/png" as const,
};

const IMAGE_URL = {
  type: "url" as const,
  url: "https://example.com/answer-sheet-page1.jpg",
};

// ─── Valid response ───────────────────────────────────────────────────────────

describe("benchmarkGeminiRegions — valid region response", () => {
  it("returns one region with correct fields", async () => {
    const provider = makeProvider([
      {
        detectedQuestionNumber: "1",
        text: "A variable is a named memory location.",
        bbox: { x: 100, y: 200, width: 900, height: 150 },
      },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(0);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toEqual({
      detectedQuestionNumber: "1",
      text: "A variable is a named memory location.",
      bbox: { x: 100, y: 200, width: 900, height: 150 },
    });
  });

  it("preserves rawResponse exactly as returned by the provider", async () => {
    const raw = [{ detectedQuestionNumber: "2", text: "TCP is...", bbox: null }];
    const provider = makeProvider(raw);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.rawResponse).toBe(raw); // same reference — not cloned
  });

  it("passes the correct prompt to the provider", async () => {
    const provider = makeProvider([]);
    await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    const call = (provider.analyze as jest.Mock).mock.calls[0][0] as VisionAnalysisInput;
    expect(call.prompt).toMatch(/bounding box/i);
    expect(call.prompt).toMatch(/pixel/i);
    expect(call.prompt).toMatch(/top-left/i);
  });

  it("forwards the image source to the provider unchanged", async () => {
    const provider = makeProvider([]);
    await benchmarkGeminiRegions(provider, IMAGE_URL);

    const call = (provider.analyze as jest.Mock).mock.calls[0][0] as VisionAnalysisInput;
    expect(call.image).toEqual(IMAGE_URL);
  });

  it("accepts a bbox of null from Gemini without incrementing malformedCount", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "5", text: "", bbox: null },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(0);
    expect(result.regions[0].bbox).toBeNull();
  });
});

// ─── Multiple answer regions ──────────────────────────────────────────────────

describe("benchmarkGeminiRegions — multiple answer regions", () => {
  const MULTI_RESPONSE = [
    { detectedQuestionNumber: "1", text: "Answer one.", bbox: { x: 50, y: 100, width: 800, height: 120 } },
    { detectedQuestionNumber: "2", text: "Answer two.", bbox: { x: 50, y: 240, width: 800, height: 90 } },
    { detectedQuestionNumber: "3(a)", text: "Answer three-a.", bbox: { x: 50, y: 350, width: 800, height: 110 } },
    { detectedQuestionNumber: "3(b)", text: "Answer three-b.", bbox: { x: 50, y: 480, width: 800, height: 130 } },
  ];

  it("returns all four regions with correct question numbers", async () => {
    const result = await benchmarkGeminiRegions(makeProvider(MULTI_RESPONSE), IMAGE_BASE64);

    expect(result.regions).toHaveLength(4);
    expect(result.regions.map((r) => r.detectedQuestionNumber)).toEqual([
      "1", "2", "3(a)", "3(b)",
    ]);
  });

  it("returns bboxes with correct pixel values for each region", async () => {
    const result = await benchmarkGeminiRegions(makeProvider(MULTI_RESPONSE), IMAGE_BASE64);

    expect(result.regions[2].bbox).toEqual({ x: 50, y: 350, width: 800, height: 110 });
    expect(result.regions[3].bbox).toEqual({ x: 50, y: 480, width: 800, height: 130 });
  });

  it("reports zero malformed when all bboxes are valid", async () => {
    const result = await benchmarkGeminiRegions(makeProvider(MULTI_RESPONSE), IMAGE_BASE64);
    expect(result.malformedCount).toBe(0);
  });

  it("handles a mix of bbox-present and bbox-null regions", async () => {
    const mixed = [
      { detectedQuestionNumber: "1", text: "Ans 1", bbox: { x: 0, y: 0, width: 500, height: 100 } },
      { detectedQuestionNumber: "2", text: "Ans 2", bbox: null },
      { detectedQuestionNumber: "3", text: "Ans 3", bbox: { x: 0, y: 200, width: 500, height: 80 } },
    ];

    const result = await benchmarkGeminiRegions(makeProvider(mixed), IMAGE_BASE64);

    expect(result.regions).toHaveLength(3);
    expect(result.regions[1].bbox).toBeNull();
    expect(result.regions[0].bbox).not.toBeNull();
    expect(result.malformedCount).toBe(0);
  });
});

// ─── Malformed bbox ───────────────────────────────────────────────────────────

describe("benchmarkGeminiRegions — malformed bbox", () => {
  it("counts as malformed when bbox is an empty object", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "1", text: "Some text.", bbox: {} },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(1);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("counts as malformed when bbox has only partial fields", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "2", text: "Text.", bbox: { x: 10, y: 20 } }, // missing width/height
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(1);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("counts as malformed when bbox is a string instead of an object", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "3", text: "Text.", bbox: "top: 100px" },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(1);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("accumulates malformedCount across multiple bad items", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "1", text: "OK", bbox: { x: 0, y: 0, width: 100, height: 50 } },
      { detectedQuestionNumber: "2", text: "Bad", bbox: {} },
      { detectedQuestionNumber: "3", text: "Bad2", bbox: { x: 10 } },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(2);
    expect(result.regions).toHaveLength(3);
  });
});

// ─── Missing bbox field ───────────────────────────────────────────────────────

describe("benchmarkGeminiRegions — missing bbox field", () => {
  it("treats missing bbox field as null (not malformed)", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "4", text: "No bbox at all." },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(0);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("treats undefined bbox as null (not malformed)", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "5", text: "Undefined bbox.", bbox: undefined },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(0);
    expect(result.regions[0].bbox).toBeNull();
  });
});

// ─── Invalid numeric coordinates ─────────────────────────────────────────────

describe("benchmarkGeminiRegions — invalid numeric coordinates", () => {
  it("counts as malformed when coordinates are NaN", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "1", text: "NaN bbox.", bbox: { x: NaN, y: 0, width: 100, height: 50 } },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(1);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("counts as malformed when coordinates are Infinity", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "2", text: "Inf bbox.", bbox: { x: Infinity, y: 0, width: 100, height: 50 } },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(1);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("counts as malformed when coordinates are string numbers", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "3", text: "String coords.", bbox: { x: "10", y: "20", width: "100", height: "50" } },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(1);
    expect(result.regions[0].bbox).toBeNull();
  });

  it("accepts floating-point pixel coordinates as valid", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "4", text: "Float coords.", bbox: { x: 10.5, y: 20.25, width: 100.75, height: 50.0 } },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.malformedCount).toBe(0);
    expect(result.regions[0].bbox).toEqual({ x: 10.5, y: 20.25, width: 100.75, height: 50.0 });
  });
});

// ─── Non-array response ───────────────────────────────────────────────────────

describe("benchmarkGeminiRegions — non-array Gemini response", () => {
  it("throws when provider returns an object instead of an array", async () => {
    const provider = makeProvider({ error: "unexpected" });
    await expect(benchmarkGeminiRegions(provider, IMAGE_BASE64)).rejects.toThrow(
      /expected a JSON array/i
    );
  });

  it("throws when provider returns a plain string", async () => {
    const provider = makeProvider("not an array");
    await expect(benchmarkGeminiRegions(provider, IMAGE_BASE64)).rejects.toThrow(
      /expected a JSON array/i
    );
  });

  it("propagates provider errors without wrapping", async () => {
    const provider = makeFailingProvider(new Error("network failure"));
    await expect(benchmarkGeminiRegions(provider, IMAGE_BASE64)).rejects.toThrow(
      "network failure"
    );
  });
});

// ─── Skips items without a valid questionNumber ───────────────────────────────

describe("benchmarkGeminiRegions — invalid items are silently skipped", () => {
  it("skips items missing detectedQuestionNumber", async () => {
    const provider = makeProvider([
      { text: "No question number.", bbox: { x: 0, y: 0, width: 100, height: 50 } },
      { detectedQuestionNumber: "1", text: "Valid.", bbox: { x: 0, y: 60, width: 100, height: 50 } },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].detectedQuestionNumber).toBe("1");
  });

  it("skips items where detectedQuestionNumber is not a string", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: 42, text: "Number key.", bbox: null },
    ]);

    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.regions).toHaveLength(0);
  });

  it("returns empty regions and zero malformedCount for an empty array", async () => {
    const provider = makeProvider([]);
    const result = await benchmarkGeminiRegions(provider, IMAGE_BASE64);

    expect(result.regions).toHaveLength(0);
    expect(result.malformedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 7C: convertPixelToPdfBbox — unit tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertPixelToPdfBbox — pixel to PDF-point conversion", () => {
  it("converts using actual dimensions (square scaling)", () => {
    // A4 at 2×: 595 pt wide → 1190 px wide (scale = 0.5)
    const result = convertPixelToPdfBbox(
      { x: 100, y: 200, width: 400, height: 100 },
      595, 842, 1190, 1684
    );
    expect(result.x).toBeCloseTo(50, 5);
    expect(result.y).toBeCloseTo(100, 5);
    expect(result.width).toBeCloseTo(200, 5);
    expect(result.height).toBeCloseTo(50, 5);
  });

  it("handles non-square scaling (different X and Y scale factors)", () => {
    // imageWidth = 1000px maps to pdfWidth = 500pt → scaleX = 0.5
    // imageHeight = 2000px maps to pdfHeight = 800pt → scaleY = 0.4
    const result = convertPixelToPdfBbox(
      { x: 100, y: 100, width: 200, height: 500 },
      500, 800, 1000, 2000
    );
    expect(result.x).toBeCloseTo(50, 5);      // 100 * 0.5
    expect(result.y).toBeCloseTo(40, 5);      // 100 * 0.4
    expect(result.width).toBeCloseTo(100, 5); // 200 * 0.5
    expect(result.height).toBeCloseTo(200, 5); // 500 * 0.4
  });

  it("produces zero output for zero-origin pixel coords", () => {
    const result = convertPixelToPdfBbox(
      { x: 0, y: 0, width: 0, height: 0 },
      595, 842, 1190, 1684
    );
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it("is exact for 1:1 scale (image and PDF same dimensions)", () => {
    const result = convertPixelToPdfBbox(
      { x: 50, y: 75, width: 300, height: 120 },
      595, 842, 595, 842
    );
    expect(result.x).toBeCloseTo(50, 5);
    expect(result.y).toBeCloseTo(75, 5);
    expect(result.width).toBeCloseTo(300, 5);
    expect(result.height).toBeCloseTo(120, 5);
  });

  it("each axis is independent (width scale does not bleed into height)", () => {
    // scaleX = 2.0, scaleY = 0.5
    const result = convertPixelToPdfBbox(
      { x: 10, y: 10, width: 100, height: 100 },
      1000, 500, 500, 1000
    );
    expect(result.width).toBeCloseTo(200, 5);  // 100 * 2.0
    expect(result.height).toBeCloseTo(50, 5);  // 100 * 0.5
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 7C: benchmarkGeminiRegionsFromRenderedPages
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRenderedPage(overrides: Partial<RenderedPage> = {}): RenderedPage {
  return {
    pageNumber: 1,
    pdfWidth: 595,
    pdfHeight: 842,
    imageWidth: 1190,
    imageHeight: 1684,
    imageBase64: Buffer.from("fake-png").toString("base64"),
    ...overrides,
  };
}

function makeSequentialProvider(...responses: unknown[]): VisionProvider {
  const mock = jest.fn();
  for (const r of responses) mock.mockResolvedValueOnce(r);
  return { analyze: mock };
}

const VALID_GEMINI_REGION = {
  detectedQuestionNumber: "1",
  text: "A variable stores a value.",
  bbox: { x: 50, y: 100, width: 800, height: 120 },
};

// ─── Valid Gemini response ────────────────────────────────────────────────────

describe("benchmarkGeminiRegionsFromRenderedPages — valid response", () => {
  it("returns one page result for a single rendered page", async () => {
    const provider = makeProvider([VALID_GEMINI_REGION]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages).toHaveLength(1);
  });

  it("returns zero totalMalformed for a valid bbox", async () => {
    const provider = makeProvider([VALID_GEMINI_REGION]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.totalMalformed).toBe(0);
    expect(result.pages[0].malformedCount).toBe(0);
  });

  it("populates pixelBbox with the raw Gemini pixel values", async () => {
    const provider = makeProvider([VALID_GEMINI_REGION]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].regions[0].pixelBbox).toEqual(
      { x: 50, y: 100, width: 800, height: 120 }
    );
  });

  it("populates pdfBbox with correctly converted values", async () => {
    // A4 at 2×: scaleX = scaleY = 0.5
    const provider = makeProvider([VALID_GEMINI_REGION]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    const pdf = result.pages[0].regions[0].pdfBbox!;
    expect(pdf.x).toBeCloseTo(25, 5);   // 50 * 0.5
    expect(pdf.y).toBeCloseTo(50, 5);   // 100 * 0.5
    expect(pdf.width).toBeCloseTo(400, 5);  // 800 * 0.5
    expect(pdf.height).toBeCloseTo(60, 5);  // 120 * 0.5
  });

  it("sends the page PNG as base64 to the provider (not a URL)", async () => {
    const page = makeRenderedPage({ imageBase64: "FAKEPNG" });
    const provider = makeProvider([]);
    await benchmarkGeminiRegionsFromRenderedPages(provider, [page]);

    const call = (provider.analyze as jest.Mock).mock.calls[0][0] as VisionAnalysisInput;
    expect(call.image.type).toBe("base64");
    expect((call.image as { data: string }).data).toBe("FAKEPNG");
    expect((call.image as { mediaType: string }).mediaType).toBe("image/png");
  });

  it("uses the REGION_PROMPT (asks for pixel coordinates)", async () => {
    const provider = makeProvider([]);
    await benchmarkGeminiRegionsFromRenderedPages(provider, [makeRenderedPage()]);

    const call = (provider.analyze as jest.Mock).mock.calls[0][0] as VisionAnalysisInput;
    expect(call.prompt).toMatch(/pixel/i);
    expect(call.prompt).toMatch(/bbox/i);
  });
});

// ─── Page metadata preservation ──────────────────────────────────────────────

describe("benchmarkGeminiRegionsFromRenderedPages — page metadata preservation", () => {
  it("preserves pageNumber from the rendered page", async () => {
    const provider = makeProvider([]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage({ pageNumber: 3 })]
    );
    expect(result.pages[0].pageNumber).toBe(3);
  });

  it("preserves pdfWidth and pdfHeight from the rendered page", async () => {
    const provider = makeProvider([]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage({ pdfWidth: 612, pdfHeight: 792 })]
    );
    expect(result.pages[0].pdfWidth).toBe(612);
    expect(result.pages[0].pdfHeight).toBe(792);
  });

  it("preserves imageWidth and imageHeight from the rendered page", async () => {
    const provider = makeProvider([]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage({ imageWidth: 1224, imageHeight: 1584 })]
    );
    expect(result.pages[0].imageWidth).toBe(1224);
    expect(result.pages[0].imageHeight).toBe(1584);
  });
});

// ─── Multiple pages ───────────────────────────────────────────────────────────

describe("benchmarkGeminiRegionsFromRenderedPages — multiple pages", () => {
  it("calls the provider once per rendered page", async () => {
    const pages = [makeRenderedPage({ pageNumber: 1 }), makeRenderedPage({ pageNumber: 2 })];
    const provider = makeSequentialProvider(
      [{ detectedQuestionNumber: "1", text: "Ans 1", bbox: { x: 10, y: 10, width: 500, height: 80 } }],
      [{ detectedQuestionNumber: "2", text: "Ans 2", bbox: { x: 10, y: 10, width: 500, height: 80 } }]
    );

    await benchmarkGeminiRegionsFromRenderedPages(provider, pages);

    expect((provider.analyze as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it("returns results for each page in document order", async () => {
    const pages = [makeRenderedPage({ pageNumber: 1 }), makeRenderedPage({ pageNumber: 2 })];
    const provider = makeSequentialProvider(
      [{ detectedQuestionNumber: "1", text: "Ans 1", bbox: { x: 10, y: 10, width: 500, height: 80 } }],
      [{ detectedQuestionNumber: "3", text: "Ans 3", bbox: { x: 10, y: 10, width: 500, height: 80 } }]
    );

    const result = await benchmarkGeminiRegionsFromRenderedPages(provider, pages);

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].regions[0].detectedQuestionNumber).toBe("1");
    expect(result.pages[1].pageNumber).toBe(2);
    expect(result.pages[1].regions[0].detectedQuestionNumber).toBe("3");
  });

  it("accumulates totalMalformed across pages", async () => {
    const pages = [makeRenderedPage({ pageNumber: 1 }), makeRenderedPage({ pageNumber: 2 })];
    const provider = makeSequentialProvider(
      // page 1: one bad bbox
      [{ detectedQuestionNumber: "1", text: "Bad", bbox: { x: NaN, y: 0, width: 100, height: 50 } }],
      // page 2: one bad bbox
      [{ detectedQuestionNumber: "2", text: "Bad2", bbox: {} }]
    );

    const result = await benchmarkGeminiRegionsFromRenderedPages(provider, pages);

    expect(result.pages[0].malformedCount).toBe(1);
    expect(result.pages[1].malformedCount).toBe(1);
    expect(result.totalMalformed).toBe(2);
  });

  it("uses each page's own dimensions for conversion (non-square scaling)", async () => {
    // Page 1: scaleX = 2.0, scaleY = 0.5
    const page1 = makeRenderedPage({ pageNumber: 1, pdfWidth: 1000, pdfHeight: 500, imageWidth: 500, imageHeight: 1000 });
    // Page 2: scaleX = 0.5, scaleY = 2.0
    const page2 = makeRenderedPage({ pageNumber: 2, pdfWidth: 500, pdfHeight: 1000, imageWidth: 1000, imageHeight: 500 });

    const bbox = { x: 100, y: 100, width: 100, height: 100 };
    const provider = makeSequentialProvider(
      [{ detectedQuestionNumber: "1", text: "p1", bbox }],
      [{ detectedQuestionNumber: "2", text: "p2", bbox }]
    );

    const result = await benchmarkGeminiRegionsFromRenderedPages(provider, [page1, page2]);

    const p1pdf = result.pages[0].regions[0].pdfBbox!;
    const p2pdf = result.pages[1].regions[0].pdfBbox!;

    expect(p1pdf.x).toBeCloseTo(200, 5);   // 100 * (1000/500)
    expect(p1pdf.y).toBeCloseTo(50, 5);    // 100 * (500/1000)
    expect(p2pdf.x).toBeCloseTo(50, 5);    // 100 * (500/1000)
    expect(p2pdf.y).toBeCloseTo(200, 5);   // 100 * (1000/500)
  });

  it("returns empty pages array for zero rendered pages", async () => {
    const provider = makeProvider([]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(provider, []);
    expect(result.pages).toHaveLength(0);
    expect(result.totalMalformed).toBe(0);
    expect((provider.analyze as jest.Mock)).not.toHaveBeenCalled();
  });
});

// ─── Malformed bbox ───────────────────────────────────────────────────────────

describe("benchmarkGeminiRegionsFromRenderedPages — malformed bbox", () => {
  it("counts bbox with NaN coordinate as malformed and sets pdfBbox null", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "1", text: "Bad", bbox: { x: NaN, y: 0, width: 100, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
    expect(result.pages[0].regions[0].pdfBbox).toBeNull();
  });

  it("counts bbox with string coordinates as malformed", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "2", text: "Bad", bbox: { x: "10", y: "20", width: "100", height: "50" } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
    expect(result.pages[0].regions[0].pixelBbox).toBeNull();
  });

  it("counts bbox with missing fields as malformed", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "3", text: "Bad", bbox: { x: 10, y: 20 } }, // missing width/height
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
  });

  it("bbox=null from Gemini is NOT malformed (intentional omission)", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "4", text: "No loc.", bbox: null },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(0);
    expect(result.pages[0].regions[0].pixelBbox).toBeNull();
    expect(result.pages[0].regions[0].pdfBbox).toBeNull();
  });
});

// ─── Bbox outside image bounds ────────────────────────────────────────────────

describe("benchmarkGeminiRegionsFromRenderedPages — bbox outside image bounds", () => {
  it("counts bbox that extends beyond imageWidth as malformed", async () => {
    // imageWidth = 1190; x=100, width=1200 → x+width=1300 > 1190
    const provider = makeProvider([
      { detectedQuestionNumber: "1", text: "OOB-right", bbox: { x: 100, y: 10, width: 1200, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
    expect(result.pages[0].regions[0].pdfBbox).toBeNull();
  });

  it("counts bbox that extends beyond imageHeight as malformed", async () => {
    // imageHeight = 1684; y=1600, height=200 → y+height=1800 > 1684
    const provider = makeProvider([
      { detectedQuestionNumber: "2", text: "OOB-bottom", bbox: { x: 10, y: 1600, width: 100, height: 200 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
    expect(result.pages[0].regions[0].pdfBbox).toBeNull();
  });

  it("preserves pixelBbox even for out-of-bounds bboxes (for debugging)", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "3", text: "OOB debug", bbox: { x: 100, y: 10, width: 1200, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].regions[0].pixelBbox).toEqual(
      { x: 100, y: 10, width: 1200, height: 50 }
    );
  });

  it("counts bbox with negative x as malformed", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "4", text: "Neg-x", bbox: { x: -1, y: 0, width: 100, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
    expect(result.pages[0].regions[0].pdfBbox).toBeNull();
  });

  it("counts bbox with negative y as malformed", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "5", text: "Neg-y", bbox: { x: 0, y: -5, width: 100, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
  });

  it("counts bbox with width zero as malformed", async () => {
    const provider = makeProvider([
      { detectedQuestionNumber: "6", text: "Zero-w", bbox: { x: 10, y: 10, width: 0, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(1);
  });

  it("accepts a bbox touching the image edge exactly (x + width == imageWidth)", async () => {
    // x=190, width=1000, imageWidth=1190 → 190+1000=1190 exactly
    const provider = makeProvider([
      { detectedQuestionNumber: "7", text: "Edge", bbox: { x: 190, y: 10, width: 1000, height: 50 } },
    ]);
    const result = await benchmarkGeminiRegionsFromRenderedPages(
      provider, [makeRenderedPage()]
    );
    expect(result.pages[0].malformedCount).toBe(0);
    expect(result.pages[0].regions[0].pdfBbox).not.toBeNull();
  });
});

// ─── Provider error propagation ───────────────────────────────────────────────

describe("benchmarkGeminiRegionsFromRenderedPages — error propagation", () => {
  it("propagates provider errors", async () => {
    const provider = makeFailingProvider(new Error("quota exceeded"));
    await expect(
      benchmarkGeminiRegionsFromRenderedPages(provider, [makeRenderedPage()])
    ).rejects.toThrow("quota exceeded");
  });

  it("throws when provider returns a non-array", async () => {
    const provider = makeProvider({ unexpected: true });
    await expect(
      benchmarkGeminiRegionsFromRenderedPages(provider, [makeRenderedPage()])
    ).rejects.toThrow(/expected a JSON array/i);
  });
});
