"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { QuestionCard } from "./QuestionCard";
import { UnmatchedAnswersPanel } from "./UnmatchedAnswersPanel";
import type { AssessmentResult } from "@/lib/types";
import type { Selection } from "./selection";

export function QuestionList({
  result,
  activeSelection,
  onSelect,
}: {
  result: AssessmentResult;
  activeSelection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const [expandAll, setExpandAll] = useState(false);

  const mappingByQuestionId = new Map(result.mappings.map((m) => [m.questionId, m]));
  const gradingByQuestionId = new Map((result.grading ?? []).map((g) => [g.questionId, g]));

  const totalScore = (result.grading ?? []).reduce((sum, g) => sum + g.score, 0);
  const totalMaxScore = (result.grading ?? []).reduce((sum, g) => sum + g.maxScore, 0);
  const hasGrading = (result.grading?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="min-w-0 text-sm font-semibold">Extracted Questions (from question paper)</h2>
          {hasGrading && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-xl bg-nav-active px-2.5 py-1">
              <span className="text-sm font-bold text-white">
                {totalScore}/{totalMaxScore}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-white/60">Overall</span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 rounded-full bg-brand-orange-light text-brand-orange hover:bg-brand-orange-light/70 hover:text-brand-orange"
          onClick={() => setExpandAll((v) => !v)}
        >
          {expandAll ? "Collapse All" : "Expand All"}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-1 pb-4">
          {result.questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              mapping={mappingByQuestionId.get(question.id)}
              grading={gradingByQuestionId.get(question.id)}
              isActive={activeSelection?.type === "question" && activeSelection.id === question.id}
              forceOpen={expandAll}
              onSelect={() => onSelect({ type: "question", id: question.id })}
            />
          ))}

          <UnmatchedAnswersPanel
            unmatchedAnswers={result.unmatchedAnswers}
            answers={result.answers}
            activeSelection={activeSelection}
            onSelect={onSelect}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
