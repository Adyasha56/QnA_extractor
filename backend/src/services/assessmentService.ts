import { randomUUID } from "crypto";
import { Assessment, CloudinaryAsset } from "../models/assessment";

const store = new Map<string, Assessment>();

function now(): string {
  return new Date().toISOString();
}

function findOrThrow(id: string): Assessment {
  const assessment = store.get(id);
  if (!assessment) {
    throw Object.assign(new Error(`Assessment not found: ${id}`), { statusCode: 404 });
  }
  return assessment;
}

export function createAssessment(): Assessment {
  const assessment: Assessment = {
    id: randomUUID(),
    status: "idle",
    createdAt: now(),
    updatedAt: now(),
  };
  store.set(assessment.id, assessment);
  return assessment;
}

export function getAssessment(id: string): Assessment {
  return findOrThrow(id);
}

export function setQuestionPaper(id: string, asset: CloudinaryAsset): Assessment {
  const assessment = findOrThrow(id);
  assessment.questionPaper = asset;
  assessment.updatedAt = now();
  return assessment;
}

export function setAnswerSheet(id: string, asset: CloudinaryAsset): Assessment {
  const assessment = findOrThrow(id);
  assessment.answerSheet = asset;
  assessment.updatedAt = now();
  return assessment;
}

// Exposed for test isolation only.
export function _clearStore(): void {
  store.clear();
}
