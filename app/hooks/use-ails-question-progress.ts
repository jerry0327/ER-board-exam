"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ailsQuestionId, ailsQuestionNumberFromId, type AilsProgressSnapshot } from "../lib/ails-questions.ts";
import type { AttemptInput, Confidence, ProgressRecord } from "../lib/types";

export const AILS_PROGRESS_KEY = "em-board-ails-progress-v2";
export const AILS_BOOKMARKS_LEGACY_KEY = "em-board-ails-bookmarks-v1";
export const AILS_MASTERED_LEGACY_KEY = "em-board-ails-mastered-v1";

export type AilsQuestionProgressRecord = AilsProgressSnapshot & {
  correctAttempts: number;
  lastSelectedKeys: string[];
  lastConfidence: Confidence | null;
  lastAttemptAt: string | null;
  readState: ProgressRecord["readState"];
};

type StoredProgress = {
  schemaVersion: 2;
  records: Record<string, AilsQuestionProgressRecord>;
};

const emptyRecord: AilsQuestionProgressRecord = {
  bookmarked: false,
  mastered: false,
  read: false,
  attempts: 0,
  correctAttempts: 0,
  lastCorrect: null,
  lastSelectedKeys: [],
  lastConfidence: null,
  lastAttemptAt: null,
  readState: "unread",
};

function readLegacySet(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item)) : []);
  } catch {
    return new Set<number>();
  }
}

export function parseAilsQuestionProgress(value: unknown): StoredProgress {
  if (!value || typeof value !== "object") return { schemaVersion: 2, records: {} };
  const candidate = value as Partial<StoredProgress>;
  if (candidate.schemaVersion !== 2 || !candidate.records || typeof candidate.records !== "object") {
    return { schemaVersion: 2, records: {} };
  }
  const records: Record<string, AilsQuestionProgressRecord> = {};
  for (const [key, record] of Object.entries(candidate.records)) {
    const questionNumber = Number(key);
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 272 || !record || typeof record !== "object") continue;
    const item = record as Partial<AilsQuestionProgressRecord>;
    const readState = item.readState === "reading" || item.readState === "done" || item.readState === "later"
      ? item.readState
      : item.read
        ? "done"
        : "unread";
    records[key] = {
      bookmarked: Boolean(item.bookmarked),
      mastered: Boolean(item.mastered),
      read: readState !== "unread",
      attempts: Number.isInteger(item.attempts) && item.attempts! > 0 ? item.attempts! : 0,
      correctAttempts: Number.isInteger(item.correctAttempts) && item.correctAttempts! > 0 ? item.correctAttempts! : 0,
      lastCorrect: typeof item.lastCorrect === "boolean" ? item.lastCorrect : null,
      lastSelectedKeys: Array.isArray(item.lastSelectedKeys) ? item.lastSelectedKeys.filter((entry): entry is string => typeof entry === "string") : [],
      lastConfidence: item.lastConfidence === "low" || item.lastConfidence === "normal" || item.lastConfidence === "high" ? item.lastConfidence : null,
      lastAttemptAt: typeof item.lastAttemptAt === "string" ? item.lastAttemptAt : null,
      readState,
    };
  }
  return { schemaVersion: 2, records };
}

export function migrateAilsQuestionProgress(
  current: StoredProgress,
  legacyBookmarks: Iterable<number>,
  legacyMastered: Iterable<number>,
) {
  const records = { ...current.records };
  for (const questionNumber of legacyBookmarks) {
    const key = String(questionNumber);
    if (!records[key]) records[key] = { ...emptyRecord, bookmarked: true };
  }
  for (const questionNumber of legacyMastered) {
    const key = String(questionNumber);
    if (!records[key]) records[key] = { ...emptyRecord, mastered: true };
  }
  return { schemaVersion: 2 as const, records };
}

function readStoredProgress() {
  if (typeof window === "undefined") return { schemaVersion: 2 as const, records: {} };
  let current: StoredProgress = { schemaVersion: 2, records: {} };
  try {
    current = parseAilsQuestionProgress(JSON.parse(window.localStorage.getItem(AILS_PROGRESS_KEY) ?? "null"));
  } catch {
    current = { schemaVersion: 2, records: {} };
  }
  return migrateAilsQuestionProgress(
    current,
    readLegacySet(AILS_BOOKMARKS_LEGACY_KEY),
    readLegacySet(AILS_MASTERED_LEGACY_KEY),
  );
}

