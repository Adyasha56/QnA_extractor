import { Request, Response, NextFunction } from "express";
import { processAssessment } from "../services/processingService";
import * as assessmentService from "../services/assessmentService";
import { ProcessingStatus } from "../models/assessment";

// Maps each status to a 0-100 progress value and a human-readable message.
// The frontend can use these directly without any additional interpretation.
const PROGRESS: Record<ProcessingStatus, number> = {
  idle: 0,
  uploading: 10,
  processing_question_paper: 25,
  processing_answer_sheet: 55,
  mapping_answers: 80,
  completed: 100,
  failed: 0,
};

const STATUS_MESSAGE: Record<ProcessingStatus, string> = {
  idle: "Waiting to start",
  uploading: "Uploading documents",
  processing_question_paper: "Extracting questions from question paper",
  processing_answer_sheet: "Extracting answers from answer sheet",
  mapping_answers: "Mapping answers to questions",
  completed: "Processing complete",
  failed: "Processing failed",
};

export async function processHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await processAssessment(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function statusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const assessment = assessmentService.getAssessment(req.params.id);
    res.status(200).json({
      assessmentId: assessment.id,
      status: assessment.status,
      progress: PROGRESS[assessment.status],
      message: STATUS_MESSAGE[assessment.status],
      updatedAt: assessment.updatedAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function resultHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const assessment = assessmentService.getAssessment(req.params.id);
    if (!assessment.result) {
      next(
        Object.assign(new Error("Processing result is not available yet"), {
          statusCode: 404,
        })
      );
      return;
    }
    res.status(200).json(assessment.result);
  } catch (err) {
    next(err);
  }
}
