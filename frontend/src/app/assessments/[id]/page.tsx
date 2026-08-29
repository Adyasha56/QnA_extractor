"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingState } from "@/components/LoadingState";
import { QuestionList } from "@/components/results/QuestionList";
import { AnswerViewer } from "@/components/results/AnswerViewer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getAssessment, getResult, getStatus, startProcessing } from "@/lib/api/assessments";
import { getPages } from "@/lib/api/pages";
import type { Assessment, AssessmentError, AssessmentResult, PageImage } from "@/lib/types";
import type { Selection } from "@/components/results/selection";
import { selectionKeyOf } from "@/components/results/selection";
import { WarningsBanner } from "@/components/results/WarningsBanner";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

const POLL_INTERVAL_MS = 1500;

type Phase = "polling" | "done" | "failed";

export default function AssessmentResultsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [phase, setPhase] = useState<Phase>("polling");
  const [statusMessage, setStatusMessage] = useState("This may take a while");
  const [errorInfo, setErrorInfo] = useState<AssessmentError | undefined>(undefined);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [pageImages, setPageImages] = useState<PageImage[] | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const [activeSelection, setActiveSelection] = useState<Selection>(null);
  const [activeTab, setActiveTab] = useState<"questions" | "answers">("questions");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const status = await getStatus(id);
        if (cancelled) return;
        setStatusMessage(status.message);

        if (status.status === "completed") {
          const [fullAssessment, fullResult] = await Promise.all([getAssessment(id), getResult(id)]);
          if (cancelled) return;
          setAssessment(fullAssessment);
          setResult(fullResult);

          if (fullAssessment.answerSheet?.format === "pdf") {
            const pages = await getPages(id, "answer");
            if (!cancelled) setPageImages(pages);
          }
          setPhase("done");
        } else if (status.status === "failed") {
          setErrorInfo(status.error);
          setPhase("failed");
        } else {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setPhase("failed");
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, retryAttempt]);

  function handleRetry() {
    setPhase("polling");
    setStatusMessage("Retrying…");
    setErrorInfo(undefined);
    startProcessing(id).catch(() => {});
    setRetryAttempt((n) => n + 1);
  }

  function handleSelect(selection: Selection) {
    setActiveSelection(selection);
    setActiveTab("answers");
  }

  if (phase === "polling") {
    return (
      <AppShell breadcrumb="Exams">
        <LoadingState message={statusMessage} />
      </AppShell>
    );
  }

  if (phase === "failed" || !result || !assessment) {
    const isAiUnavailable = errorInfo?.code === "ai_unavailable";
    return (
      <AppShell breadcrumb="Exams">
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertTriangle className="h-8 w-8 text-score-amber" />
          <p className="text-lg font-semibold">
            {isAiUnavailable ? "AI service temporarily unavailable" : "Processing failed"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {errorInfo?.message ??
              "Something went wrong while extracting this assessment. Please try uploading again."}
          </p>
          {isAiUnavailable && (
            <Button onClick={handleRetry} className="mt-2">
              Try again
            </Button>
          )}
        </div>
      </AppShell>
    );
  }

  const activeAnswer = resolveActiveAnswer(activeSelection, result);
  const activeRegions = activeAnswer?.regions ?? [];
  const activeQuestion =
    activeSelection?.type === "question"
      ? result.questions.find((q) => q.id === activeSelection.id)
      : undefined;

  let emptyStateMessage: string | undefined;
  if (activeSelection && !activeAnswer) {
    emptyStateMessage = "No answer found for this question.";
  } else if (activeAnswer && activeRegions.length === 0) {
    emptyStateMessage = "Exact location unavailable for this answer.";
  }

  const isPdfAnswerSheet = assessment.answerSheet?.format === "pdf";

  return (
    <AppShell breadcrumb="Exams">
      <div className="flex h-full flex-col gap-3 p-4">
        {result.warnings && result.warnings.length > 0 && (
          <WarningsBanner warnings={result.warnings} />
        )}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "questions" | "answers")}
          className="shrink-0 md:hidden"
        >
          <TabsList className="w-full">
            <TabsTrigger value="questions" className="flex-1">
              Questions
            </TabsTrigger>
            <TabsTrigger value="answers" className="flex-1">
              Answer Sheet
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className={cn("min-h-0", activeTab === "questions" ? "block" : "hidden", "md:block")}>
            <QuestionList result={result} activeSelection={activeSelection} onSelect={handleSelect} />
          </div>

          <div className={cn("min-h-0", activeTab === "answers" ? "block" : "hidden", "md:block")}>
            <AnswerViewer
              pageImages={isPdfAnswerSheet ? pageImages : null}
              imageUrl={assessment.answerSheet?.secureUrl ?? ""}
              regions={activeRegions}
              activeLabel={activeQuestion ? `Q${activeQuestion.number}` : undefined}
              emptyStateMessage={emptyStateMessage}
              selectionKey={selectionKeyOf(activeSelection)}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function resolveActiveAnswer(selection: Selection, result: AssessmentResult) {
  if (!selection) return undefined;
  if (selection.type === "answer") {
    return result.answers.find((a) => a.id === selection.id);
  }
  const mapping = result.mappings.find((m) => m.questionId === selection.id);
  if (!mapping) return undefined;
  return result.answers.find((a) => a.id === mapping.answerId);
}