export function useAilsQuestionProgress() {
  const [store, setStore] = useState<StoredProgress>({ schemaVersion: 2, records: {} });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const hydrationTask = window.setTimeout(() => {
      setStore(readStoredProgress());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(hydrationTask);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(AILS_PROGRESS_KEY, JSON.stringify(store));
      window.localStorage.removeItem(AILS_BOOKMARKS_LEGACY_KEY);
      window.localStorage.removeItem(AILS_MASTERED_LEGACY_KEY);
    } catch {
      // In-memory progress remains usable when browser storage is unavailable.
    }
  }, [hydrated, store]);

  const update = useCallback((questionNumber: number, recipe: (record: AilsQuestionProgressRecord) => AilsQuestionProgressRecord) => {
    setStore((current) => {
      const key = String(questionNumber);
      return {
        schemaVersion: 2,
        records: {
          ...current.records,
          [key]: recipe({ ...emptyRecord, ...current.records[key] }),
        },
      };
    });
  }, []);

  const progressFor = useCallback((questionNumber: number): AilsQuestionProgressRecord => {
    return { ...emptyRecord, ...store.records[String(questionNumber)] };
  }, [store.records]);
  const toggleBookmark = useCallback((questionNumber: number) => {
    update(questionNumber, (record) => ({ ...record, bookmarked: !record.bookmarked }));
  }, [update]);
  const setBookmark = useCallback((questionNumber: number, bookmarked: boolean) => {
    update(questionNumber, (record) => ({ ...record, bookmarked }));
  }, [update]);
  const setMastered = useCallback((questionNumber: number, mastered: boolean) => {
    update(questionNumber, (record) => ({ ...record, mastered }));
  }, [update]);
  const markRead = useCallback((questionNumber: number, readState: ProgressRecord["readState"] = "done") => {
    update(questionNumber, (record) => ({
      ...record,
      read: readState !== "unread",
      readState,
    }));
  }, [update]);
  const recordAttempt = useCallback((questionNumber: number, selectedKeys: string[], correct: boolean, confidence: Confidence = "normal") => {
    update(questionNumber, (record) => ({
      ...record,
      mastered: correct ? record.mastered : false,
      attempts: record.attempts + 1,
      correctAttempts: record.correctAttempts + (correct ? 1 : 0),
      lastCorrect: correct,
      lastSelectedKeys: selectedKeys,
      lastConfidence: confidence,
      lastAttemptAt: new Date().toISOString(),
    }));
  }, [update]);
  const recordAttempts = useCallback((attempts: { questionNumber: number; selectedKeys: string[]; correct: boolean; confidence?: Confidence }[]) => {
    if (!attempts.length) return;
    setStore((current) => {
      const records = { ...current.records };
      const attemptedAt = new Date().toISOString();
      for (const attempt of attempts) {
        const key = String(attempt.questionNumber);
        const record = { ...emptyRecord, ...records[key] };
        records[key] = {
          ...record,
          mastered: attempt.correct ? record.mastered : false,
          attempts: record.attempts + 1,
          correctAttempts: record.correctAttempts + (attempt.correct ? 1 : 0),
          lastCorrect: attempt.correct,
          lastSelectedKeys: attempt.selectedKeys,
          lastConfidence: attempt.confidence ?? "normal",
          lastAttemptAt: attemptedAt,
        };
      }
      return { schemaVersion: 2, records };
    });
  }, []);

  const progressMap = useMemo(() => {
    const result = new Map<string, ProgressRecord>();
    for (let questionNumber = 1; questionNumber <= 272; questionNumber += 1) {
      const record = progressFor(questionNumber);
      const questionId = ailsQuestionId(questionNumber);
      result.set(questionId, {
        userId: "ails-local",
        questionId,
        attempts: record.attempts,
        correctAttempts: record.correctAttempts,
        firstAttemptCorrect: null,
        lastAnswer: record.lastSelectedKeys.length ? JSON.stringify(record.lastSelectedKeys) : null,
        lastCorrect: record.lastCorrect === null ? null : record.lastCorrect ? 1 : 0,
        lastConfidence: record.lastConfidence,
        bookmarked: record.bookmarked ? 1 : 0,
        readState: record.readState,
        wrongState: record.mastered ? "mastered" : record.lastCorrect === false ? "pending" : "none",
        streak: record.lastCorrect ? 1 : 0,
        dueAt: null,
        lastAttemptAt: record.lastAttemptAt,
        updatedAt: record.lastAttemptAt ?? "",
      });
    }
    return result;
  }, [progressFor]);
  const setBookmarkById = useCallback(async (questionId: string, bookmarked: boolean) => {
    const questionNumber = ailsQuestionNumberFromId(questionId);
    if (questionNumber) setBookmark(questionNumber, bookmarked);
  }, [setBookmark]);
  const markReadById = useCallback(async (questionId: string, readState: ProgressRecord["readState"]) => {
    const questionNumber = ailsQuestionNumberFromId(questionId);
    if (questionNumber) markRead(questionNumber, readState);
  }, [markRead]);
  const recordAttemptById = useCallback(async (
    questionId: string,
    selectedKeys: string[],
    correct: boolean | null,
    confidence: Confidence,
  ) => {
    const questionNumber = ailsQuestionNumberFromId(questionId);
    if (questionNumber) recordAttempt(questionNumber, selectedKeys, correct === true, confidence);
  }, [recordAttempt]);
  const recordAttemptsById = useCallback(async (attempts: AttemptInput[]) => {
    recordAttempts(attempts.flatMap((attempt) => {
      const questionNumber = ailsQuestionNumberFromId(attempt.questionId);
      return questionNumber
        ? [{ questionNumber, selectedKeys: attempt.selectedKeys, correct: attempt.correct === true, confidence: attempt.confidence }]
        : [];
    }));
  }, [recordAttempts]);

  return useMemo(() => ({
    progressFor,
    progressMap,
    toggleBookmark,
    setBookmark,
    setMastered,
    markRead,
    recordAttempt,
    recordAttempts,
    setBookmarkById,
    markReadById,
    recordAttemptById,
    recordAttemptsById,
  }), [markRead, markReadById, progressFor, progressMap, recordAttempt, recordAttemptById, recordAttempts, recordAttemptsById, setBookmark, setBookmarkById, setMastered, toggleBookmark]);
}
