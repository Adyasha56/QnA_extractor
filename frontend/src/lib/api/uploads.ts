import { apiPostForm } from "./client";
import type { Assessment } from "@/lib/types";

/**
 * POST /api/assessments/:id/question-paper
 * Uploads a PDF file as the question paper for the given assessment.
 * Returns the updated Assessment object.
 */
export function uploadQuestionPaper(
  assessmentId: string,
  file: File
): Promise<Assessment> {
  const form = new FormData();
  form.append("file", file);
  return apiPostForm<Assessment>(
    `/api/assessments/${assessmentId}/question-paper`,
    form
  );
}

/**
 * POST /api/assessments/:id/answer-sheet
 * Uploads a PDF file as the answer sheet for the given assessment.
 * Returns the updated Assessment object.
 */
export function uploadAnswerSheet(
  assessmentId: string,
  file: File
): Promise<Assessment> {
  const form = new FormData();
  form.append("file", file);
  return apiPostForm<Assessment>(
    `/api/assessments/${assessmentId}/answer-sheet`,
    form
  );
}
