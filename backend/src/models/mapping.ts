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

export type MappingResult = {
  mappings: QuestionAnswerMapping[];
  unanswered: UnansweredQuestion[];
  unmatched: UnmatchedAnswer[];
};
