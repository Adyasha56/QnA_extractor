import { apiGet, apiPost } from "./client";
import type {
  Assessment,
  AssessmentResult,
  StatusResponse,
} from "@/lib/types";

export function createAssessment(): Promise<Assessment> {
  return apiPost<Assessment>("/api/assessments");
}

export function getAssessment(id: string): Promise<Assessment> {
  return apiGet<Assessment>(`/api/assessments/${id}`);
}

export function getStatus(id: string): Promise<StatusResponse> {
  return apiGet<StatusResponse>(`/api/assessments/${id}/status`);
}

export function startProcessing(id: string): Promise<AssessmentResult> {
  return apiPost<AssessmentResult>(`/api/assessments/${id}/process`);
}

export function getResult(id: string): Promise<AssessmentResult> {
  return apiGet<AssessmentResult>(`/api/assessments/${id}/result`);
}
