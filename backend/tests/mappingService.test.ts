/**
 * Mapping service tests.
 *
 * Ground-truth scenario (from the Phase 5 spec):
 *   Questions : 1, 2, 3(a), 3(b), 4, 5, 6
 *   Answers   : 1, 2, 4, 3(a), 3(b), 6   (out-of-order; Q5 unanswered)
 *
 * All semantic providers are mocked — no live API calls.
 */
import {
  mapQuestionsToAnswers,
  DIRECT_MATCH_CONFIDENCE,
  DEFAULT_SEMANTIC_THRESHOLD,
  DEFAULT_UNCERTAIN_THRESHOLD,
} from "../src/services/mappingService";
import { Question, Answer } from "../src/models/extraction";
import { SemanticProvider } from "../src/clients/semanticProvider";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const QUESTIONS: Question[] = [
  { id: "q_1",   number: "1",    text: "What is a variable?",      order: 1, sourcePage: 1 },
  { id: "q_2",   number: "2",    text: "Explain TCP vs UDP.",       order: 2, sourcePage: 1 },
  { id: "q_3_a", number: "3(a)", text: "What is an OS?",           order: 3, sourcePage: 1 },
  { id: "q_3_b", number: "3(b)", text: "Give two examples.",        order: 4, sourcePage: 1 },
  { id: "q_4",   number: "4",    text: "What is recursion?",        order: 5, sourcePage: 1 },
  { id: "q_5",   number: "5",    text: "Explain polymorphism.",     order: 6, sourcePage: 1 },
  { id: "q_6",   number: "6",    text: "What is inheritance?",      order: 7, sourcePage: 1 },
];

// Out-of-order: 1, 2, 4, 3(a), 3(b), 6 — Q5 intentionally absent
const ANSWERS: Answer[] = [
  { id: "a_1",  text: "A variable stores data.",              detectedQuestionNumber: "1",    regions: [] },
  { id: "a_2",  text: "TCP is reliable, UDP is fast.",        detectedQuestionNumber: "2",    regions: [] },
  { id: "a_4",  text: "Recursion is self-calling.",           detectedQuestionNumber: "4",    regions: [] },
  { id: "a_3a", text: "OS manages hardware resources.",       detectedQuestionNumber: "3(a)", regions: [] },
  { id: "a_3b", text: "Windows, Linux.",                      detectedQuestionNumber: "3(b)", regions: [] },
  { id: "a_6",  text: "Inheritance is deriving a class.",     detectedQuestionNumber: "6",    regions: [] },
];

function mockSemantic(score: number): SemanticProvider {
  return { score: jest.fn().mockResolvedValue(score) };
}

// ─── Explicit label matching ──────────────────────────────────────────────────

