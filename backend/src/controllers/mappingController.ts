import { Request, Response, NextFunction } from "express";
import { mapQuestionsToAnswers } from "../services/mappingService";

export async function mapHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { questions, answers } = req.body;

    if (!Array.isArray(questions) || !Array.isArray(answers)) {
      next(
        Object.assign(new Error("questions and answers must be arrays"), {
          statusCode: 400,
        })
      );
      return;
    }

    // Deterministic label matching only — no semantic provider wired at this
    // layer. Callers that need semantic matching invoke the service directly.
    const result = await mapQuestionsToAnswers(questions, answers);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
