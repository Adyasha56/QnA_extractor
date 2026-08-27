import { Request, Response, NextFunction } from "express";
import { processAssessment } from "../services/processingService";
import * as assessmentService from "../services/assessmentService";

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
