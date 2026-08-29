import { apiGet } from "./client";
import type { PageImage } from "@/lib/types";

// Only call for PDF documents — image-type documents render their
// Cloudinary secureUrl directly instead.
export async function getPages(
  assessmentId: string,
  doc: "question" | "answer"
): Promise<PageImage[]> {
  const res = await apiGet<{ pages: PageImage[] }>(
    `/api/assessments/${assessmentId}/pages?doc=${doc}`
  );
  return res.pages;
}
