"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import type { Answer, UnmatchedAnswer } from "@/lib/types";
import type { Selection } from "./selection";

export function UnmatchedAnswersPanel({
  unmatchedAnswers,
  answers,
  activeSelection,
  onSelect,
}: {
  unmatchedAnswers: UnmatchedAnswer[];
  answers: Answer[];
  activeSelection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(false);

  if (unmatchedAnswers.length === 0) return null;

  const answerById = new Map(answers.map((a) => [a.id, a]));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-card border bg-card p-4 shadow-sm">
      <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold">
          Unmatched answers on this sheet
          <Badge variant="secondary" className="ml-2 bg-muted text-muted-foreground">
            {unmatchedAnswers.length}
          </Badge>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Content found on the answer sheet that couldn&apos;t be confidently matched to any question.
        </p>
        {unmatchedAnswers.map(({ answerId }) => {
          const answer = answerById.get(answerId);
          if (!answer) return null;
          const isActive = activeSelection?.type === "answer" && activeSelection.id === answerId;
          return (
            <button
              key={answerId}
              type="button"
              onClick={() => onSelect({ type: "answer", id: answerId })}
              className={cn(
                "rounded-xl border p-3 text-left text-sm transition-colors",
                isActive ? "border-brand-orange ring-1 ring-brand-orange" : "border-transparent bg-muted/60 hover:bg-muted"
              )}
            >
              {answer.detectedQuestionNumber && (
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  Labeled &quot;{answer.detectedQuestionNumber}&quot; — no matching question
                </p>
              )}
              <p className="line-clamp-2 text-muted-foreground">{answer.text}</p>
            </button>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
