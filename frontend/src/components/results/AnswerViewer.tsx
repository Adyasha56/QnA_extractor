"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnswerRegionOverlay } from "./AnswerRegionOverlay";
import type { AnswerRegion, PageImage } from "@/lib/types";

export function AnswerViewer({
  pageImages,
  imageUrl,
  regions,
  activeLabel,
  emptyStateMessage,
  selectionKey,
}: {
  pageImages: PageImage[] | null;
  imageUrl: string;
  regions: AnswerRegion[];
  activeLabel?: string;
  emptyStateMessage?: string;
  selectionKey: string | null;
}) {
  const totalPages = pageImages ? pageImages.length : 1;
  const [currentPage, setCurrentPage] = useState(1);
  const [regionIndex, setRegionIndex] = useState(0);
  const [zoom, setZoom] = useState(100);

  // Jump to the first region's page whenever the active selection changes.
  useEffect(() => {
    if (regions.length > 0) {
      setRegionIndex(0);
      setCurrentPage(regions[0].page);
    } else {
      setCurrentPage(1);
    }
  }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function goToRegion(index: number) {
    const clamped = Math.max(0, Math.min(index, regions.length - 1));
    setRegionIndex(clamped);
    setCurrentPage(regions[clamped].page);
  }

  const regionsOnPage = regions.filter((r) => r.page === currentPage);
  const activeIndexOnPage = regionsOnPage.indexOf(regions[regionIndex]);

  const currentPageImage = pageImages?.find((p) => p.pageNumber === currentPage) ?? pageImages?.[0];
  const imageSrc = currentPageImage
    ? `data:image/png;base64,${currentPageImage.imageBase64}`
    : imageUrl;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-card border bg-black shadow-md">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black px-4 py-3 text-white">
        <span className="text-sm font-semibold">Answer Sheet</span>

        <div className="flex items-center gap-3">
          {regions.length > 1 && (
            <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-white hover:bg-white/10"
                onClick={() => goToRegion(regionIndex - 1)}
                disabled={regionIndex === 0}
                aria-label="Previous region"
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span>
                Region {regionIndex + 1} of {regions.length}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-white hover:bg-white/10"
                onClick={() => goToRegion(regionIndex + 1)}
                disabled={regionIndex === regions.length - 1}
                aria-label="Next region"
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/10"
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              aria-label="Zoom out"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-10 text-center text-xs">{zoom}%</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/10"
              onClick={() => setZoom((z) => Math.min(200, z + 10))}
              aria-label="Zoom in"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-1 text-xs">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-white hover:bg-white/10"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-white hover:bg-white/10"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-6">
        {emptyStateMessage && regions.length === 0 && (
          <div className="mx-auto mb-4 max-w-md rounded-lg bg-white/90 px-4 py-2 text-center text-sm text-muted-foreground shadow">
            {emptyStateMessage}
          </div>
        )}
        <div className="mx-auto" style={{ width: `${zoom}%` }}>
          <AnswerRegionOverlay
            imageSrc={imageSrc}
            unitWidth={currentPageImage?.pdfWidth}
            unitHeight={currentPageImage?.pdfHeight}
            regions={regionsOnPage}
            activeRegionIndex={activeIndexOnPage}
            activeLabel={activeLabel}
          />
        </div>
      </div>
    </div>
  );
}
