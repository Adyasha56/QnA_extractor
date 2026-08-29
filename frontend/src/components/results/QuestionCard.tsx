"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { Question, QuestionAnswerMapping, QuestionGrading } from "@/lib/types";

function parseNumber(number: string): { base: string; sub: string | null } {
  const match = number.match(/^(\d+)\s*\(([^)]+)\)$/);
  if (!match) return { base: number, sub: null };
  return { base: match[1], sub: match[2] };
}

function StatusBadge({
  mapping,
  grading,
}: {
  mapping: QuestionAnswerMapping | undefined;
  grading: QuestionGrading | undefined;
}) {
  if (!mapping) {
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground">
        Not answered
      </Badge>
    );
  }

  const tone = mapping.status === "uncertain" ? "amber" : "green";
  const toneClasses =
    tone === "amber"
      ? "bg-score-amber/15 text-score-amber"
      : "bg-score-green/15 text-score-green";

  if (grading) {
    return (
      <Badge className={cn("font-semibold", toneClasses)}>
        {grading.score}/{grading.maxScore}
      </Badge>
    );
  }

  return (
    <Badge className={toneClasses}>
      {mapping.status === "uncertain" ? "Uncertain match" : "Answered"}
    </Badge>
  );
}

export function QuestionCard({
  question,
  mapping,
  grading,
  isActive,
  forceOpen = false,
  onSelect,
}: {
  question: Question;
  mapping: QuestionAnswerMapping | undefined;
  grading: QuestionGrading | undefined;
  isActive: boolean;
  /** "Expand All" override — shows the feedback/status body regardless of selection. */
  forceOpen?: boolean;
  onSelect: () => void;
}) {
  const { base, sub } = parseNumber(question.number);
  const canExpand = !!mapping;
  const open = isActive || forceOpen;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-card border bg-card p-4 text-left shadow-sm transition-all",
        isActive
          ? "border-brand-orange ring-1 ring-brand-orange shadow-md"
          : "border-transparent hover:shadow-md"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-nav-active text-xs font-semibold text-white">
            {base}
          </span>
          {sub && <span className="text-sm font-medium text-muted-foreground">{sub}.</span>}
        </div>

        <p className="min-w-0 flex-1 text-sm leading-snug">{question.text}</p>

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge mapping={mapping} grading={grading} />
          {canExpand && (
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
            />
          )}
        </div>
      </div>

      {open && grading && (
        <div className="mt-3 rounded-xl bg-muted p-3">
          <p className="mb-1 text-xs font-semibold">AI Feedback</p>
          <p className="text-sm text-muted-foreground">{grading.feedback}</p>
        </div>
      )}

      {open && mapping && mapping.status === "uncertain" && !grading && (
        <p className="mt-2 text-xs text-score-amber">
          Low-confidence match — please double-check this answer.
        </p>
      )}

      {open && !mapping && (
        <p className="mt-2 text-xs text-muted-foreground">No answer found for this question.</p>
      )}
    </button>
  );
}
