"use client";

import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from "react";

export const READING_SWIPE_THRESHOLD = 78;
export const READING_SWIPE_DIRECTION_RATIO = 1.45;

export const READING_NAVIGATION_EXCLUSION_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "dialog",
  "[role='dialog']",
  "[contenteditable='true']",
  "pre",
  ".table-scroll",
  ".katex",
  ".katex-display",
  ".flow-sequence",
  ".flow-tree",
  ".decision-tree",
  ".question-media",
  ".selection-action-bar",
  ".annotation-panel",
  ".reading-variant-selector",
  "[data-reading-navigation-ignore]",
].join(", ");

type SwipeStart = {
  x: number;
  y: number;
  target: Element | null;
};

export type ReadingNavigationOptions = {
  onPrevious: () => void;
  onNext: () => void;
  canPrevious?: boolean;
  canNext?: boolean;
  enabled?: boolean;
  /** Additional interactive regions that must never trigger page navigation. */
  exclusionSelector?: string;
};

export type ReadingNavigationHandlers = {
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
};

function hasExpandedSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function hasOpenDialog() {
  return Boolean(document.querySelector("dialog[open], [role='dialog'][aria-modal='true']"));
}

function excludedTarget(target: Element | null, additionalSelector?: string) {
  if (!target) return false;
  if (target.closest(READING_NAVIGATION_EXCLUSION_SELECTOR)) return true;
  if (!additionalSelector) return false;
  try {
    return Boolean(target.closest(additionalSelector));
  } catch {
    // A malformed optional selector must not break the reader. The shared
    // baseline exclusions above remain in effect.
    return false;
  }
}

/**
 * Shared previous/next behavior for long-form readers.
 *
 * Arrow keys and horizontal touch gestures intentionally use the same guards:
 * controls, dialogs, horizontally scrollable Markdown regions, annotations,
 * and active text selections always keep ownership of the interaction.
 * Feature-specific interactive regions can opt out without extending this
 * hook by adding the stable `data-reading-navigation-ignore` attribute.
 */
export function useReadingNavigation({
  onPrevious,
  onNext,
  canPrevious = true,
  canNext = true,
  enabled = true,
  exclusionSelector,
}: ReadingNavigationOptions): ReadingNavigationHandlers {
  const swipeStartRef = useRef<SwipeStart | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      if (hasOpenDialog() || excludedTarget(target, exclusionSelector) || hasExpandedSelection()) return;

      const previous = event.key === "ArrowLeft";
      if ((previous && !canPrevious) || (!previous && !canNext)) return;
      event.preventDefault();
      if (previous) onPrevious();
      else onNext();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrevious, enabled, exclusionSelector, onNext, onPrevious]);

  const onTouchStart = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    if (!enabled || event.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      target: event.target instanceof Element ? event.target : null,
    };
  }, [enabled]);

  const onTouchEnd = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!enabled || !start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const endTarget = event.target instanceof Element ? event.target : null;
    if (hasOpenDialog() || excludedTarget(start.target, exclusionSelector) || excludedTarget(endTarget, exclusionSelector) || hasExpandedSelection()) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < READING_SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * READING_SWIPE_DIRECTION_RATIO) return;

    const previous = deltaX > 0;
    if ((previous && !canPrevious) || (!previous && !canNext)) return;
    if (previous) onPrevious();
    else onNext();
  }, [canNext, canPrevious, enabled, exclusionSelector, onNext, onPrevious]);

  const onTouchCancel = useCallback(() => {
    swipeStartRef.current = null;
  }, []);

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
