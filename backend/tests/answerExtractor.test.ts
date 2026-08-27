/**
 * Answer extractor tests.
 *
 * All fixtures use clean OCR text (typed-PDF style).
 * VisionProvider is mocked — no live API calls.
 */
import { extractAnswers } from "../src/services/answerExtractor";
import { OcrPage } from "../src/models/extraction";
import { VisionProvider } from "../src/clients/visionProvider";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Simple two-question answer sheet. */
const BASIC_ANSWER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "1.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "Ans: A variable is a named memory location.", bbox: { x: 90, y: 115, width: 280, height: 12 } },
      { text: "2.", bbox: { x: 72, y: 145, width: 15, height: 12 } },
      { text: "Ans: TCP is reliable; UDP is fast.", bbox: { x: 90, y: 160, width: 230, height: 12 } },
    ],
  },
];

/** Answer sheet where Q4 appears before Q3 (out-of-order). */
const OUT_OF_ORDER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "4.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "Ans: Recursion is a function calling itself.", bbox: { x: 90, y: 115, width: 260, height: 12 } },
      { text: "3.", bbox: { x: 72, y: 145, width: 15, height: 12 } },
      { text: "Ans: An OS manages hardware resources.", bbox: { x: 90, y: 160, width: 240, height: 12 } },
    ],
  },
];

/** Q5 has "Ans:-" but no content after it (blank answer). */
const BLANK_ANSWER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "5.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "Ans:-", bbox: { x: 90, y: 115, width: 40, height: 12 } },
      { text: "6.", bbox: { x: 72, y: 145, width: 15, height: 12 } },
      { text: "Ans: Inheritance is deriving a class.", bbox: { x: 90, y: 160, width: 230, height: 12 } },
    ],
  },
];

/** Answer spans multiple lines → multiple regions. */
const MULTI_LINE_ANSWER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "1.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "Ans: Line one of the answer.", bbox: { x: 90, y: 115, width: 200, height: 12 } },
      { text: "Line two continues here.", bbox: { x: 90, y: 130, width: 180, height: 12 } },
      { text: "Line three ends here.", bbox: { x: 90, y: 145, width: 160, height: 12 } },
    ],
  },
];

/** Two-page answer sheet — regions must record correct page numbers. */
const TWO_PAGE_ANSWER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "1.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "Ans: Page one answer.", bbox: { x: 90, y: 115, width: 150, height: 12 } },
    ],
  },
  {
    pageNumber: 2,
    width: 595,
    height: 842,
    elements: [
      { text: "2.", bbox: { x: 72, y: 100, width: 15, height: 12 } },
      { text: "Ans: Page two answer.", bbox: { x: 90, y: 115, width: 150, height: 12 } },
    ],
  },
];

/** Sub-part answer sections. */
const SUBPART_ANSWER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "3(a)", bbox: { x: 72, y: 100, width: 30, height: 12 } },
      { text: "Ans: An OS manages hardware.", bbox: { x: 105, y: 115, width: 200, height: 12 } },
      { text: "3(b)", bbox: { x: 72, y: 145, width: 30, height: 12 } },
      { text: "Ans: Windows, Linux.", bbox: { x: 105, y: 160, width: 140, height: 12 } },
    ],
  },
];

/** Garbled OCR — no section headers found, AI fallback needed. */
const GARBLED_ANSWER_PAGES: OcrPage[] = [
  {
    pageNumber: 1,
    width: 595,
    height: 842,
    elements: [
      { text: "!1-", bbox: { x: 72, y: 100, width: 20, height: 12 } },
      { text: "varia blc mem0ry", bbox: { x: 95, y: 100, width: 100, height: 12 } },
    ],
  },
];

const MOCK_AI_ANSWERS = [
  { questionNumber: "1", answerText: "A variable is a named memory location." },
  { questionNumber: "2", answerText: "TCP is connection-oriented; UDP is not." },
  { questionNumber: "5", answerText: null },
];

function makeMockVisionProvider(response: unknown): VisionProvider {
  return { analyze: jest.fn().mockResolvedValue(response) };
}

// ─── Deterministic extraction ─────────────────────────────────────────────────

