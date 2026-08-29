"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || warnings.length === 0) return null;

  return (
    <div className="flex shrink-0 items-start gap-3 rounded-2xl border border-score-amber/30 bg-score-amber/10 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-score-amber" />
      <div className="min-w-0 flex-1 text-sm">
        {warnings.map((w, i) => (
          <p key={i} className="text-foreground/80">
            {w}
          </p>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
