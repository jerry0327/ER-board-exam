"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export type ReadingVariantPreferenceNamespace = "tintinalli" | "rosens" | "ems" | "goldfrank";

export const READING_VARIANT_PREFERENCE_KEYS: Record<ReadingVariantPreferenceNamespace, string> = {
  tintinalli: "em-board-guide-preferences-v2",
  rosens: "em-board-rosens-guide-preferences-v2",
  ems: "em-board-ems-guide-preferences-v2",
  goldfrank: "em-board-goldfrank-guide-preferences-v1",
};

type Options<T> = {
  namespace: ReadingVariantPreferenceNamespace;
  defaultValue: T;
  deserialize: (stored: string | null) => T;
  serialize: (value: T) => string;
};

type Result<T> = {
  value: T;
  setValue: Dispatch<SetStateAction<T>>;
  ready: boolean;
};

/**
 * Shared device-local persistence lifecycle for long-form reading variants.
 * Each textbook keeps its own key so choosing a Rosen's depth never overwrites
 * the Tintinalli edition/depth selection (or the question reader preference).
 */
export function useNamespacedReadingVariantPreference<T>({
  namespace,
  defaultValue,
  deserialize,
  serialize,
}: Options<T>): Result<T> {
  const [value, setValue] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);
  const storageKey = READING_VARIANT_PREFERENCE_KEYS[namespace];

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      let next = defaultValue;
      try {
        next = deserialize(window.localStorage.getItem(storageKey));
      } catch {
        // The default remains usable when storage is unavailable or invalid.
      }
      if (!active) return;
      setValue(next);
      setReady(true);
    });
    return () => { active = false; };
  }, [defaultValue, deserialize, storageKey]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(storageKey, serialize(value));
    } catch {
      // The in-memory selection remains active for this session.
    }
  }, [ready, serialize, storageKey, value]);

  return { value, setValue, ready };
}
