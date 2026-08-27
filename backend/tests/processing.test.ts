/**
 * Phase 6 — Full Assessment Processing Pipeline tests.
 *
 * All external services (Python client, extractors, mapping) are mocked.
 * The in-memory assessment store is real so status transitions are observable.
 */
import request from "supertest";
import app from "../src/app";
import {
  _clearStore,
  setQuestionPaper,
  setAnswerSheet,
} from "../src/services/assessmentService";
import { CloudinaryAsset } from "../src/models/assessment";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("../src/clients/pythonClient");
jest.mock("../src/services/questionExtractor");
jest.mock("../src/services/answerExtractor");
jest.mock("../src/services/mappingService");

import { processDocument } from "../src/clients/pythonClient";
import { extractQuestions } from "../src/services/questionExtractor";
import { extractAnswers } from "../src/services/answerExtractor";
import { mapQuestionsToAnswers } from "../src/services/mappingService";

const mockProcessDocument = processDocument as jest.MockedFunction<typeof processDocument>;
const mockExtractQuestions = extractQuestions as jest.MockedFunction<typeof extractQuestions>;
const mockExtractAnswers = extractAnswers as jest.MockedFunction<typeof extractAnswers>;
const mockMapQuestionsToAnswers = mapQuestionsToAnswers as jest.MockedFunction<typeof mapQuestionsToAnswers>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const QUESTION_PAPER_ASSET: CloudinaryAsset = {
  publicId: "question-papers/test/qp",
  secureUrl: "https://res.cloudinary.com/demo/image/upload/qp.pdf",
  resourceType: "image",
  format: "pdf",
  originalFilename: "questions.pdf",
};

const ANSWER_SHEET_ASSET: CloudinaryAsset = {
  publicId: "answer-sheets/test/as",
  secureUrl: "https://res.cloudinary.com/demo/image/upload/as.pdf",
  resourceType: "image",
  format: "pdf",
  originalFilename: "answers.pdf",
};

const MOCK_PAGES = [{ pageNumber: 1, width: 595, height: 842, elements: [] }];

const MOCK_QUESTIONS = [
  { id: "q_1", number: "1", text: "What is a variable?", order: 1, sourcePage: 1 },
];

const MOCK_ANSWERS = [
  {
    id: "a_1",
    text: "A variable stores data.",
    detectedQuestionNumber: "1",
    regions: [{ page: 1, bbox: { x: 10, y: 100, width: 200, height: 20 } }],
  },
];

const MOCK_MAPPING_RESULT = {
  mappings: [{ questionId: "q_1", answerId: "a_1", status: "answered" as const, confidence: 0.98 }],
  unanswered: [],
  unmatched: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an assessment and return its id. */
async function createAssessment(): Promise<string> {
  const res = await request(app).post("/api/assessments").expect(201);
  return res.body.id as string;
}

/** Create an assessment pre-loaded with both documents. */
async function createReadyAssessment(): Promise<string> {
  const id = await createAssessment();
  setQuestionPaper(id, QUESTION_PAPER_ASSET);
  setAnswerSheet(id, ANSWER_SHEET_ASSET);
  return id;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _clearStore();
  // Default happy-path mocks
  mockProcessDocument.mockResolvedValue(MOCK_PAGES);
  mockExtractQuestions.mockResolvedValue(MOCK_QUESTIONS);
  mockExtractAnswers.mockResolvedValue(MOCK_ANSWERS);
  mockMapQuestionsToAnswers.mockResolvedValue(MOCK_MAPPING_RESULT);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── POST /api/assessments/:id/process ────────────────────────────────────────

describe("POST /api/assessments/:id/process — success", () => {
  it("returns 200 with the full result on successful processing", async () => {
    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);

    expect(res.status).toBe(200);
    expect(res.body.assessmentId).toBe(id);
    expect(res.body.questions).toEqual(MOCK_QUESTIONS);
    expect(res.body.answers).toEqual(MOCK_ANSWERS);
    expect(res.body.mappings).toEqual(MOCK_MAPPING_RESULT.mappings);
    expect(res.body.unansweredQuestions).toEqual([]);
    expect(res.body.unmatchedAnswers).toEqual([]);
    expect(res.body.processingStatus).toBe("completed");
  });

  it("calls processDocument twice — once per document", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(mockProcessDocument).toHaveBeenCalledTimes(2);
    expect(mockProcessDocument).toHaveBeenNthCalledWith(
      1,
      QUESTION_PAPER_ASSET.secureUrl
    );
    expect(mockProcessDocument).toHaveBeenNthCalledWith(
      2,
      ANSWER_SHEET_ASSET.secureUrl
    );
  });

  it("passes Python output to extractQuestions and extractAnswers", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(mockExtractQuestions).toHaveBeenCalledWith(
      MOCK_PAGES,
      expect.objectContaining({ imageUrl: QUESTION_PAPER_ASSET.secureUrl })
    );
    expect(mockExtractAnswers).toHaveBeenCalledWith(
      MOCK_PAGES,
      expect.objectContaining({ imageUrl: ANSWER_SHEET_ASSET.secureUrl })
    );
  });

  it("passes extracted questions and answers to mapQuestionsToAnswers", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    expect(mockMapQuestionsToAnswers).toHaveBeenCalledWith(
      MOCK_QUESTIONS,
      MOCK_ANSWERS
    );
  });

  it("stores the result so GET /result returns it", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    expect(res.status).toBe(200);
    expect(res.body.assessmentId).toBe(id);
    expect(res.body.processingStatus).toBe("completed");
  });

  it("preserves answer regions (bounding boxes) in the result", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    expect(res.body.answers[0].regions).toEqual(MOCK_ANSWERS[0].regions);
  });
});