describe("extractAnswers — deterministic", () => {
  it("extracts two answers from a basic answer sheet", async () => {
    const answers = await extractAnswers(BASIC_ANSWER_PAGES);
    expect(answers).toHaveLength(2);
  });

  it("assigns detectedQuestionNumber for each answer", async () => {
    const answers = await extractAnswers(BASIC_ANSWER_PAGES);
    const numbers = answers.map((a) => a.detectedQuestionNumber);
    expect(numbers).toContain("1");
    expect(numbers).toContain("2");
  });

  it("preserves answer text after Ans: prefix", async () => {
    const answers = await extractAnswers(BASIC_ANSWER_PAGES);
    const a1 = answers.find((a) => a.detectedQuestionNumber === "1");
    expect(a1?.text).toBe("A variable is a named memory location.");
  });

  it("handles out-of-order answers without reordering them", async () => {
    const answers = await extractAnswers(OUT_OF_ORDER_PAGES);
    expect(answers).toHaveLength(2);
    expect(answers[0].detectedQuestionNumber).toBe("4");
    expect(answers[1].detectedQuestionNumber).toBe("3");
  });

  it("produces empty text for blank answer (Ans:- with no content)", async () => {
    const answers = await extractAnswers(BLANK_ANSWER_PAGES);
    const a5 = answers.find((a) => a.detectedQuestionNumber === "5");
    expect(a5).toBeDefined();
    expect(a5!.text).toBe("");
  });

  it("still extracts the non-blank answer alongside the blank one", async () => {
    const answers = await extractAnswers(BLANK_ANSWER_PAGES);
    const a6 = answers.find((a) => a.detectedQuestionNumber === "6");
    expect(a6?.text).toBe("Inheritance is deriving a class.");
  });

  it("builds multiple regions for a multi-line answer", async () => {
    const answers = await extractAnswers(MULTI_LINE_ANSWER_PAGES);
    expect(answers).toHaveLength(1);
    expect(answers[0].regions.length).toBeGreaterThanOrEqual(2);
  });

  it("each region has a valid bbox with positive width and height", async () => {
    const answers = await extractAnswers(MULTI_LINE_ANSWER_PAGES);
    for (const region of answers[0].regions) {
      expect(region.bbox.width).toBeGreaterThan(0);
      expect(region.bbox.height).toBeGreaterThan(0);
    }
  });

  it("records correct page number in regions for multi-page documents", async () => {
    const answers = await extractAnswers(TWO_PAGE_ANSWER_PAGES);
    const a1 = answers.find((a) => a.detectedQuestionNumber === "1");
    const a2 = answers.find((a) => a.detectedQuestionNumber === "2");
    expect(a1?.regions[0]?.page).toBe(1);
    expect(a2?.regions[0]?.page).toBe(2);
  });

  it("extracts sub-part sections 3(a) and 3(b) separately", async () => {
    const answers = await extractAnswers(SUBPART_ANSWER_PAGES);
    expect(answers).toHaveLength(2);
    expect(answers.find((a) => a.detectedQuestionNumber === "3(a)")).toBeDefined();
    expect(answers.find((a) => a.detectedQuestionNumber === "3(b)")).toBeDefined();
  });

  it("assigns unique ids to every answer", async () => {
    const answers = await extractAnswers(BASIC_ANSWER_PAGES);
    const ids = answers.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty array for empty page input", async () => {
    const answers = await extractAnswers([]);
    expect(answers).toEqual([]);
  });

  it("returns empty array when no section headers are found", async () => {
    const pages: OcrPage[] = [{
      pageNumber: 1, width: 595, height: 842,
      elements: [{ text: "Some random text here", bbox: { x: 72, y: 100, width: 130, height: 12 } }],
    }];
    const answers = await extractAnswers(pages);
    expect(answers).toEqual([]);
  });
});

// ─── AI-assisted extraction ──────────────────────────────────────────────────

describe("extractAnswers — AI fallback", () => {
  it("calls vision provider when deterministic finds nothing", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_ANSWERS);
    const answers = await extractAnswers(GARBLED_ANSWER_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/sheet.png",
    });
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    expect(answers).toHaveLength(3);
  });

  it("does NOT call vision provider when deterministic succeeds", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_ANSWERS);
    await extractAnswers(BASIC_ANSWER_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/sheet.png",
    });
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("AI result has correct question numbers", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_ANSWERS);
    const answers = await extractAnswers(GARBLED_ANSWER_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/sheet.png",
    });
    const numbers = answers.map((a) => a.detectedQuestionNumber);
    expect(numbers).toEqual(["1", "2", "5"]);
  });

  it("AI result has empty regions (AI supplies no coordinates)", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_ANSWERS);
    const answers = await extractAnswers(GARBLED_ANSWER_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/sheet.png",
    });
    answers.forEach((a) => expect(a.regions).toEqual([]));
  });

  it("null answerText from AI becomes empty string", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_ANSWERS);
    const answers = await extractAnswers(GARBLED_ANSWER_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/sheet.png",
    });
    const a5 = answers.find((a) => a.detectedQuestionNumber === "5");
    expect(a5?.text).toBe("");
  });

  it("skips malformed AI entries without throwing", async () => {
    const provider = makeMockVisionProvider([
      { questionNumber: "1", answerText: "Valid answer" },
      { questionNumber: 99, answerText: "Number not a string" }, // invalid
      null,
    ]);
    const answers = await extractAnswers(GARBLED_ANSWER_PAGES, {
      visionProvider: provider,
      imageUrl: "http://example.com/sheet.png",
    });
    expect(answers).toHaveLength(1);
    expect(answers[0].detectedQuestionNumber).toBe("1");
  });

  it("throws when AI returns a non-array", async () => {
    const provider = makeMockVisionProvider({ error: "unexpected object" });
    await expect(
      extractAnswers(GARBLED_ANSWER_PAGES, {
        visionProvider: provider,
        imageUrl: "http://example.com/sheet.png",
      })
    ).rejects.toThrow(/expected a JSON array/i);
  });

  it("does not call AI when no image URL or base64 is provided", async () => {
    const provider = makeMockVisionProvider(MOCK_AI_ANSWERS);
    const answers = await extractAnswers(GARBLED_ANSWER_PAGES, { visionProvider: provider });
    expect(provider.analyze).not.toHaveBeenCalled();
    expect(answers).toEqual([]);
  });

  it("provider failure propagates as a rejected promise", async () => {
    const provider: VisionProvider = {
      analyze: jest.fn().mockRejectedValue(new Error("Network timeout")),
    };
    await expect(
      extractAnswers(GARBLED_ANSWER_PAGES, {
        visionProvider: provider,
        imageUrl: "http://example.com/sheet.png",
      })
    ).rejects.toThrow("Network timeout");
  });
});
