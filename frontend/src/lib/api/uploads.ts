import { apiPostForm } from "./client";
import type { Assessment } from "@/lib/types";

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
