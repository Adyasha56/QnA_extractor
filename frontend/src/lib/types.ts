// ─── Extraction ──────────────────────────────────────────────────────────────
// Mirrors backend/src/models/extraction.ts exactly.

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrElement = {
  text: string;
  bbox: BoundingBox;
};

export type OcrPage = {
  pageNumber: number;
  width: number;
  height: number;
  elements: OcrElement[];
};

/** Structured question extracted from a question paper. */
export type Question = {
  id: string;        // e.g. "q_3_a"
  number: string;    // original label: "1", "3(a)", "12(ii)"
  text: string;
  order: number;     // 1-based sequential position
  sourcePage: number;
  bbox?: BoundingBox; // absent when extracted via AI
};

/** A spatial region belonging to an answer (may span multiple pages). */
export type AnswerRegion = {
  page: number;
  bbox: BoundingBox;
  text?: string;
};

/** Structured answer block extracted from a student answer sheet. */
export type Answer = {
  id: string;
  text: string;
  detectedQuestionNumber?: string;
  regions: AnswerRegion[];
};

// ─── Mapping ─────────────────────────────────────────────────────────────────
// Mirrors backend/src/models/mapping.ts exactly.

export type QuestionAnswerMapping = {
  questionId: string;
  answerId: string;
  status: "answered" | "uncertain";
  confidence: number;
};

export type UnansweredQuestion = {
  questionId: string;
  status: "unanswered";
};

export type UnmatchedAnswer = {
  answerId: string;
  status: "unmatched";
};

// ─── Assessment ───────────────────────────────────────────────────────────────
// Mirrors backend/src/models/assessment.ts exactly.

export type CloudinaryAsset = {
  publicId: string;
  secureUrl: string;
  resourceType: string;
  format: string;
  originalFilename: string;
};

export type ProcessingStatus =
  | "idle"
  | "uploading"
  | "processing_question_paper"
  | "processing_answer_sheet"
  | "mapping_answers"
  | "completed"
  | "failed";

export type Assessment = {
  id: string;
  status: ProcessingStatus;
  createdAt: string;
  updatedAt: string;
  questionPaper?: CloudinaryAsset;
  answerSheet?: CloudinaryAsset;
  result?: AssessmentResult;
};

export type AssessmentResult = {
  assessmentId: string;
  questions: Question[];
  answers: Answer[];
  mappings: QuestionAnswerMapping[];
  unansweredQuestions: UnansweredQuestion[];
  unmatchedAnswers: UnmatchedAnswer[];
  processingStatus: ProcessingStatus;
};

// ─── API response shapes ──────────────────────────────────────────────────────
// Mirrors GET /api/assessments/:id/status response from processingController.ts

export type StatusResponse = {
  assessmentId: string;
  status: ProcessingStatus;
  progress: number;   // 0–100
  message: string;    // human-readable description
  updatedAt: string;  // ISO date string
};
