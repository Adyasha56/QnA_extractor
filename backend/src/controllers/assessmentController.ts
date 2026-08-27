import { Request, Response, NextFunction } from "express";
import * as assessmentService from "../services/assessmentService";
import { uploadToCloudinary } from "../clients/cloudinaryClient";

export async function createAssessment(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const assessment = assessmentService.createAssessment();
    res.status(201).json(assessment);
  } catch (err) {
    next(err);
  }
}

export async function getAssessment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const assessment = assessmentService.getAssessment(req.params.id);
    res.status(200).json(assessment);
  } catch (err) {
    next(err);
  }
}

export async function uploadQuestionPaper(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw Object.assign(new Error("No file provided. Use field name: file."), {
        statusCode: 400,
      });
    }
    const { id } = req.params;
    assessmentService.getAssessment(id); // verify assessment exists before uploading
    const asset = await uploadToCloudinary(
      req.file.buffer,
      `question-papers/${id}`,
      req.file.originalname
    );
    const assessment = assessmentService.setQuestionPaper(id, asset);
    res.status(200).json(assessment);
  } catch (err) {
    next(err);
  }
}

export async function uploadAnswerSheet(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw Object.assign(new Error("No file provided. Use field name: file."), {
        statusCode: 400,
      });
    }
    const { id } = req.params;
    assessmentService.getAssessment(id); // verify assessment exists before uploading
    const asset = await uploadToCloudinary(
      req.file.buffer,
      `answer-sheets/${id}`,
      req.file.originalname
    );
    const assessment = assessmentService.setAnswerSheet(id, asset);
    res.status(200).json(assessment);
  } catch (err) {
    next(err);
  }
}
