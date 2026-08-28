import { apiGet, apiPost } from "./client";
import type {
  Assessment,
  AssessmentResult,
  StatusResponse,
} from "@/lib/types";

/** POST /api/assessments — create a new assessment, returns the Assessment object. */
export function createAssessment(): Promise<Assessment> {
  return apiPost<Assessment>("/api/assessments");
}

/** GET /api/assessments/:id */
export function getAssessment(id: string): Promise<Assessment> {
  return apiGet<Assessment>(`/api/assessments/${id}`);
}

/** GET /api/assessments/:id/status */
export function getStatus(id: string): Promise<StatusResponse> {
  return apiGet<StatusResponse>(`/api/assessments/${id}/status`);
}

/** POST /api/assessments/:id/process — start the extraction + mapping pipeline. */
export function startProcessing(id: string): Promise<AssessmentResult> {
  return apiPost<AssessmentResult>(`/api/assessments/${id}/process`);
}

/** GET /api/assessments/:id/result */
export function getResult(id: string): Promise<AssessmentResult> {
  return apiGet<AssessmentResult>(`/api/assessments/${id}/result`);
}
