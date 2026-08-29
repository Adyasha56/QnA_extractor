import { Request, Response, NextFunction } from "express";
import * as assessmentService from "../services/assessmentService";
import { renderPages } from "../clients/pythonClient";

// GET /api/assessments/:id/pages?doc=question|answer
// Passthrough to document-service's /render-pages — same render already used
// by answerLocalizationService.ts, so bbox coordinates line up with what's
// shown. PDF documents only; images use their Cloudinary secureUrl directly.
export async function getPages(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const doc = req.query.doc;

    if (doc !== "question" && doc !== "answer") {
      throw Object.assign(
        new Error('Query param "doc" must be "question" or "answer".'),
        { statusCode: 400 }
      );
    }

    const assessment = assessmentService.getAssessment(id);
    const asset = doc === "question" ? assessment.questionPaper : assessment.answerSheet;

    if (!asset) {
      throw Object.assign(
        new Error(`No ${doc} document has been uploaded for this assessment.`),
        { statusCode: 400 }
      );
    }

    if (asset.format !== "pdf") {
      throw Object.assign(
        new Error(
          `Page rendering only applies to PDF documents; this ${doc} document is a ${asset.format} image. Use its secureUrl directly.`
        ),
        { statusCode: 400 }
      );
    }

    const pages = await renderPages(asset.secureUrl);
    res.status(200).json({ pages });
  } catch (err) {
    next(err);
  }
}
