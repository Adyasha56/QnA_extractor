/**
 * Question extractor tests.
 *
 * All fixtures use clean OCR text (simulating typed-PDF PyMuPDF output).
 * The vision provider is mocked — no live API calls are made.
 */
import { extractQuestions, numberToId } from "../src/services/questionExtractor";
import { OcrPage } from "../src/models/extraction";
import { VisionProvider } from "../src/clients/visionProvider";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Single-page, 7 questions matching the benchmark document layout. */
const BENCHMARK_QP_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      // Q1
      { text: "1.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "What is a variable in programming?", bbox: { x: 90, y: 100, width: 200, height: 12 } },
      // Q2
      { text: "2.", bbox: { x: 72, y: 130, width: 15, height: 12 } },
      { text: "Explain the difference between TCP and UDP.", bbox: { x: 90, y: 130, width: 250, height: 12 } },
      // Q3(a) — sub-part immediately after number (canonical format)
      { text: "3(a)", bbox: { x: 72, y: 160, width: 30, height: 12 } },
      { text: "What is an operating system?", bbox: { x: 105, y: 160, width: 180, height: 12 } },
      // Q3(b)
      { text: "3(b)", bbox: { x: 72, y: 190, width: 30, height: 12 } },
      { text: "Give two examples.", bbox: { x: 105, y: 190, width: 120, height: 12 } },
      // Q4
      { text: "4.", bbox: { x: 72, y: 220, width: 15, height: 12 } },
      { text: "What is recursion?", bbox: { x: 90, y: 220, width: 120, height: 12 } },
      // Q5
      { text: "5.", bbox: { x: 72, y: 250, width: 15, height: 12 } },
      { text: "Explain polymorphism.", bbox: { x: 90, y: 250, width: 140, height: 12 } },
      // Q6
      { text: "6.", bbox: { x: 72, y: 280, width: 15, height: 12 } },
      { text: "What is inheritance?", bbox: { x: 90, y: 280, width: 130, height: 12 } },
    ],
  },
];

/** Two-page question paper. */
const TWO_PAGE_QP_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "1.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "What is a variable?", bbox: { x: 90, y: 100, width: 130, height: 12 } },
      { text: "2.", bbox: { x: 72, y: 130, width: 15, height: 12 } },
      { text: "Explain TCP vs UDP.", bbox: { x: 90, y: 130, width: 130, height: 12 } },
    ],
  },
  {
    pageNumber: 2,
    width: 595,
    height: 842,
    elements: [
      { text: "3(a)", bbox: { x: 72, y: 100, width: 30, height: 12 } },
      { text: "What is an OS?", bbox: { x: 105, y: 100, width: 100, height: 12 } },
      { text: "3(b)", bbox: { x: 72, y: 130, width: 30, height: 12 } },
      { text: "Give examples.", bbox: { x: 105, y: 130, width: 90, height: 12 } },
    ],
  },
];

/** Sub-part written as separate elements on the same line: "3. (a) ..." */
const SEPARATED_SUBPART_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "3.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "(a)", bbox: { x: 90, y: 100, width: 20, height: 12 } },
      { text: "What is an operating system?", bbox: { x: 113, y: 100, width: 180, height: 12 } },
    ],
  },
];

/** Roman-numeral sub-parts. */
const ROMAN_SUBPART_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "12(i)", bbox: { x: 72, y: 100, width: 35, height: 12 } },
      { text: "First sub-question.", bbox: { x: 110, y: 100, width: 120, height: 12 } },
      { text: "12(ii)", bbox: { x: 72, y: 130, width: 40, height: 12 } },
      { text: "Second sub-question.", bbox: { x: 115, y: 130, width: 130, height: 12 } },
    ],
  },
];

/** Garbled OCR — deterministic finds nothing, AI fallback needed. */
const GARBLED_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "Ax2-", bbox: { x: 72, y: 100, width: 30, height: 12 } },
      { text: "varia blc", bbox: { x: 105, y: 100, width: 50, height: 12 } },
      { text: "Pgmng?", bbox: { x: 160, y: 100, width: 40, height: 12 } },
    ],
  },
];

/** Mock AI response for 7-question paper. */
const MOCK_AI_QUESTIONS = [
  { number: "1", text: "What is a variable in programming?" },
  { number: "2", text: "Explain the difference between TCP and UDP." },
  { number: "3(a)", text: "What is an operating system?" },
  { number: "3(b)", text: "Give two examples." },
  { number: "4", text: "What is recursion?" },
  { number: "5", text: "Explain polymorphism." },
  { number: "6", text: "What is inheritance?" },
];

function makeMockVisionProvider(response: unknown): VisionProvider {
  return { analyze: jest.fn().mockResolvedValue(response) };
}

// ─── Deterministic extraction ─────────────────────────────────────────────────