describe("mapQuestionsToAnswers — explicit label matching", () => {
  it("produces 6 mappings for the ground-truth scenario", async () => {
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    expect(mappings).toHaveLength(6);
  });

  it("Q5 is unanswered in the ground-truth scenario", async () => {
    const { unanswered } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0].questionId).toBe("q_5");
    expect(unanswered[0].status).toBe("unanswered");
  });

  it("no unmatched answers in the ground-truth scenario", async () => {
    const { unmatched } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    expect(unmatched).toHaveLength(0);
  });

  it("answer order does not affect the mapping result", async () => {
    const shuffled = [...ANSWERS].reverse();
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, shuffled);
    const ids = mappings.map((m) => m.questionId).sort();
    expect(ids).toEqual(["q_1", "q_2", "q_3_a", "q_3_b", "q_4", "q_6"].sort());
  });

  it("3(a) maps only to q_3_a", async () => {
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    const m = mappings.find((m) => m.answerId === "a_3a");
    expect(m?.questionId).toBe("q_3_a");
  });

  it("3(b) maps only to q_3_b and not q_3_a", async () => {
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    const m = mappings.find((m) => m.answerId === "a_3b");
    expect(m?.questionId).toBe("q_3_b");
    expect(m?.questionId).not.toBe("q_3_a");
  });

  it("direct label match has confidence " + DIRECT_MATCH_CONFIDENCE, async () => {
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    mappings.forEach((m) => expect(m.confidence).toBe(DIRECT_MATCH_CONFIDENCE));
  });

  it("all direct label mappings have status 'answered'", async () => {
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, ANSWERS);
    mappings.forEach((m) => expect(m.status).toBe("answered"));
  });

  it("answer whose label matches no question becomes unmatched", async () => {
    const extra: Answer = {
      id: "a_99",
      text: "Orphan answer.",
      detectedQuestionNumber: "99",
      regions: [],
    };
    const { unmatched } = await mapQuestionsToAnswers(QUESTIONS, [...ANSWERS, extra]);
    expect(unmatched.map((u) => u.answerId)).toContain("a_99");
    expect(unmatched.find((u) => u.answerId === "a_99")?.status).toBe("unmatched");
  });

  it("multi-region answer is mapped by id — all regions are preserved", async () => {
    const multiRegion: Answer = {
      id: "a_1_multi",
      text: "Line one. Line two.",
      detectedQuestionNumber: "1",
      regions: [
        { page: 1, bbox: { x: 0, y: 0, width: 100, height: 12 }, text: "Line one." },
        { page: 2, bbox: { x: 0, y: 0, width: 100, height: 12 }, text: "Line two." },
      ],
    };
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, [multiRegion]);
    const m = mappings.find((m) => m.answerId === "a_1_multi");
    expect(m).toBeDefined();
    expect(m?.questionId).toBe("q_1");
    expect(m?.status).toBe("answered");
  });
});

// ─── Competing / ambiguous labels ────────────────────────────────────────────

describe("mapQuestionsToAnswers — competing labels", () => {
  it("two answers claiming the same number both get status 'uncertain'", async () => {
    const competing: Answer[] = [
      { id: "a_1x", text: "First attempt.", detectedQuestionNumber: "1", regions: [] },
      { id: "a_1y", text: "Second attempt.", detectedQuestionNumber: "1", regions: [] },
    ];
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, competing);
    const uncertain = mappings.filter((m) => m.status === "uncertain");
    expect(uncertain).toHaveLength(2);
    uncertain.forEach((m) => expect(m.questionId).toBe("q_1"));
  });

  it("competing confidence is strictly less than direct match confidence", async () => {
    const competing: Answer[] = [
      { id: "a_1x", text: "First attempt.", detectedQuestionNumber: "1", regions: [] },
      { id: "a_1y", text: "Second attempt.", detectedQuestionNumber: "1", regions: [] },
    ];
    const { mappings } = await mapQuestionsToAnswers(QUESTIONS, competing);
    mappings.forEach((m) => expect(m.confidence).toBeLessThan(DIRECT_MATCH_CONFIDENCE));
  });

  it("competing answers are not also placed in unmatched", async () => {
    const competing: Answer[] = [
      { id: "a_1x", text: "First attempt.", detectedQuestionNumber: "1", regions: [] },
      { id: "a_1y", text: "Second attempt.", detectedQuestionNumber: "1", regions: [] },
    ];
    const { unmatched } = await mapQuestionsToAnswers(QUESTIONS, competing);
    const ids = unmatched.map((u) => u.answerId);
    expect(ids).not.toContain("a_1x");
    expect(ids).not.toContain("a_1y");
  });
});

// ─── Semantic provider ────────────────────────────────────────────────────────

