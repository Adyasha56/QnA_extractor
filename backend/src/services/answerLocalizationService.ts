// Answer region localization: Gemini finds a coarse bbox per answer block,
// OpenCV tightens it, and the result is converted to PDF-point coordinates
// (or pixel coordinates for an image answer sheet — see AnswerSheetSource
// below). Regions are only ever added when both Gemini and OpenCV succeed;
// nothing is fabricated. Multi-page answers accumulate regions across pages.
//
// PDFs are rendered to PNG pages via Python's /render-pages, which reports
// each page's real PDF-point size alongside its pixel size. Images have no
// such render step, so they're wrapped in a single synthetic "page" whose
// pdfWidth/pdfHeight equal the image's own pixel dimensions — making the
// pixel-to-PDF-point conversion below a no-op, so the stored bbox ends up in
// the image's own pixel coordinates.

import { Answer, AnswerRegion } from "../models/extraction";
import { VisionProvider } from "../clients/visionProvider";
import {
  renderPages,
  localizeHandwriting,
  RenderedPage,
} from "../clients/pythonClient";
import { fetchAsBase64 } from "../clients/geminiVisionClient";
import {
  benchmarkGeminiRegionsFromRenderedPages,
  convertPixelToPdfBbox,
} from "./geminiRegionBenchmark";

/** Where the answer sheet's raster pages/image come from. */
export type AnswerSheetSource =
  | { isPdf: true }
  | { isPdf: false; imageWidth: number; imageHeight: number };

function mediaTypeFromMime(mime: string): "image/png" | "image/jpeg" | "image/webp" {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "image/jpeg";
  if (mime.includes("webp")) return "image/webp";
  return "image/png";
}

// Populates Answer.regions for each answer Gemini can locate on the answer
// sheet. Does not mutate the input array.
export async function localizeAnswerRegions(
  answerSheetUrl: string,
  answers: Answer[],
  visionProvider: VisionProvider,
  source: AnswerSheetSource = { isPdf: true }
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

  // Step 1: obtain raster page(s) — real PDF-point pages for a PDF, or a
  // single synthetic page wrapping the raw uploaded image.
  let renderedPages: RenderedPage[];
  let mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png";

  if (source.isPdf) {
    renderedPages = await renderPages(answerSheetUrl);
  } else {
    if (source.imageWidth <= 0 || source.imageHeight <= 0) {
      throw new Error("Cannot localize regions: invalid image dimensions for answer sheet.");
    }
    const { data, mimeType } = await fetchAsBase64(answerSheetUrl);
    mediaType = mediaTypeFromMime(mimeType);
    renderedPages = [
      {
        pageNumber: 1,
        pdfWidth: source.imageWidth,
        pdfHeight: source.imageHeight,
        imageWidth: source.imageWidth,
        imageHeight: source.imageHeight,
        imageBase64: data,
      },
    ];
  }

  // Keep the base64 data accessible by page number for the OpenCV call.
  const renderedByPage = new Map<number, RenderedPage>();
  for (const p of renderedPages) {
    renderedByPage.set(p.pageNumber, p);
  }

  // Step 2: Gemini coarse localization — one call per page.
  const geminiResult = await benchmarkGeminiRegionsFromRenderedPages(
    visionProvider,
    renderedPages,
    mediaType
  );

  // Step 3: tighten each Gemini region with OpenCV, convert to PDF points.
  for (const pageBenchmark of geminiResult.pages) {
    const rendered = renderedByPage.get(pageBenchmark.pageNumber);
    if (!rendered) continue;

    for (const region of pageBenchmark.regions) {
      // No usable bbox — skip rather than fabricate one.
      if (!region.pixelBbox) continue;

      const idx = answerIndexByNumber.get(region.detectedQuestionNumber);
      if (idx === undefined) continue;

      const answer = result[idx];
      if (!answer.text) continue;

      let localized: Awaited<ReturnType<typeof localizeHandwriting>>;
      try {
        localized = await localizeHandwriting(rendered.imageBase64, region.pixelBbox);
      } catch {
        continue;
      }

      // OpenCV found no foreground — skip rather than fabricate a region.
      if (!localized.localizedBbox) continue;

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
