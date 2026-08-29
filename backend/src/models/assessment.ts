import { Question, Answer } from "./extraction";
import { QuestionAnswerMapping, UnansweredQuestion, UnmatchedAnswer } from "./mapping";
import { QuestionGrading } from "./grading";

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

export type AssessmentResult = {
  assessmentId: string;
  questions: Question[];
  answers: Answer[];
  mappings: QuestionAnswerMapping[];
  unansweredQuestions: UnansweredQuestion[];
  unmatchedAnswers: UnmatchedAnswer[];
  processingStatus: ProcessingStatus;
  /** Best-effort AI grading. Absent when ungraded — not an error state. */
  grading?: QuestionGrading[];
  /** Notes about features that degraded during processing but didn't fail it. */
  warnings?: string[];
};

export type AssessmentError = {
  message: string;
  /** "ai_unavailable" — rate-limited/overloaded, worth retrying shortly. "unknown" — a real failure. */
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
  /** Set when status is "failed", describing why. */
  error?: AssessmentError;
};
