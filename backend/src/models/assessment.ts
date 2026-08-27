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
};
