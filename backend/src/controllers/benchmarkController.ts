import { Request, Response, NextFunction } from "express";
import { buildVisionClientFromEnv } from "../clients/visionClientFactory";
import { VisionImageSource } from "../clients/visionProvider";
import { renderPages } from "../clients/pythonClient";
import {
  benchmarkGeminiRegions,
  benchmarkGeminiRegionsFromRenderedPages,
} from "../services/geminiRegionBenchmark";

/**
 * POST /api/benchmark/regions
 *
 * Body (one of):
 *   { "imageUrl": "https://..." }
 *   { "imageBase64": "<base64>", "imageMediaType": "image/png" }
 *
 * Returns the raw Gemini region output plus validation summary for inspection.
 * Requires GEMINI_API_KEY to be set. Returns 503 if no provider is available.
 */
export async function regionBenchmarkHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provider = buildVisionClientFromEnv();
    if (!provider) {
      res
        .status(503)
        .json({ error: "No vision provider available. Set GEMINI_API_KEY." });
      return;
    }

    const body = req.body as Record<string, unknown>;

    let image: VisionImageSource;

    if (typeof body.imageUrl === "string") {
      image = { type: "url", url: body.imageUrl };
    } else if (typeof body.imageBase64 === "string") {
      const mediaType =
        (body.imageMediaType as "image/jpeg" | "image/png" | "image/webp") ??
        "image/png";
      image = { type: "base64", data: body.imageBase64, mediaType };
    } else {
      res.status(400).json({
        error: 'Provide either "imageUrl" or "imageBase64" in the request body.',
      });
      return;
    }

    const result = await benchmarkGeminiRegions(provider, image);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/benchmark/rendered-regions
 *
 * Body: { "answerSheetUrl": "https://..." }
 *
 * Flow:
 *   1. Python /render-pages renders each PDF page to PNG with known dimensions.
 *   2. Each PNG is sent to Gemini (base64, not raw PDF).
 *   3. Gemini pixel bboxes are converted to PDF-point coordinates.
 *
 * Returns per-page regions with both pixel and PDF-point bboxes for inspection.
 * Requires GEMINI_API_KEY. Returns 503 if no provider is available.
 */
export async function renderedRegionBenchmarkHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provider = buildVisionClientFromEnv();
    if (!provider) {
      res
        .status(503)
        .json({ error: "No vision provider available. Set GEMINI_API_KEY." });
      return;
    }

    const body = req.body as Record<string, unknown>;

    if (typeof body.answerSheetUrl !== "string" || !body.answerSheetUrl.trim()) {
      res.status(400).json({
        error: '"answerSheetUrl" (string) is required in the request body.',
      });
      return;
    }

    const renderedPages = await renderPages(body.answerSheetUrl);
    const result = await benchmarkGeminiRegionsFromRenderedPages(provider, renderedPages);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
