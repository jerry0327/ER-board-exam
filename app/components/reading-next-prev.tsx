"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export type ReadingNextPrevVariant = "icons" | "labels" | "titles";

type Props = {
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  className?: string;
  variant?: ReadingNextPrevVariant;
  noun?: string;
  ariaLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
  previousTitle?: string;
  nextTitle?: string;
  previousButtonTitle?: string;
  nextButtonTitle?: string;
};

/** Shared previous/next controls for toolbar, rail, and article-footer layouts. */
export default function ReadingNextPrev({
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  className,
  variant = "labels",
  noun = "篇",
  ariaLabel,
  previousLabel = `上一${noun}`,
  nextLabel = `下一${noun}`,
  previousTitle,
  nextTitle,
  previousButtonTitle,
  nextButtonTitle,
}: Props) {
  const previousAccessibleLabel = previousTitle ? `${previousLabel}：${previousTitle}` : previousLabel;
  const nextAccessibleLabel = nextTitle ? `${nextLabel}：${nextTitle}` : nextLabel;

  return (
    <nav className={className} aria-label={ariaLabel ?? `切換前後${noun}`} data-reading-next-prev-variant={variant}>
      <button type="button" disabled={!canPrevious} aria-label={previousAccessibleLabel} title={previousButtonTitle ?? previousAccessibleLabel} onClick={onPrevious}>
        <ChevronLeft />
        {variant === "labels" && <span>{previousLabel}</span>}
        {variant === "titles" && <span><small>{previousLabel}</small>{previousTitle && <strong>{previousTitle}</strong>}</span>}
      </button>
      <button type="button" disabled={!canNext} aria-label={nextAccessibleLabel} title={nextButtonTitle ?? nextAccessibleLabel} onClick={onNext}>
        {variant === "labels" && <span>{nextLabel}</span>}
        {variant === "titles" && <span><small>{nextLabel}</small>{nextTitle && <strong>{nextTitle}</strong>}</span>}
        <ChevronRight />
      </button>
    </nav>
  );
}
