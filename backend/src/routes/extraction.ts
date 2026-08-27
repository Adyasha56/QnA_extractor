import { Router } from "express";
import {
  extractQuestionsHandler,
  extractAnswersHandler,
  extractBothHandler,
} from "../controllers/extractionController";

const router = Router();

// POST /api/extract/questions
// Body: { pages: OcrPage[], imageUrl?: string }
// Returns: { questions: Question[] }
router.post("/questions", extractQuestionsHandler);

// POST /api/extract/answers
// Body: { pages: OcrPage[], imageUrl?: string }
// Returns: { answers: Answer[] }
router.post("/answers", extractAnswersHandler);

// POST /api/extract
// Body: { questionPaperPages: OcrPage[], answerSheetPages: OcrPage[], imageUrl?: string }
// Returns: { questions: Question[], answers: Answer[] }
router.post("/", extractBothHandler);

export default router;
