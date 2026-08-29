"use client";

import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_SIZE_MB = 10;
const BRICOLAGE = "[font-family:var(--font-bricolage)]";

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export function FileDropCard({
  label,
  highlightWord,
  accept,
  file,
  onSelect,
  onRemove,
}: {
  label: string;
  highlightWord: string;
  accept: string;
  file: File | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(candidate: File | undefined) {
    if (!candidate) return;
    if (candidate.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_SIZE_MB}MB`);
      return;
    }
    setError(null);
    onSelect(candidate);
  }

  if (file) {
    return (
      <Card className="relative flex h-45.25 flex-col items-center justify-center gap-3 rounded-card border-[1.5px] border-dashed border-[#cecece] bg-white p-6 shadow-none">
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-3 top-3 h-7 w-7 rounded-full"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <div className="flex w-full items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500 text-[10px] font-bold text-white">
            {file.type === "application/pdf" ? "PDF" : "IMG"}
          </div>
          <div className="min-w-0">
            <p className={cn(BRICOLAGE, "truncate text-sm font-semibold text-[#303030]")}>{file.name}</p>
            <p className="text-xs text-[rgba(94,94,94,0.55)]">{formatSize(file.size)}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "flex h-45.25 cursor-pointer flex-col items-center justify-center gap-4 rounded-card border-[1.5px] border-dashed border-[#cecece] bg-white p-6 text-center shadow-none transition-colors",
        isDragOver && "border-brand-orange bg-brand-orange-light"
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        handleFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#f3f3f3]">
        <Upload className="h-8 w-8 text-[#303030]" />
      </div>
      <p className={cn(BRICOLAGE, "text-xl font-semibold tracking-[-0.06em] text-[#303030]")}>
        Upload <span className="text-brand-orange">{highlightWord}</span>
      </p>
      <p className={cn(BRICOLAGE, "-mt-2 text-sm tracking-[-0.06em] text-[rgba(94,94,94,0.55)]")}>
        Max {MAX_SIZE_MB}MB
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={label}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </Card>
  );
}
