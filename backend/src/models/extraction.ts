// Shared types for Phase 4: Question and Answer Extraction.
// BoundingBox coordinates are in the PDF/image coordinate system
// (origin top-left, units = PDF points for PDFs, pixels for images).

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Raw page data as returned by the Python document-processing service.
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

// Structured question extracted from a question paper.
export type Question = {
  id: string;       // stable: derived from number, e.g. "q_3_a"
  number: string;   // original label: "1", "3(a)", "12(ii)"
  text: string;
  order: number;    // 1-based sequential position in the document
  sourcePage: number;
  bbox?: BoundingBox; // absent when extracted via AI (no reliable coords)
};

// A spatial region belonging to an answer (may span multiple pages).
export type AnswerRegion = {
  page: number;
  bbox: BoundingBox;
  text?: string;
};

// Structured answer block extracted from a student answer sheet.
export type Answer = {
  id: string;
  text: string;
  detectedQuestionNumber?: string; // handwritten label, if detected
  regions: AnswerRegion[];
};

export type ExtractionResult = {
  questions: Question[];
  answers: Answer[];
};