describe("extractQuestions — deterministic (typed PDF)", () => {
  it("extracts 7 questions from the benchmark question paper", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    expect(qs).toHaveLength(7);
  });

  it("assigns order 1..7 sequentially", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    qs.forEach((q, i) => expect(q.order).toBe(i + 1));
  });

  it("preserves original question numbers", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    const numbers = qs.map((q) => q.number);
    expect(numbers).toEqual(["1", "2", "3(a)", "3(b)", "4", "5", "6"]);
  });

  it("treats 3(a) and 3(b) as separate questions", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    const threeA = qs.find((q) => q.number === "3(a)");
    const threeB = qs.find((q) => q.number === "3(b)");
    expect(threeA).toBeDefined();
    expect(threeB).toBeDefined();
    expect(threeA!.id).not.toBe(threeB!.id);
  });

  it("preserves question text", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    const q1 = qs.find((q) => q.number === "1");
    expect(q1?.text).toBe("What is a variable in programming?");
  });

  it("sets sourcePage correctly", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    qs.forEach((q) => expect(q.sourcePage).toBe(1));
  });

  it("includes bbox from OCR elements", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    qs.forEach((q) => {
      expect(q.bbox).toBeDefined();
      expect(q.bbox!.width).toBeGreaterThan(0);
      expect(q.bbox!.height).toBeGreaterThan(0);
    });
  });

  it("generates stable IDs from question numbers", async () => {
    const qs = await extractQuestions(BENCHMARK_QP_PAGES);
    expect(qs.find((q) => q.number === "3(a)")?.id).toBe("q_3_a");
    expect(qs.find((q) => q.number === "1")?.id).toBe("q_1");
  });

  it("handles separated sub-part elements on the same line (3. (a))", async () => {
    const qs = await extractQuestions(SEPARATED_SUBPART_PAGES);
    expect(qs).toHaveLength(1);
    expect(qs[0].number).toBe("3(a)");
    expect(qs[0].text).toBe("What is an operating system?");
  });

  it("handles roman-numeral sub-parts 12(i) and 12(ii)", async () => {
    const qs = await extractQuestions(ROMAN_SUBPART_PAGES);
    expect(qs).toHaveLength(2);
    expect(qs[0].number).toBe("12(i)");
    expect(qs[1].number).toBe("12(ii)");
  });

  it("preserves sourcePage for multi-page documents", async () => {
    const qs = await extractQuestions(TWO_PAGE_QP_PAGES);
    const p1 = qs.filter((q) => q.sourcePage === 1);
    const p2 = qs.filter((q) => q.sourcePage === 2);
    expect(p1).toHaveLength(2);
    expect(p2).toHaveLength(2);
  });

  it("returns empty array for empty input", async () => {
    const qs = await extractQuestions([]);
    expect(qs).toEqual([]);
  });

  it("returns empty array when no question patterns are found", async () => {
    const pages: OcrPage[] = [{
      pageNumber: 1, width: 595, height: 842,
      elements: [{ text: "Some random text", bbox: { x: 72, y: 100, width: 100, height: 12 } }],
    }];
    const qs = await extractQuestions(pages);
    expect(qs).toEqual([]);
  });
});

// ─── AI-assisted extraction ──────────────────────────────────────────────────

describe("extractQuestions — AI fallback", () => {
  it("calls vision provider when deterministic finds nothing", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_QUESTIONS);
    const qs = await extractQuestions(GARBLED_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/doc.png",
    });
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    expect(qs).toHaveLength(7);
  });

  it("does NOT call vision provider when deterministic succeeds", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_QUESTIONS);
    await extractQuestions(BENCHMARK_QP_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/doc.png",
    });
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("AI result has correct numbers", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_QUESTIONS);
    const qs = await extractQuestions(GARBLED_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/doc.png",
    });
    expect(qs.map((q) => q.number)).toEqual(["1", "2", "3(a)", "3(b)", "4", "5", "6"]);
  });

  it("AI result has no bbox (AI does not supply coordinates)", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_QUESTIONS);
    const qs = await extractQuestions(GARBLED_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/doc.png",
    });
    qs.forEach((q) => expect(q.bbox).toBeUndefined());
  });

  it("skips malformed AI entries instead of throwing", async () => {
    const provider = makeMockVisionProvider([
      { number: "1", text: "Valid question" },
      { number: 99, text: "Missing string type for number" }, // invalid
      null,
    ]);
    const qs = await extractQuestions(GARBLED_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/doc.png",
    });
    expect(qs).toHaveLength(1);
    expect(qs[0].number).toBe("1");
  });

  it("throws when AI returns non-array", async () => {
    const provider = makeMockVisionProvider({ error: "not an array" });
    await expect(
      extractQuestions(GARBLED_PAGES, {
        visionProvider: provider,
        imageUrl: "http://example.com/doc.png",
      })
    ).rejects.toThrow(/expected a JSON array/i);
  });

  it("does not call AI when no image URL or base64 is provided", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_QUESTIONS);
    const qs = await extractQuestions(GARBLED_PAGES, { visionProvider: provider });
    expect(provider.analyze).not.toHaveBeenCalled();
    expect(qs).toEqual([]);
  });

  it("provider failure propagates as a rejected promise", async () => {
    const provider: VisionProvider = {
      analyze: jest.fn().mockRejectedValue(new Error("Network timeout")),
    };
    await expect(
      extractQuestions(GARBLED_PAGES, {
        visionProvider: provider,
        imageUrl: "http://example.com/doc.png",
      })
    ).rejects.toThrow("Network timeout");
  });
});

// ─── numberToId helper ────────────────────────────────────────────────────────

describe("numberToId", () => {
  it("converts simple number", () => expect(numberToId("1")).toBe("q_1"));
  it("converts sub-part", () => expect(numberToId("3(a)")).toBe("q_3_a"));
  it("converts roman numeral sub-part", () => expect(numberToId("12(ii)")).toBe("q_12_ii"));
});
