import { Router } from "express";
import { mapHandler } from "../controllers/mappingController";

const router = Router();

// POST /api/map
// Body: { questions: Question[], answers: Answer[] }
// Returns: MappingResult
router.post("/", mapHandler);

export default router;
