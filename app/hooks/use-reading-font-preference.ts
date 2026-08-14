"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ReadingFontLevel = 0 | 1 | 2;
export type ReadingFontLevelUpdate = ReadingFontLevel | ((current: ReadingFontLevel) => ReadingFontLevel);

export const READING_FONT_PREFERENCE_KEY = "em-board-reading-font-level-v1";
const READING_FONT_PREFERENCE_EVENT = "em-board-reading-font-level-change";
const DEFAULT_READING_FONT_LEVEL: ReadingFontLevel = 1;

let memoryLevel: ReadingFontLevel = DEFAULT_READING_FONT_LEVEL;

function normalizeLevel(value: unknown): ReadingFontLevel {
  return value === 0 || value === 1 || value === 2 ? value : DEFAULT_READING_FONT_LEVEL;
}

function savedLevel(): ReadingFontLevel {
  if (typeof window === "undefined") return memoryLevel;
  try {
    const stored = window.localStorage.getItem(READING_FONT_PREFERENCE_KEY);
    memoryLevel = stored === null ? DEFAULT_READING_FONT_LEVEL : normalizeLevel(Number(stored));
  } catch {
    // The in-memory preference remains usable when storage is unavailable.
  }
  return memoryLevel;
}

/** Shared three-step reading font preference used by every long-form reader. */
export function useReadingFontPreference() {
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === READING_FONT_PREFERENCE_KEY || event.key === null) notify();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(READING_FONT_PREFERENCE_EVENT, notify);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(READING_FONT_PREFERENCE_EVENT, notify);
    };
  }, []);

  const level = useSyncExternalStore(subscribe, savedLevel, () => DEFAULT_READING_FONT_LEVEL);

  const setLevel = useCallback((update: ReadingFontLevelUpdate) => {
    const current = savedLevel();
    const next = normalizeLevel(typeof update === "function" ? update(current) : update);
    memoryLevel = next;
    try {
      window.localStorage.setItem(READING_FONT_PREFERENCE_KEY, String(next));
    } catch {
      // Same-tab consumers still receive the in-memory update below.
    }
    window.dispatchEvent(new Event(READING_FONT_PREFERENCE_EVENT));
  }, []);

  const decrease = useCallback(() => setLevel((current) => normalizeLevel(Math.max(0, current - 1))), [setLevel]);
  const increase = useCallback(() => setLevel((current) => normalizeLevel(Math.min(2, current + 1))), [setLevel]);
  const reset = useCallback(() => setLevel(DEFAULT_READING_FONT_LEVEL), [setLevel]);

  return {
    level,
    setLevel,
    decrease,
    increase,
    reset,
    canDecrease: level > 0,
    canIncrease: level < 2,
  };
}
