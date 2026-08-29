// ─── Extraction ──────────────────────────────────────────────────────────────

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

export type Question = {
  id: string;
  number: string;
  text: string;
  order: number;
  sourcePage: number;
  bbox?: BoundingBox;
};

export type AnswerRegion = {
  page: number;
  bbox: BoundingBox;
  text?: string;
};

export type Answer = {
  id: string;
  text: string;
  detectedQuestionNumber?: string;
  regions: AnswerRegion[];
};

// ─── Mapping ─────────────────────────────────────────────────────────────────

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

export type AssessmentError = {
  message: string;
  code: "ai_unavailable" | "unknown";
};

export type Assessment = {
  id: string;
  status: ProcessingStatus;
  createdAt: string;
  updatedAt: string;
  questionPaper?: CloudinaryAsset;
  answerSheet?: CloudinaryAsset;
  result?: AssessmentResult;
  error?: AssessmentError;
};

export type AssessmentResult = {
  assessmentId: string;
  questions: Question[];
  answers: Answer[];
  mappings: QuestionAnswerMapping[];
  unansweredQuestions: UnansweredQuestion[];
  unmatchedAnswers: UnmatchedAnswer[];
  processingStatus: ProcessingStatus;
  /** Best-effort AI grading. Absent/empty when ungraded — not an error state. */
  grading?: QuestionGrading[];
  /** Notes about features that degraded during processing but didn't fail it. */
  warnings?: string[];
};

// ─── Grading ─────────────────────────────────────────────────────────────────

export type QuestionGrading = {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  feedback: string;
};

// ─── Rendered pages ────────────────────────────────────────────────────────────
// Only used for PDF documents — images are shown via their Cloudinary
// secureUrl directly, no rendering involved.

export type PageImage = {
  pageNumber: number;
  /** Same unit as AnswerRegion.bbox. */
  pdfWidth: number;
  pdfHeight: number;
  imageWidth: number;
  imageHeight: number;
  imageBase64: string;
};

// ─── API response shapes ──────────────────────────────────────────────────────

export type StatusResponse = {
  assessmentId: string;
  status: ProcessingStatus;
  progress: number;
  message: string;
  updatedAt: string;
  error?: AssessmentError;
};
