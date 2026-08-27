import { Request, Response, NextFunction } from "express";
import { extractQuestions } from "../services/questionExtractor";
import { extractAnswers } from "../services/answerExtractor";
import { buildVisionClientFromEnv } from "../clients/visionClientFactory";
import { OcrPage } from "../models/extraction";

// Build the vision client once at module load.
// Returns null when ANTHROPIC_API_KEY is absent (tests / no-AI mode).
const visionProvider = buildVisionClientFromEnv();

function parseBody(body: unknown): {
  pages: OcrPage[];
  imageUrl?: string;
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp";
} {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).pages)
  ) {
    throw Object.assign(new Error('Request body must include "pages" array.'), {
      statusCode: 400,
    });
  }
  const b = body as Record<string, unknown>;
  return {
    pages: b.pages as OcrPage[],
    imageUrl: typeof b.imageUrl === "string" ? b.imageUrl : undefined,
    imageBase64: typeof b.imageBase64 === "string" ? b.imageBase64 : undefined,
    imageMediaType: (b.imageMediaType as "image/jpeg" | "image/png" | "image/webp") ?? undefined,
  };
}

export async function extractQuestionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { pages, imageUrl, imageBase64, imageMediaType } = parseBody(req.body);
    const questions = await extractQuestions(pages, {
      visionProvider: visionProvider ?? undefined,
      imageUrl,
      imageBase64,
      imageMediaType,
    });
    res.status(200).json({ questions });
  } catch (err) {
    next(err);
  }
}

export async function extractAnswersHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { pages, imageUrl, imageBase64, imageMediaType } = parseBody(req.body);
    const answers = await extractAnswers(pages, {
      visionProvider: visionProvider ?? undefined,
      imageUrl,
      imageBase64,
      imageMediaType,
    });
    res.status(200).json({ answers });
  } catch (err) {
    next(err);
  }
}

export async function extractBothHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const qpPages = Array.isArray(body.questionPaperPages)
      ? (body.questionPaperPages as OcrPage[])
      : [];
    const asPages = Array.isArray(body.answerSheetPages)
      ? (body.answerSheetPages as OcrPage[])
      : [];

    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : undefined;
    const imageMediaType = body.imageMediaType as "image/jpeg" | "image/png" | "image/webp" | undefined;

    const opts = { visionProvider: visionProvider ?? undefined, imageUrl, imageBase64, imageMediaType };

    const [questions, answers] = await Promise.all([
      extractQuestions(qpPages, opts),
      extractAnswers(asPages, opts),
    ]);

    res.status(200).json({ questions, answers });
  } catch (err) {
    next(err);
  }
}
