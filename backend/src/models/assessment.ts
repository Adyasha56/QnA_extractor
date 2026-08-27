import { Question, Answer } from "./extraction";
import { QuestionAnswerMapping, UnansweredQuestion, UnmatchedAnswer } from "./mapping";

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
};

export type Assessment = {
  id: string;
  status: ProcessingStatus;
  createdAt: string;
  updatedAt: string;
  questionPaper?: CloudinaryAsset;
  answerSheet?: CloudinaryAsset;
  result?: AssessmentResult;
};