describe("mapQuestionsToAnswers — semantic provider", () => {
  const unlabeled: Answer = { id: "a_ul", text: "Some unlabeled answer.", regions: [] };

  it("calls semantic provider for unlabeled answers", async () => {
    const provider = mockSemantic(0.8);
    await mapQuestionsToAnswers([QUESTIONS[0]], [unlabeled], {
      semanticProvider: provider,
    });
    expect(provider.score).toHaveBeenCalled();
  });

  it("score above semanticThreshold → status 'answered'", async () => {
    const provider = mockSemantic(0.8);
    const { mappings } = await mapQuestionsToAnswers([QUESTIONS[0]], [unlabeled], {
      semanticProvider: provider,
      semanticThreshold: DEFAULT_SEMANTIC_THRESHOLD,
    });
    expect(mappings[0].status).toBe("answered");
    expect(mappings[0].confidence).toBe(0.8);
  });

  it("score between thresholds → status 'uncertain'", async () => {
    const provider = mockSemantic(0.45);
    const { mappings } = await mapQuestionsToAnswers([QUESTIONS[0]], [unlabeled], {
      semanticProvider: provider,
      semanticThreshold: DEFAULT_SEMANTIC_THRESHOLD,
      uncertainThreshold: DEFAULT_UNCERTAIN_THRESHOLD,
    });
    expect(mappings[0].status).toBe("uncertain");
    expect(mappings[0].confidence).toBe(0.45);
  });

  it("score below uncertainThreshold → question is unanswered", async () => {
    const provider = mockSemantic(0.2);
    const { unanswered } = await mapQuestionsToAnswers([QUESTIONS[0]], [unlabeled], {
      semanticProvider: provider,
      semanticThreshold: DEFAULT_SEMANTIC_THRESHOLD,
      uncertainThreshold: DEFAULT_UNCERTAIN_THRESHOLD,
    });
    expect(unanswered[0].questionId).toBe("q_1");
  });

  it("score below uncertainThreshold → unmatched answer is returned", async () => {
    const provider = mockSemantic(0.2);
    const { unmatched } = await mapQuestionsToAnswers([QUESTIONS[0]], [unlabeled], {
      semanticProvider: provider,
      semanticThreshold: DEFAULT_SEMANTIC_THRESHOLD,
      uncertainThreshold: DEFAULT_UNCERTAIN_THRESHOLD,
    });
    expect(unmatched[0].answerId).toBe("a_ul");
    expect(unmatched[0].status).toBe("unmatched");
  });

  it("does NOT call semantic provider when all answers have explicit labels", async () => {
    const provider = mockSemantic(0.9);
    await mapQuestionsToAnswers(QUESTIONS, ANSWERS, { semanticProvider: provider });
    expect(provider.score).not.toHaveBeenCalled();
  });
});

// ─── Invalid / edge-case input ────────────────────────────────────────────────

describe("mapQuestionsToAnswers — edge cases", () => {
  it("empty questions → all answers unmatched, no mappings or unanswered", async () => {
    const result = await mapQuestionsToAnswers([], ANSWERS);
    expect(result.mappings).toHaveLength(0);
    expect(result.unanswered).toHaveLength(0);
    expect(result.unmatched).toHaveLength(ANSWERS.length);
    result.unmatched.forEach((u) => expect(u.status).toBe("unmatched"));
  });

  it("empty answers → all questions unanswered, no mappings or unmatched", async () => {
    const result = await mapQuestionsToAnswers(QUESTIONS, []);
    expect(result.mappings).toHaveLength(0);
    expect(result.unanswered).toHaveLength(QUESTIONS.length);
    expect(result.unmatched).toHaveLength(0);
    result.unanswered.forEach((u) => expect(u.status).toBe("unanswered"));
  });

  it("both empty → completely empty result", async () => {
    const result = await mapQuestionsToAnswers([], []);
    expect(result).toEqual({ mappings: [], unanswered: [], unmatched: [] });
  });

  it("unlabeled answers without a semantic provider become unmatched", async () => {
    const unlabeled: Answer = { id: "a_ul", text: "No label.", regions: [] };
    const { unmatched } = await mapQuestionsToAnswers(QUESTIONS, [unlabeled]);
    expect(unmatched.map((u) => u.answerId)).toContain("a_ul");
  });
});
