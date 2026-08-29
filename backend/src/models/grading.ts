// Best-effort AI grading — optional, may be absent (no API key, call failure).

export type QuestionGrading = {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  feedback: string;
};

export type GradingResult = {
  grading: QuestionGrading[];
};
