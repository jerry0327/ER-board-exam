"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ExplanationMode } from "../lib/explanation-mode";
import type { ExplanationPackId } from "../lib/explanation-packs";

const PACK_KEY = "em-board-explanation-pack-v2";
const MODE_KEY = "em-board-explanation-mode-v2";
const PREFERENCE_EVENT = "em-board-explanation-preference-change";
let memoryPack: ExplanationPackId = "original";
let memoryMode: ExplanationMode = "full";

function savedPack(): ExplanationPackId {
  if (typeof window === "undefined") return "original";
  try {
    const value = localStorage.getItem(PACK_KEY) === "concise" ? "concise" : "original";
    memoryPack = value;
    return value;
  } catch {
    return memoryPack;
  }
}

function savedMode(): ExplanationMode {
  if (typeof window === "undefined") return "full";
  try {
    const value = localStorage.getItem(MODE_KEY);
    const mode = value === "quick" || value === "full" || value === "standard" || value === "raw" ? value : "full";
    memoryMode = mode;
    return mode;
  } catch {
    return memoryMode;
  }
}

export function useExplanationPreferences() {
  const subscribe = useCallback((notify: () => void) => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key === PACK_KEY || event.key === MODE_KEY || event.key === null) notify();
    };
    window.addEventListener("storage", syncStorage);
    window.addEventListener(PREFERENCE_EVENT, notify);
    return () => {
      window.removeEventListener("storage", syncStorage);
      window.removeEventListener(PREFERENCE_EVENT, notify);
    };
  }, []);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${savedPack()}:${savedMode()}`,
    () => "original:full",
  );
  const [packValue, modeValue] = snapshot.split(":");
  const packId: ExplanationPackId = packValue === "concise" ? "concise" : "original";
  const mode: ExplanationMode = modeValue === "quick" || modeValue === "standard" || modeValue === "raw" ? modeValue : "full";

  const setPackId = useCallback((value: ExplanationPackId) => {
    memoryPack = value;
    try { localStorage.setItem(PACK_KEY, value); } catch { /* Device-local preference can safely remain in memory. */ }
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }, []);

  const setMode = useCallback((value: ExplanationMode) => {
    memoryMode = value;
    try { localStorage.setItem(MODE_KEY, value); } catch { /* Device-local preference can safely remain in memory. */ }
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }, []);

  const setSelection = useCallback((nextPackId: ExplanationPackId, nextMode: ExplanationMode) => {
    memoryPack = nextPackId;
    memoryMode = nextMode;
    try {
      localStorage.setItem(PACK_KEY, nextPackId);
      localStorage.setItem(MODE_KEY, nextMode);
    } catch {
      // The atomic in-memory snapshot remains available for this session.
    }
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }, []);

  return { packId, mode, setPackId, setMode, setSelection };
}
