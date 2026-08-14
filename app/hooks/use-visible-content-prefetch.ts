"use client";

import { useEffect, useRef, type RefObject } from "react";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Warms only content links that are visible (or nearly visible) inside a
 * scrollable catalog. Pointer/focus handlers remain the immediate fast path;
 * this hook quietly prepares touch and keyboard navigation before activation.
 */
export function useVisibleContentPrefetch(
  containerRef: RefObject<HTMLElement | null>,
  onPrefetch: (key: string) => void,
  watchKey: string,
  enabled = true,
) {
  const prefetchRef = useRef(onPrefetch);

  useEffect(() => {
    prefetchRef.current = onPrefetch;
  }, [onPrefetch]);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;

    const idleWindow = window as IdleWindow;
    const scheduled = new Map<string, { idle: boolean; id: number }>();
    const warmed = new Set<string>();
    let cancelled = false;

    const schedule = (element: Element) => {
      const key = (element as HTMLElement).dataset.contentPrefetch;
      if (!key || warmed.has(key)) return;
      warmed.add(key);

      const run = () => {
        scheduled.delete(key);
        if (!cancelled) prefetchRef.current(key);
      };
      if (idleWindow.requestIdleCallback) {
        const id = idleWindow.requestIdleCallback(run, { timeout: 700 });
        scheduled.set(key, { idle: true, id });
      } else {
        const id = window.setTimeout(run, 80);
        scheduled.set(key, { idle: false, id });
      }
    };

    const elements = [...container.querySelectorAll<HTMLElement>("[data-content-prefetch]")];
    if (typeof IntersectionObserver === "undefined") {
      elements.slice(0, 8).forEach(schedule);
      return () => {
        cancelled = true;
        for (const task of scheduled.values()) {
          if (task.idle) idleWindow.cancelIdleCallback?.(task.id);
          else window.clearTimeout(task.id);
        }
      };
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) schedule(entry.target);
      }
    }, {
      root: container,
      rootMargin: "180px 0px",
      threshold: 0.01,
    });
    elements.forEach((element) => observer.observe(element));

    return () => {
      cancelled = true;
      observer.disconnect();
      for (const task of scheduled.values()) {
        if (task.idle) idleWindow.cancelIdleCallback?.(task.id);
        else window.clearTimeout(task.id);
      }
    };
  }, [containerRef, enabled, watchKey]);
}