// ─── Error: missing / invalid assessment ──────────────────────────────────────

describe("POST /api/assessments/:id/process — validation errors", () => {
  it("returns 404 when the assessment does not exist", async () => {
    const res = await request(app).post("/api/assessments/nonexistent/process");
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe("string");
  });

  it("returns 400 when question paper has not been uploaded", async () => {
    const id = await createAssessment();
    setAnswerSheet(id, ANSWER_SHEET_ASSET); // only answer sheet

    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/question paper/i);
  });

  it("returns 400 when answer sheet has not been uploaded", async () => {
    const id = await createAssessment();
    setQuestionPaper(id, QUESTION_PAPER_ASSET); // only question paper

    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/answer sheet/i);
  });

  it("returns 400 when neither document has been uploaded", async () => {
    const id = await createAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(400);
  });
});

// ─── Error: downstream failures ───────────────────────────────────────────────

describe("POST /api/assessments/:id/process — downstream failures", () => {
  it("returns 502 when the Python service fails on the question paper", async () => {
    mockProcessDocument.mockRejectedValueOnce(
      Object.assign(new Error("Python down"), { statusCode: 502 })
    );

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(502);
  });

  it("returns 502 when the Python service fails on the answer sheet", async () => {
    // First call succeeds, second fails.
    mockProcessDocument
      .mockResolvedValueOnce(MOCK_PAGES)
      .mockRejectedValueOnce(
        Object.assign(new Error("Python down"), { statusCode: 502 })
      );

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(502);
  });

  it("returns 500 when question extraction throws", async () => {
    mockExtractQuestions.mockRejectedValueOnce(new Error("extraction exploded"));

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(500);
  });

  it("returns 500 when answer extraction throws", async () => {
    mockExtractAnswers.mockRejectedValueOnce(new Error("answer extraction failed"));

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(500);
  });

  it("returns 500 when mapping throws", async () => {
    mockMapQuestionsToAnswers.mockRejectedValueOnce(new Error("mapping failed"));

    const id = await createReadyAssessment();
    const res = await request(app).post(`/api/assessments/${id}/process`);
    expect(res.status).toBe(500);
  });
});

// ─── Status transitions ────────────────────────────────────────────────────────

describe("POST /api/assessments/:id/process — status transitions", () => {
  it("sets status to 'completed' after successful processing", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/status`);
    expect(res.body.status).toBe("completed");
  });

  it("sets status to 'failed' when Python service fails", async () => {
    mockProcessDocument.mockRejectedValueOnce(
      Object.assign(new Error("down"), { statusCode: 502 })
    );

    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`);

    const res = await request(app).get(`/api/assessments/${id}/status`);
    expect(res.body.status).toBe("failed");
  });

  it("sets status to 'failed' when extraction fails", async () => {
    mockExtractQuestions.mockRejectedValueOnce(new Error("boom"));

    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`);

    const res = await request(app).get(`/api/assessments/${id}/status`);
    expect(res.body.status).toBe("failed");
  });

  it("sets status to 'failed' when mapping fails", async () => {
    mockMapQuestionsToAnswers.mockRejectedValueOnce(new Error("boom"));

    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`);

    const res = await request(app).get(`/api/assessments/${id}/status`);
    expect(res.body.status).toBe("failed");
  });
});

// ─── GET /api/assessments/:id/status ──────────────────────────────────────────

describe("GET /api/assessments/:id/status", () => {
  it("returns 200 with status and updatedAt for a known assessment", async () => {
    const id = await createAssessment();
    const res = await request(app).get(`/api/assessments/${id}/status`);

    expect(res.status).toBe(200);
    expect(res.body.assessmentId).toBe(id);
    expect(res.body.status).toBe("idle");
    expect(typeof res.body.updatedAt).toBe("string");
  });

  it("returns 404 for an unknown assessment", async () => {
    const res = await request(app).get("/api/assessments/unknown-id/status");
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/assessments/:id/result ──────────────────────────────────────────

describe("GET /api/assessments/:id/result", () => {
  it("returns 404 when assessment exists but processing has not run", async () => {
    const id = await createAssessment();
    const res = await request(app).get(`/api/assessments/${id}/result`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown assessment", async () => {
    const res = await request(app).get("/api/assessments/unknown-id/result");
    expect(res.status).toBe(404);
  });

  it("returns the stored result after successful processing", async () => {
    const id = await createReadyAssessment();
    await request(app).post(`/api/assessments/${id}/process`).expect(200);

    const res = await request(app).get(`/api/assessments/${id}/result`);
    expect(res.status).toBe(200);
    expect(res.body.assessmentId).toBe(id);
    expect(Array.isArray(res.body.questions)).toBe(true);
    expect(Array.isArray(res.body.answers)).toBe(true);
    expect(Array.isArray(res.body.mappings)).toBe(true);
    expect(Array.isArray(res.body.unansweredQuestions)).toBe(true);
    expect(Array.isArray(res.body.unmatchedAnswers)).toBe(true);
  });
});
