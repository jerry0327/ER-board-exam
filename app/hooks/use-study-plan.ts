"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_STUDY_PLAN_SETTINGS, normalizeStudyPlanSettings, type StudyPlanSettings } from "../lib/study-plan";

const KEY_PREFIX = "em-board-study-plan-v1:";
const SIGNAL_KEY = "em-board-study-plan-signal-v1";

function readSettings(key: string, categories: string[]) {
  try {
    return normalizeStudyPlanSettings(JSON.parse(localStorage.getItem(key) ?? "null"), categories);
  } catch {
    return normalizeStudyPlanSettings(null, categories);
  }
}

export function useStudyPlan(accountKey: string | null, categories: string[]) {
  const [settings, setSettings] = useState<StudyPlanSettings>({ ...DEFAULT_STUDY_PLAN_SETTINGS });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      if (!accountKey) {
        setSettings({ ...DEFAULT_STUDY_PLAN_SETTINGS });
        setReady(false);
        return;
      }
      setSettings(readSettings(`${KEY_PREFIX}${accountKey}`, categories));
      setReady(true);
    });
    const onStorage = (event: StorageEvent) => {
      if (!accountKey || (event.key !== `${KEY_PREFIX}${accountKey}` && event.key !== SIGNAL_KEY)) return;
      setSettings(readSettings(`${KEY_PREFIX}${accountKey}`, categories));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [accountKey, categories]);

  const updateSettings = useCallback((value: StudyPlanSettings) => {
    const next = normalizeStudyPlanSettings(value, categories);
    setSettings(next);
    if (!accountKey) return false;
    try {
      localStorage.setItem(`${KEY_PREFIX}${accountKey}`, JSON.stringify(next));
      localStorage.setItem(SIGNAL_KEY, `${Date.now()}`);
      return true;
    } catch {
      return false;
    }
  }, [accountKey, categories]);

  return { settings, ready, updateSettings };
}
