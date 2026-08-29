"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { FileDropCard } from "@/components/upload/FileDropCard";
import { createAssessment, startProcessing } from "@/lib/api/assessments";
import { uploadAnswerSheet, uploadQuestionPaper } from "@/lib/api/uploads";
import { ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const BRICOLAGE = "[font-family:var(--font-bricolage)]";

export default function UploadPage() {
  const router = useRouter();
  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bothUploaded = !!questionFile && !!answerFile;

  async function handleStartMapping() {
    if (!questionFile || !answerFile || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const assessment = await createAssessment();
      await Promise.all([
        uploadQuestionPaper(assessment.id, questionFile),
        uploadAnswerSheet(assessment.id, answerFile),
      ]);
      // Kicks off the pipeline server-side; the results page polls status
      // and surfaces a "failed" state there if this rejects.
      startProcessing(assessment.id).catch(() => {});
      router.push(`/assessments/${assessment.id}`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.";
      setError(message);
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell breadcrumb="Exams" showBottomGlow>
      <div className="mx-3 mb-3 flex h-full flex-col items-center justify-center gap-9 overflow-y-auto rounded-[40px] px-4 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className={cn(BRICOLAGE, "text-4xl font-bold leading-[1.2] tracking-[-0.04em] text-[#2b2b2b]")}>
            Upload{" "}
            <span className="rounded-lg bg-[rgba(255,147,80,0.15)] px-2 text-brand-orange">
              Question Paper &amp; Answer Sheets
            </span>
          </h1>
          <p className={cn(BRICOLAGE, "text-xl tracking-[-0.04em] text-[#303030]")}>
            Upload both files to get started
          </p>
        </div>

        <Image src="/lady.svg" alt="" width={138} height={138} className="h-34.5 w-34.5" unoptimized />

        <div className="grid w-full max-w-3xl grid-cols-1 gap-6 rounded-[24px] bg-white/50 p-3 shadow-[0_4px_24px_rgba(0,0,0,0.04)] sm:grid-cols-2">
          <FileDropCard
            label="Question paper"
            highlightWord="Question Paper"
            accept={ACCEPT}
            file={questionFile}
            onSelect={setQuestionFile}
            onRemove={() => setQuestionFile(null)}
          />
          <FileDropCard
            label="Answer sheet"
            highlightWord="Answer Sheet"
            accept={ACCEPT}
            file={answerFile}
            onSelect={setAnswerFile}
            onRemove={() => setAnswerFile(null)}
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            disabled={!bothUploaded || isSubmitting}
            onClick={handleStartMapping}
            className={cn(
              BRICOLAGE,
              "flex items-center gap-2 rounded-[64px] border-2 border-[rgba(255,255,255,0.15)] bg-[#303030] py-3 pl-6 pr-5 text-sm font-medium tracking-[-0.04em] text-white transition-opacity",
              !bothUploaded || isSubmitting ? "opacity-25" : "opacity-100 hover:opacity-90"
            )}
          >
            {isSubmitting ? "Starting…" : "Start Mapping"}
            {!isSubmitting && <ArrowRight className="h-5 w-5" />}
          </button>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className={cn(BRICOLAGE, "text-sm tracking-[-0.06em] text-[rgba(94,94,94,0.8)]")}>
              Once both files are uploaded, you&apos;ll able to map answers with questions
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
