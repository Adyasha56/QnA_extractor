/**
 * Phase 8 — end-to-end mocked pipeline test.
 *
 * Covers the full pipeline with localization wired in:
 *   upload/assessment state
 *   → document processing (Python OCR)
 *   → answer extraction (Gemini text)
 *   → region localization (Gemini bbox + OpenCV)
 *   → coordinate conversion (pixel → PDF points)
 *   → mapping
 *   → final stored result
 *
 * All external services are mocked. The in-memory assessment store is real.
 */

import request from "supertest";
import app from "../src/app";
import {
  _clearStore,
  setQuestionPaper,
  setAnswerSheet,
} from "../src/services/assessmentService";
import { CloudinaryAsset } from "../src/models/assessment";
import { Answer } from "../src/models/extraction";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("../src/clients/pythonClient");
jest.mock("../src/services/questionExtractor");
jest.mock("../src/services/answerExtractor");
jest.mock("../src/services/answerLocalizationService");
jest.mock("../src/services/mappingService");
jest.mock("../src/clients/visionClientFactory");
jest.mock("../src/services/gradingService");

import { processDocument } from "../src/clients/pythonClient";
import { extractQuestions } from "../src/services/questionExtractor";
import { extractAnswers } from "../src/services/answerExtractor";
import { localizeAnswerRegions } from "../src/services/answerLocalizationService";
import { mapQuestionsToAnswers } from "../src/services/mappingService";
import { buildVisionClientFromEnv } from "../src/clients/visionClientFactory";
import { gradeAnswers } from "../src/services/gradingService";

const mockProcessDocument = processDocument as jest.MockedFunction<typeof processDocument>;
const mockExtractQuestions = extractQuestions as jest.MockedFunction<typeof extractQuestions>;
const mockExtractAnswers = extractAnswers as jest.MockedFunction<typeof extractAnswers>;
const mockLocalizeAnswerRegions = localizeAnswerRegions as jest.MockedFunction<typeof localizeAnswerRegions>;
const mockMapQuestionsToAnswers = mapQuestionsToAnswers as jest.MockedFunction<typeof mapQuestionsToAnswers>;
const mockBuildVisionClientFromEnv = buildVisionClientFromEnv as jest.MockedFunction<typeof buildVisionClientFromEnv>;
const mockGradeAnswers = gradeAnswers as jest.MockedFunction<typeof gradeAnswers>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const QP_ASSET: CloudinaryAsset = {
  publicId: "question-papers/p8/qp",
  secureUrl: "https://res.cloudinary.com/demo/image/upload/qp.pdf",
  resourceType: "image",
  format: "pdf",
  originalFilename: "questions.pdf",
};

const AS_ASSET: CloudinaryAsset = {
  publicId: "answer-sheets/p8/as",
  secureUrl: "https://res.cloudinary.com/demo/image/upload/as.pdf",
  resourceType: "image",
  format: "pdf",
  originalFilename: "answers.pdf",
};

const MOCK_PAGES = [{ pageNumber: 1, width: 595, height: 842, elements: [] }];

const MOCK_QUESTIONS = [
  { id: "q_1", number: "1", text: "What is a variable?", order: 1, sourcePage: 1 },
  { id: "q_2", number: "2", text: "What is TCP?", order: 2, sourcePage: 1 },
  { id: "q_5", number: "5", text: "What is polymorphism?", order: 5, sourcePage: 1 },
];

/** Answers as returned by extractAnswers — regions empty (AI extraction). */
const EXTRACTED_ANSWERS: Answer[] = [
  { id: "ans_1", text: "A variable stores data.", detectedQuestionNumber: "1", regions: [] },
  { id: "ans_2", text: "TCP is reliable.", detectedQuestionNumber: "2", regions: [] },
  { id: "ans_5", text: "", detectedQuestionNumber: "5", regions: [] }, // blank
];

/** Answers after localization — Q1 and Q2 gain regions; Q5 stays empty (req 13). */
const LOCALIZED_ANSWERS: Answer[] = [
  {
    id: "ans_1",
    text: "A variable stores data.",
    detectedQuestionNumber: "1",
    regions: [{ page: 1, bbox: { x: 55, y: 110, width: 195, height: 40 }, text: "A variable stores data." }],
  },
  {
    id: "ans_2",
    text: "TCP is reliable.",
    detectedQuestionNumber: "2",
    regions: [{ page: 1, bbox: { x: 55, y: 160, width: 195, height: 40 }, text: "TCP is reliable." }],
  },
  { id: "ans_5", text: "", detectedQuestionNumber: "5", regions: [] },
];

const MOCK_MAPPING_RESULT = {
  mappings: [
    { questionId: "q_1", answerId: "ans_1", status: "answered" as const, confidence: 0.98 },
    { questionId: "q_2", answerId: "ans_2", status: "answered" as const, confidence: 0.98 },
  ],
  unanswered: [{ questionId: "q_5", status: "unanswered" as const }],
  unmatched: [{ answerId: "ans_5", status: "unmatched" as const }],
};

const MOCK_VISION_PROVIDER = { analyze: jest.fn() };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createReadyAssessment(): Promise<string> {
  const res = await request(app).post("/api/assessments").expect(201);
  const id = res.body.id as string;
  setQuestionPaper(id, QP_ASSET);
  setAnswerSheet(id, AS_ASSET);
  return id;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearStore();
  jest.clearAllMocks();

  // Vision provider is available (Gemini key present)
  mockBuildVisionClientFromEnv.mockReturnValue(MOCK_VISION_PROVIDER as never);

  mockProcessDocument.mockResolvedValue(MOCK_PAGES);
  mockExtractQuestions.mockResolvedValue(MOCK_QUESTIONS);
  mockExtractAnswers.mockResolvedValue(EXTRACTED_ANSWERS);
  mockLocalizeAnswerRegions.mockResolvedValue(LOCALIZED_ANSWERS);
  mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);
  mockGradeAnswers.mockResolvedValue([]);
});

