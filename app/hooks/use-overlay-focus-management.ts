"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { subscribeToMediaQuery } from "../lib/media-query";

const OVERLAY_FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useMediaQueryMatch(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    return subscribeToMediaQuery(media, sync);
  }, [query]);

  return matches;
}

type OverlayFocusOptions<T extends HTMLElement> = {
  open: boolean;
  panelRef: RefObject<T | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Close a mobile-only overlay if its layout stops being active. */
  dismissWhenMediaQueryStopsMatching?: string;
  initialFocusSelector?: string;
};

/**
 * Shared focus lifecycle for modal sheets and mobile off-canvas drawers.
 *
 * Keeps focus inside the open overlay, supports Escape, closes mobile-only
 * overlays when their breakpoint no longer applies, and returns focus to the
 * control that opened the overlay.
 */
export function useOverlayFocusManagement<T extends HTMLElement>({
  open,
  panelRef,
  triggerRef,
  onClose,
  dismissWhenMediaQueryStopsMatching,
  initialFocusSelector,
}: OverlayFocusOptions<T>) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const activeElement = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null;
    // Some overlays have both toolbar and wide-rail triggers. Preserve the
    // control that actually opened the overlay; the named trigger is the
    // fallback for programmatic opens or when the active control unmounts.
    const fallbackTrigger = triggerRef?.current ?? null;
    const restoreTarget = activeElement ?? fallbackTrigger;
    const media = dismissWhenMediaQueryStopsMatching
      ? window.matchMedia(dismissWhenMediaQueryStopsMatching)
      : null;

    if (media && !media.matches) {
      closeRef.current();
      return;
    }

    const focusableItems = () => [...panel.querySelectorAll<HTMLElement>(OVERLAY_FOCUSABLE_SELECTOR)]
      .filter((item) => item.getAttribute("aria-hidden") !== "true"
        && !item.closest("[inert]")
        && item.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      const initial = initialFocusSelector
        ? panel.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      (initial ?? focusableItems()[0] ?? panel).focus({ preventScroll: true });
    });

    const close = () => closeRef.current();
    const onMediaChange = (event: MediaQueryListEvent) => {
      if (!event.matches) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableItems();
      if (!items.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const unsubscribeMedia = media
      ? subscribeToMediaQuery(media, onMediaChange)
      : () => undefined;
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribeMedia();
      window.removeEventListener("keydown", onKeyDown);
      const visibleRestoreTarget = restoreTarget?.isConnected
        && restoreTarget.getClientRects().length > 0
        ? restoreTarget
        : fallbackTrigger;
      visibleRestoreTarget?.focus({ preventScroll: true });
    };
  }, [dismissWhenMediaQueryStopsMatching, initialFocusSelector, open, panelRef, triggerRef]);
}
