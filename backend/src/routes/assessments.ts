import { Router } from "express";
import * as controller from "../controllers/assessmentController";
import * as processingController from "../controllers/processingController";
import { getPages } from "../controllers/pagesController";
import { singleFileUpload } from "../middleware/upload";

const router = Router();
const fileUpload = singleFileUpload("file");

router.post("/", controller.createAssessment);
router.get("/:id", controller.getAssessment);
router.post("/:id/question-paper", fileUpload, controller.uploadQuestionPaper);
router.post("/:id/answer-sheet", fileUpload, controller.uploadAnswerSheet);
router.post("/:id/process", processingController.processHandler);
router.get("/:id/status", processingController.statusHandler);
router.get("/:id/result", processingController.resultHandler);
router.get("/:id/pages", getPages);

export default router;