// ─── Full pipeline success ────────────────────────────────────────────────────

describe("Phase 8 pipeline — success", () => {
  it("returns 200 with the full result", async () => {
    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(200);
    expect(res.body.processingStatus).toBe("completed");
  });

  it("calls localizeAnswerRegions with the answer sheet URL, extracted answers, and a PDF source flag", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    // AS_ASSET.format === "pdf" in this fixture.
    expect(mockLocalizeAnswerRegions).toHaveBeenCalledWith(
      AS_ASSET.secureUrl,
      EXTRACTED_ANSWERS,
      MOCK_VISION_PROVIDER,
      { isPdf: true }
    );
  });

  // Regression: exact-region highlighting must also work for image (JPEG/PNG)
  // answer sheets, not just PDFs — localizeAnswerRegions needs to know it's
  // an image and the image's own pixel dimensions (from the OCR pass, no
  // second fetch) instead of PDF-point page dimensions.
  it("calls localizeAnswerRegions with image dimensions when the answer sheet is not a PDF", async () => {
    const imageAnswerSheet: CloudinaryAsset = { ...AS_ASSET, format: "png" };
    const res = await request(app).post("/api/assessments").expect(201);
    const id = res.body.id as string;
    setQuestionPaper(id, QP_ASSET);
    setAnswerSheet(id, imageAnswerSheet);

    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(mockLocalizeAnswerRegions).toHaveBeenCalledWith(
      imageAnswerSheet.secureUrl,
      EXTRACTED_ANSWERS,
      MOCK_VISION_PROVIDER,
      { isPdf: false, imageWidth: MOCK_PAGES[0].width, imageHeight: MOCK_PAGES[0].height }
    );
  });

  it("passes localized answers (with regions) to the mapping service", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(mockMapQuestionsToAnswers).toHaveBeenCalledWith(
      MOCK_QUESTIONS,
      LOCALIZED_ANSWERS
    );
  });

  it("final result contains answers with PDF-point regions", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    const ans1 = res.body.answers.find((a: Answer) => a.detectedQuestionNumber === "1");
    expect(ans1.regions).toHaveLength(1);
    expect(ans1.regions[0].page).toBe(1);
    expect(typeof ans1.regions[0].bbox.x).toBe("number");
    expect(typeof ans1.regions[0].bbox.y).toBe("number");
    expect(typeof ans1.regions[0].bbox.width).toBe("number");
    expect(typeof ans1.regions[0].bbox.height).toBe("number");
  });

  it("empty answer Q5 has no regions in the final result", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    const ans5 = res.body.answers.find((a: Answer) => a.detectedQuestionNumber === "5");
    expect(ans5.regions).toHaveLength(0);
  });

  it("Q5 is unanswered in mappings because its answer is blank", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    expect(res.body.unansweredQuestions.some(
      (q: { questionId: string }) => q.questionId === "q_5"
    )).toBe(true);
  });

  it("mappings are included in the final result", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    expect(res.body.mappings).toHaveLength(2);
  });
});

// ─── Localization failure is gracefully recovered ─────────────────────────────

describe("Phase 8 pipeline — localization failure recovery", () => {
  it("returns 200 even when localizeAnswerRegions throws", async () => {
    mockLocalizeAnswerRegions.mockRejectedValue(new Error("render service down"));
    // mapping still runs with the unlocalized extracted answers
    mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(200);
  });

  it("falls back to text-only answers (no regions) when localization fails", async () => {
    mockLocalizeAnswerRegions.mockRejectedValue(new Error("render service down"));
    // mapping receives the unlocalized extracted answers
    mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);

    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    // Mapping was called with the original (unlocalized) answers — empty regions
    expect(mockMapQuestionsToAnswers).toHaveBeenCalledWith(
      MOCK_QUESTIONS,
      EXTRACTED_ANSWERS
    );
  });

  // Regression: a silently-swallowed localization failure looks identical to
  // "nothing to highlight" from the teacher's point of view — the result
  // must say why, and say something different for a transient AI issue
  // (worth retrying) vs. a genuine failure.
  it("adds a warning to the result when localization fails with an AI-unavailable error", async () => {
    mockLocalizeAnswerRegions.mockRejectedValue(
      new Error("[429 Too Many Requests] quota exceeded")
    );
    mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(res.body.warnings).toEqual([
      expect.stringMatching(/temporarily rate-limited or overloaded/i),
    ]);
  });

  it("adds a generic warning when localization fails for a non-AI reason", async () => {
    mockLocalizeAnswerRegions.mockRejectedValue(new Error("render service down"));
    mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(res.body.warnings).toEqual([
      "Exact answer-region highlighting could not be computed for this answer sheet.",
    ]);
  });

  it("omits warnings entirely when localization succeeds", async () => {
    mockLocalizeAnswerRegions.mockResolvedValue(LOCALIZED_ANSWERS);
    mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(res.body.warnings).toBeUndefined();
  });
});

// ─── No vision provider → localization skipped ────────────────────────────────

describe("Phase 8 pipeline — no vision provider", () => {
  it("skips localizeAnswerRegions when no vision provider is available", async () => {
    mockBuildVisionClientFromEnv.mockReturnValue(null);

    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(mockLocalizeAnswerRegions).not.toHaveBeenCalled();
  });

  it("still completes successfully with no vision provider", async () => {
    mockBuildVisionClientFromEnv.mockReturnValue(null);
    // mapping receives unlocalized extracted answers
    mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(200);
    expect(res.body.processingStatus).toBe("completed");
  });
});
