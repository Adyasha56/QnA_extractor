"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AnswerRegion } from "@/lib/types";

// Region bbox units: PDF points (unitWidth/unitHeight passed by caller) for a
// PDF page, or pixels of the loaded image itself (unitWidth/unitHeight
// omitted, read from naturalWidth/naturalHeight) for an image answer sheet.
export function AnswerRegionOverlay({
  imageSrc,
  unitWidth,
  unitHeight,
  regions,
  activeRegionIndex,
  activeLabel,
}: {
  imageSrc: string;
  unitWidth?: number;
  unitHeight?: number;
  regions: AnswerRegion[];
  activeRegionIndex: number;
  activeLabel?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleImageLoad() {
    const img = imgRef.current;
    if (img) setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
  }

  const effectiveUnitWidth = unitWidth ?? naturalSize.width;
  const effectiveUnitHeight = unitHeight ?? naturalSize.height;

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageSrc}
        alt="Answer sheet page"
        className="block w-full h-auto select-none"
        draggable={false}
        onLoad={handleImageLoad}
      />

      {size.width > 0 &&
        effectiveUnitWidth > 0 &&
        effectiveUnitHeight > 0 &&
        regions.map((region, i) => {
          const isActive = i === activeRegionIndex;
          const left = (region.bbox.x / effectiveUnitWidth) * size.width;
          const top = (region.bbox.y / effectiveUnitHeight) * size.height;
          const width = (region.bbox.width / effectiveUnitWidth) * size.width;
          const height = (region.bbox.height / effectiveUnitHeight) * size.height;

          return (
            <div
              key={i}
              className={cn(
                "absolute rounded-lg border-2 transition-colors",
                isActive
                  ? "z-10 border-score-green bg-score-green/10"
                  : "z-0 border-transparent"
              )}
              style={{ left, top, width, height }}
            >
              {isActive && activeLabel && (
                <span className="absolute -top-6 left-0 rounded-md bg-score-green px-2 py-0.5 text-xs font-semibold text-white">
                  {activeLabel}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
}
