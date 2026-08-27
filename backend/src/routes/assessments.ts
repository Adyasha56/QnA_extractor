import { Router } from "express";
import * as controller from "../controllers/assessmentController";
import { singleFileUpload } from "../middleware/upload";

const router = Router();
const fileUpload = singleFileUpload("file");

router.post("/", controller.createAssessment);
router.get("/:id", controller.getAssessment);
router.post("/:id/question-paper", fileUpload, controller.uploadQuestionPaper);
router.post("/:id/answer-sheet", fileUpload, controller.uploadAnswerSheet);

export default router;
