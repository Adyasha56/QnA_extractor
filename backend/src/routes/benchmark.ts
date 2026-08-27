import { Router } from "express";
import {
  regionBenchmarkHandler,
  renderedRegionBenchmarkHandler,
} from "../controllers/benchmarkController";

const router = Router();

// POST /api/benchmark/regions
// Body: { imageUrl: string } | { imageBase64: string, imageMediaType?: string }
// Returns Gemini's raw region output + validated regions + malformedCount.
router.post("/regions", regionBenchmarkHandler);

// POST /api/benchmark/rendered-regions
// Body: { answerSheetUrl: string }
// Python renders each PDF page → Gemini receives PNG → pixel bbox + PDF-point bbox.
router.post("/rendered-regions", renderedRegionBenchmarkHandler);

export default router;
