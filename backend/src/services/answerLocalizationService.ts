/**
 * Phase 8 — answer region localization.
 *
 * Responsibility boundaries (req 16):
 *   Gemini     → coarse pixel bbox per answer block (via benchmarkGeminiRegionsFromRenderedPages)
 *   OpenCV     → visual tightening (via Python /localize/handwriting)
 *   Python     → page rendering (via /render-pages)
 *   convertPixelToPdfBbox → pixel → PDF-point conversion
 *   mappingService → question-answer association (unchanged, separate)
 *
 * Guarantees:
 *   - Answer.regions always use PDF-point coordinates (req 4).
 *   - Gemini raw pixel bbox is never used directly as a final region (req 5).
 *   - Regions are never fabricated (req 6).
 *   - No Gemini bbox → answer keeps empty regions, pipeline continues (req 7).
 *   - No OpenCV foreground → region is NOT added (req 8).
 *   - Empty-text answers receive no regions (req 13).
 *   - Multi-page answers accumulate regions across pages (req 9).
 *   - Does NOT modify answer text, question numbers, or mapping (req 1, 15).
 */

import { Answer, AnswerRegion } from "../models/extraction";
import { VisionProvider } from "../clients/visionProvider";
import {
  renderPages,
  localizeHandwriting,
  RenderedPage,
} from "../clients/pythonClient";
import {
  benchmarkGeminiRegionsFromRenderedPages,
  convertPixelToPdfBbox,
} from "./geminiRegionBenchmark";

/**
 * Populate Answer.regions for each answer that Gemini can locate on the
 * rendered answer sheet pages.
 *
 * @param answerSheetUrl  Cloudinary URL of the answer-sheet PDF.
 * @param answers         Answers from extractAnswers() — regions may be empty.
 * @param visionProvider  An initialised Gemini (or compatible) vision provider.
 * @returns               A new array of Answers with regions populated where
 *                        Gemini + OpenCV succeeded.  Input array is not mutated.
 */
export async function localizeAnswerRegions(
  answerSheetUrl: string,
  answers: Answer[],
  visionProvider: VisionProvider
): Promise<Answer[]> {
  // Shallow-clone so we never mutate the caller's array or region lists.
  const result: Answer[] = answers.map((a) => ({ ...a, regions: [...a.regions] }));

  // Build lookup: detectedQuestionNumber → index in result.
  // Multi-page answers share the same answer object — we append all regions to it.
  const answerIndexByNumber = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    const a = result[i];
    if (a.detectedQuestionNumber) {
      answerIndexByNumber.set(a.detectedQuestionNumber, i);
    }
  }

  // Step 1: Render all PDF pages to PNG.
  const renderedPages = await renderPages(answerSheetUrl);

  // Keep the base64 data accessible by page number for the OpenCV call.
  const renderedByPage = new Map<number, RenderedPage>();
  for (const p of renderedPages) {
    renderedByPage.set(p.pageNumber, p);
  }

  // Step 2: Gemini coarse localization — one call per page.
  const geminiResult = await benchmarkGeminiRegionsFromRenderedPages(
    visionProvider,
    renderedPages
  );

  // Step 3: For each Gemini region with a usable pixelBbox:
  //   a. Find the matching answer.
  //   b. Call OpenCV to tighten the bbox within the Gemini window.
  //   c. Convert the OpenCV pixel bbox → PDF-point coordinates.
  //   d. Append the AnswerRegion to the answer.
  for (const pageBenchmark of geminiResult.pages) {
    const rendered = renderedByPage.get(pageBenchmark.pageNumber);
    if (!rendered) continue;

    for (const region of pageBenchmark.regions) {
      // Gemini supplied no usable bbox — skip, do not fabricate (req 5, 7).
      if (!region.pixelBbox) continue;

      // No matching answer for this question number — skip.
      const idx = answerIndexByNumber.get(region.detectedQuestionNumber);
      if (idx === undefined) continue;

      const answer = result[idx];

      // Empty-text answer must not receive a region (req 13).
      if (!answer.text) continue;

      // Step b: OpenCV visual tightening.
      let localized: Awaited<ReturnType<typeof localizeHandwriting>>;
      try {
        localized = await localizeHandwriting(rendered.imageBase64, region.pixelBbox);
      } catch {
        // OpenCV call failed — do not fabricate a region (req 6, 8).
        continue;
      }

      // OpenCV found no foreground — do not fabricate a region (req 8).
      if (!localized.localizedBbox) continue;

      // Step c: pixel → PDF-point conversion using the actual page dimensions.
      const pdfBbox = convertPixelToPdfBbox(
        localized.localizedBbox,
        rendered.pdfWidth,
        rendered.pdfHeight,
        rendered.imageWidth,
        rendered.imageHeight
      );

      const answerRegion: AnswerRegion = {
        page: pageBenchmark.pageNumber,
        bbox: pdfBbox,
        text: region.text || undefined,
      };

      answer.regions.push(answerRegion);
    }
  }

  return result;
}
