"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RegionalDisasterCourse } from "../lib/remoc-course-data";
import {
  buildRemocCourseCompletionRecord,
  normalizeRemocCourseCompletionRecords,
  remocCourseCompletionKey,
  summarizeRemocCourseProgress,
  type RemocCourseCompletionRecord,
} from "../lib/remoc-course-progress";

const KEY_PREFIX = "em-board-remoc-course-progress-v1:";
const PROGRESS_EVENT = "em-board-remoc-course-progress-change";
const MEMORY_SCOPE = "__memory__";
const EMPTY_RECORDS: Record<string, RemocCourseCompletionRecord> = {};

function readRecords(accountKey: string) {
  try {
    return normalizeRemocCourseCompletionRecords(JSON.parse(localStorage.getItem(`${KEY_PREFIX}${accountKey}`) ?? "{}"));
  } catch {
    return {};
  }
}

export function useRemocCourseProgress(accountKey: string | null) {
  const [records, setRecords] = useState<Record<string, RemocCourseCompletionRecord>>({});
  const [loadedScope, setLoadedScope] = useState("");
  const recordsRef = useRef(records);
  const loadedScopeRef = useRef(loadedScope);
  const scope = accountKey ?? MEMORY_SCOPE;
  const ready = loadedScope === scope;

  const applyRecords = useCallback((next: Record<string, RemocCourseCompletionRecord>) => {
    const requestedScope = accountKey ?? MEMORY_SCOPE;
    if (loadedScopeRef.current !== requestedScope) return false;
    const normalized = normalizeRemocCourseCompletionRecords(next);
    recordsRef.current = normalized;
    setRecords(normalized);
    if (!accountKey) return true;
    try {
      localStorage.setItem(`${KEY_PREFIX}${accountKey}`, JSON.stringify(normalized));
      window.dispatchEvent(new Event(PROGRESS_EVENT));
    } catch {
      // The current view still keeps the course record for this session.
    }
    return true;
  }, [accountKey]);

  useEffect(() => {
    let active = true;
    const refresh = (event?: StorageEvent) => {
      if (!accountKey || (event && event.key !== `${KEY_PREFIX}${accountKey}`)) return;
      const next = readRecords(accountKey);
      recordsRef.current = next;
      setRecords(next);
    };
    void Promise.resolve().then(() => {
      if (!active) return;
      if (accountKey) refresh();
      else {
        recordsRef.current = {};
        setRecords({});
      }
      loadedScopeRef.current = scope;
      setLoadedScope(scope);
    });
    const onStorage = (event: StorageEvent) => refresh(event);
    const onLocalChange = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(PROGRESS_EVENT, onLocalChange);
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROGRESS_EVENT, onLocalChange);
    };
  }, [accountKey, scope]);

  const toggleCourse = useCallback((course: RegionalDisasterCourse, completedAt: string) => {
    const key = remocCourseCompletionKey(course);
    if (loadedScopeRef.current !== (accountKey ?? MEMORY_SCOPE)) return false;
    const next = { ...recordsRef.current };
    if (next[key]) delete next[key];
    else {
      const record = buildRemocCourseCompletionRecord(course, completedAt);
      if (!record) return false;
      next[key] = record;
    }
    applyRecords(next);
    return true;
  }, [accountKey, applyRecords]);

  const removeCourse = useCallback((key: string) => {
    if (loadedScopeRef.current !== (accountKey ?? MEMORY_SCOPE)) return false;
    if (!recordsRef.current[key]) return;
    const next = { ...recordsRef.current };
    delete next[key];
    applyRecords(next);
    return true;
  }, [accountKey, applyRecords]);

  const visibleRecords = ready ? records : EMPTY_RECORDS;
  const summary = useMemo(() => summarizeRemocCourseProgress(Object.values(visibleRecords)), [visibleRecords]);
  const completedCourses = useMemo(() => Object.values(visibleRecords).sort((left, right) => right.startDate.localeCompare(left.startDate)), [visibleRecords]);

  return {
    ready,
    records: visibleRecords,
    completedCourses,
    summary,
    hasCourse: (course: RegionalDisasterCourse) => Boolean(visibleRecords[remocCourseCompletionKey(course)]),
    toggleCourse,
    removeCourse,
  };
}
