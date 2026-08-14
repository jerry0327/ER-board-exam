"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeProgressOutboxEntry,
  normalizeProgressSnapshot,
  type NormalizedProgressOutboxEntry,
} from "../lib/learning-state-normalization";
import { loadAccountSession } from "../lib/account-session";
import { scheduleReview } from "../lib/review-schedule";
import type { AttemptInput, AttemptRecord, Confidence, PracticeMode, ProgressAction, ProgressRecord } from "../lib/types";

const CACHE_KEY_PREFIX = "em-board-progress-cache-v2:";
const OUTBOX_KEY_PREFIX = "em-board-progress-outbox-v2:";
const LEGACY_CACHE_KEY = "em-board-progress-cache-v1";
const LEGACY_OUTBOX_KEY = "em-board-progress-outbox-v1";
const SYNC_SIGNAL_KEY = "em-board-progress-sync-v2";
const LOCAL_ACCOUNT_KEY = "anonymous-device";

type CachedProgress = { progress: ProgressRecord[]; attempts: AttemptRecord[] };
type OutboxEntry = NormalizedProgressOutboxEntry;
type RemoteProgress = CachedProgress & { localOnly: false; accountKey: string; resetGeneration: number };
type ProgressEndpointState = RemoteProgress | { localOnly: true };
export type ProgressResetType = "attempts" | "reading" | "bookmarks";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function cacheKey(accountKey: string) { return `${CACHE_KEY_PREFIX}${accountKey}`; }
function outboxKey(accountKey: string) { return `${OUTBOX_KEY_PREFIX}${accountKey}`; }

function readCache(accountKey: string): CachedProgress {
  return normalizeProgressSnapshot(readJson<unknown>(cacheKey(accountKey), {}));
}

function readOutbox(accountKey: string) {
  const value = readJson<unknown>(outboxKey(accountKey), []);
  return Array.isArray(value)
    ? value.map(normalizeProgressOutboxEntry).filter((entry): entry is OutboxEntry => Boolean(entry))
    : [];
}

function writeOutbox(accountKey: string, entries: OutboxEntry[]) {
  try {
    if (entries.length) localStorage.setItem(outboxKey(accountKey), JSON.stringify(entries));
    else localStorage.removeItem(outboxKey(accountKey));
    return true;
  } catch {
    // Single-question callers can keep studying in memory; durable batch
    // callers inspect this return value and surface the storage failure.
    return false;
  }
}

function migrateLocalOutbox(accountKey: string, resetGeneration: number) {
  if (accountKey === LOCAL_ACCOUNT_KEY) return true;
  const localEntries = readOutbox(LOCAL_ACCOUNT_KEY);
  if (!localEntries.length) return true;

  // Keep mutation ids and timestamps so retries remain idempotent, but rebase
  // anonymous work onto the account's current reset generation. The target is
  // written before the source is cleared, and duplicate ids make a retry safe
  // if the browser closes between those two localStorage operations.
  const merged = new Map(readOutbox(accountKey).map((entry) => [entry.id, entry]));
  for (const entry of localEntries) merged.set(entry.id, { ...entry, generation: resetGeneration });
  const migrated = [...merged.values()].sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
  if (!writeOutbox(accountKey, migrated)) return false;
  if (!writeOutbox(LOCAL_ACCOUNT_KEY, [])) return false;
  try { localStorage.removeItem(cacheKey(LOCAL_ACCOUNT_KEY)); } catch { /* the account outbox is already durable */ }
  return true;
}

function createMutationId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `m_${Date.now().toString(36)}_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function emptyRecord(questionId: string, updatedAt: string): ProgressRecord {
  return {
    userId: "cached",
    questionId,
    attempts: 0,
    correctAttempts: 0,
    firstAttemptCorrect: null,
    lastAnswer: null,
    lastCorrect: null,
    lastConfidence: null,
    bookmarked: 0,
    readState: "unread",
    wrongState: "none",
    streak: 0,
    dueAt: null,
    lastAttemptAt: null,
    updatedAt,
  };
}

function applyOutboxEntry(state: CachedProgress, entry: OutboxEntry): CachedProgress {
  const { action, queuedAt } = entry;
  const alreadyApplied =
    action.action === "attempt" &&
    state.attempts.some((attempt) => attempt.mutationId === action.mutationId);
  if (alreadyApplied) return state;

  const found = state.progress.find((record) => record.questionId === action.questionId);
  const optimisticRecord: ProgressRecord = {
    ...(found ?? emptyRecord(action.questionId, queuedAt)),
    updatedAt: queuedAt,
  };

  if (action.action === "bookmark") optimisticRecord.bookmarked = action.value ? 1 : 0;
  if (action.action === "read") optimisticRecord.readState = action.value;
  if (action.action === "mastery") optimisticRecord.wrongState = action.value;
  if (action.action === "attempt") {
    const review = scheduleReview({
      previous: {
        streak: optimisticRecord.streak,
        dueAt: optimisticRecord.dueAt,
        wrongState: optimisticRecord.wrongState,
      },
      correct: action.correct,
      confidence: action.confidence,
      answeredAt: action.attemptedAt ?? queuedAt,
    });
    optimisticRecord.attempts += 1;
    optimisticRecord.correctAttempts += action.correct === true ? 1 : 0;
    optimisticRecord.firstAttemptCorrect ??= action.correct === null ? null : action.correct ? 1 : 0;
    optimisticRecord.lastAnswer = JSON.stringify(action.selectedKeys);
    optimisticRecord.lastCorrect = action.correct === null ? null : action.correct ? 1 : 0;
    optimisticRecord.lastConfidence = action.confidence;
    optimisticRecord.lastAttemptAt = queuedAt;
    optimisticRecord.streak = review.streak;
    optimisticRecord.wrongState = review.wrongState;
    optimisticRecord.dueAt = review.dueAt;
  }

  const progress = found
    ? state.progress.map((record) => record.questionId === action.questionId ? optimisticRecord : record)
    : [...state.progress, optimisticRecord];
  if (action.action !== "attempt") return { progress, attempts: state.attempts };

  const nextAttempt: AttemptRecord = {
    id: -Date.parse(queuedAt) - state.attempts.length,
    mutationId: action.mutationId,
    questionId: action.questionId,
    selectedKeys: JSON.stringify(action.selectedKeys),
    correct: action.correct === null ? null : action.correct ? 1 : 0,
    confidence: action.confidence,
    mode: action.mode,
    createdAt: queuedAt,
  };
  return { progress, attempts: [nextAttempt, ...state.attempts].slice(0, 1000) };
}

function overlayOutbox(state: CachedProgress, entries: OutboxEntry[]) {
  return entries.reduce(applyOutboxEntry, state);
}

async function fetchRemoteProgress(): Promise<ProgressEndpointState> {
  const session = await loadAccountSession();
  if (!session.authenticated) return { localOnly: true };
  const response = await fetch("/api/progress");
  if (response.status === 401) return { localOnly: true };
  if (!response.ok) throw new Error("無法載入學習進度，請再試一次。");
  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("請重新整理頁面後再試。");
  const candidate = payload as { accountKey?: unknown; resetGeneration?: unknown };
  if (candidate.accountKey !== session.accountKey || !Number.isSafeInteger(candidate.resetGeneration) || Number(candidate.resetGeneration) < 0) {
    throw new Error("請重新整理頁面後再試。");
  }
  const normalized = normalizeProgressSnapshot(payload);
  return {
    localOnly: false,
    accountKey: candidate.accountKey,
    resetGeneration: Number(candidate.resetGeneration),
    ...normalized,
  };
}

async function postAction(action: ProgressAction, generation: number, attemptedAt?: string) {
  const response = await fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...action, attemptedAt: action.action === "attempt" ? attemptedAt : undefined, generation }),
  });
  if (response.status === 409) return { superseded: true };
  if (!response.ok) throw new Error("無法更新學習進度，請再試一次。");
  return response.json() as Promise<{ progress?: ProgressRecord; superseded?: false }>;
}

async function deleteProgress(types: ProgressResetType[], baseGeneration: number, questionIds?: string[]) {
  const response = await fetch("/api/progress", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutationId: createMutationId(), baseGeneration, types, questionIds }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "無法清除學習紀錄，請再試一次。");
  }
  const payload = await response.json() as { resetGeneration?: number };
  if (!Number.isInteger(payload.resetGeneration)) throw new Error("無法清除學習紀錄，請再試一次。");
  return Number(payload.resetGeneration);
}

export function useProgress() {
  const [records, setRecords] = useState<ProgressRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "synced" | "offline">("loading");
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const recordsRef = useRef<ProgressRecord[]>([]);
  const attemptsRef = useRef<AttemptRecord[]>([]);
  const mountedRef = useRef(false);
  const initializedRef = useRef(false);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const accountKeyRef = useRef<string | null>(null);
  const resetGenerationRef = useRef(0);

  const replaceRecords = useCallback((next: ProgressRecord[]) => {
    recordsRef.current = next;
    if (mountedRef.current) setRecords(next);
  }, []);
  const replaceAttempts = useCallback((next: AttemptRecord[]) => {
    attemptsRef.current = next;
    if (mountedRef.current) setAttempts(next);
  }, []);
  const persistCache = useCallback((nextRecords = recordsRef.current, nextAttempts = attemptsRef.current) => {
    const accountKey = accountKeyRef.current;
    if (!accountKey) return;
    try {
      localStorage.setItem(cacheKey(accountKey), JSON.stringify({ progress: nextRecords, attempts: nextAttempts.slice(0, 1000) }));
    } catch {
      // A full browser cache must never prevent answering a question.
    }
  }, []);
  const replaceState = useCallback((next: CachedProgress) => {
    replaceRecords(next.progress);
    replaceAttempts(next.attempts);
    persistCache(next.progress, next.attempts);
  }, [persistCache, replaceAttempts, replaceRecords]);

  const activateLocalState = useCallback(() => {
    accountKeyRef.current = LOCAL_ACCOUNT_KEY;
    resetGenerationRef.current = 0;
    if (mountedRef.current) setAccountKey(LOCAL_ACCOUNT_KEY);
    if (!initializedRef.current) {
      initializedRef.current = true;
      try {
        localStorage.removeItem(LEGACY_CACHE_KEY);
        localStorage.removeItem(LEGACY_OUTBOX_KEY);
      } catch {
        // Storage restrictions still permit an in-memory local session.
      }
    }
    replaceState(overlayOutbox(readCache(LOCAL_ACCOUNT_KEY), readOutbox(LOCAL_ACCOUNT_KEY)));
    if (mountedRef.current) setStatus("offline");
  }, [replaceState]);

  const synchronize = useCallback(() => {
    if (syncInFlightRef.current) return syncInFlightRef.current;
    const operation = (async () => {
      try {
        const endpointState = await fetchRemoteProgress();
        if (endpointState.localOnly) {
          activateLocalState();
          return;
        }
        let remote: RemoteProgress = endpointState;
        const accountKey = remote.accountKey;
        if (!migrateLocalOutbox(accountKey, remote.resetGeneration)) throw new Error("無法更新學習進度，請再試一次。");
        accountKeyRef.current = accountKey;
        if (mountedRef.current) setAccountKey(accountKey);
        resetGenerationRef.current = remote.resetGeneration;
        if (!initializedRef.current) {
          initializedRef.current = true;
          localStorage.removeItem(LEGACY_CACHE_KEY);
          localStorage.removeItem(LEGACY_OUTBOX_KEY);
          replaceState(overlayOutbox(readCache(accountKey), readOutbox(accountKey)));
        }
        let pending = readOutbox(accountKey);
        while (pending.length) {
          const applicable = pending.filter((entry) => entry.generation === remote.resetGeneration);
          const superseded = pending.filter((entry) => entry.generation !== remote.resetGeneration);
          if (superseded.length) writeOutbox(accountKey, applicable);
          replaceState(overlayOutbox(remote, applicable));
          for (const entry of applicable) {
            const result = await postAction(entry.action, entry.generation, entry.queuedAt);
            if (result.superseded) resetGenerationRef.current = Math.max(resetGenerationRef.current, entry.generation + 1);
            writeOutbox(accountKey, readOutbox(accountKey).filter((queued) => queued.id !== entry.id));
          }
          const refreshed = await fetchRemoteProgress();
          if (refreshed.localOnly) {
            activateLocalState();
            return;
          }
          remote = refreshed;
          accountKeyRef.current = remote.accountKey;
          if (mountedRef.current) setAccountKey(remote.accountKey);
          resetGenerationRef.current = remote.resetGeneration;
          pending = readOutbox(remote.accountKey);
        }
        replaceState(overlayOutbox(remote, pending));
        if (mountedRef.current) setStatus(pending.length ? "offline" : "synced");
      } catch {
        const accountKey = accountKeyRef.current;
        if (accountKey) {
          replaceState(overlayOutbox(readCache(accountKey), readOutbox(accountKey)));
          if (mountedRef.current) setStatus("offline");
        } else {
          // A network failure before identity is known must not block studying.
          // Anonymous work stays in the local outbox and migrates after a
          // future authenticated GET succeeds.
          activateLocalState();
        }
      }
    })();
    syncInFlightRef.current = operation;
    void operation.finally(() => {
      if (syncInFlightRef.current === operation) syncInFlightRef.current = null;
    });
    return operation;
  }, [activateLocalState, replaceState]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(synchronize);
    const handleOnline = () => { void synchronize(); };
    const handleFocus = () => { void synchronize(); };
    const handleStorage = (event: StorageEvent) => { if (event.key === SYNC_SIGNAL_KEY) void synchronize(); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [synchronize]);

  const progressMap = useMemo(
    () => new Map(records.map((record) => [record.questionId, record])),
    [records],
  );

  const mutate = useCallback((action: ProgressAction, requireDurableWrite = false) => {
    const accountKey = accountKeyRef.current ?? LOCAL_ACCOUNT_KEY;
    const entry: OutboxEntry = { id: action.action === "attempt" ? action.mutationId : createMutationId(), queuedAt: new Date().toISOString(), generation: resetGenerationRef.current, action };
    if (!writeOutbox(accountKey, [...readOutbox(accountKey), entry])) {
      if (mountedRef.current) setStatus("offline");
      const error = new Error("無法儲存學習進度，請再試一次。");
      if (requireDurableWrite) throw error;
      return Promise.resolve(undefined);
    }
    const optimistic = applyOutboxEntry({ progress: recordsRef.current, attempts: attemptsRef.current }, entry);
    replaceState(optimistic);

    return (async () => {
      try {
        await synchronize();
        // A mutation can be queued during the final GET of an existing sync.
        // One extra pass closes that narrow race while preserving FIFO order.
        if (readOutbox(accountKey).some((queued) => queued.id === entry.id)) await synchronize();
        const stillPending = readOutbox(accountKey).some((queued) => queued.id === entry.id);
        if (stillPending && mountedRef.current) setStatus("offline");
        return recordsRef.current.find((record) => record.questionId === action.questionId)
          ?? optimistic.progress.find((record) => record.questionId === action.questionId);
      } catch {
        if (mountedRef.current) setStatus("offline");
        return optimistic.progress.find((record) => record.questionId === action.questionId);
      }
    })();
  }, [replaceState, synchronize]);

  const recordAttempts = useCallback((inputs: AttemptInput[]) => {
    if (!inputs.length) return Promise.resolve([]);
    const accountKey = accountKeyRef.current ?? LOCAL_ACCOUNT_KEY;

    const queuedAt = Date.now();
    const entries: OutboxEntry[] = inputs.map((input, index) => {
      const mutationId = input.mutationId ?? createMutationId();
      return {
        id: mutationId,
        queuedAt: new Date(queuedAt + index).toISOString(),
        generation: resetGenerationRef.current,
        action: {
          action: "attempt",
          mutationId,
          questionId: input.questionId,
          selectedKeys: input.selectedKeys,
          correct: input.correct,
          confidence: input.confidence,
          mode: input.mode,
        },
      };
    });

    // Persist the entire exam as one outbox replacement before starting any
    // network work. A reload can then retry these same mutation ids safely.
    if (!writeOutbox(accountKey, [...readOutbox(accountKey), ...entries])) {
      if (mountedRef.current) setStatus("offline");
      throw new Error("無法儲存作答紀錄，請再試一次。");
    }
    const optimistic = entries.reduce(
      applyOutboxEntry,
      { progress: recordsRef.current, attempts: attemptsRef.current },
    );
    replaceState(optimistic);

    return (async () => {
      await synchronize();
      const entryIds = new Set(entries.map((entry) => entry.id));
      // The batch may have been enqueued during the final GET of an existing
      // sync. One extra pass closes that race without changing mutation ids.
      if (readOutbox(accountKey).some((queued) => entryIds.has(queued.id))) await synchronize();
      const stillPending = readOutbox(accountKey).some((queued) => entryIds.has(queued.id));
      if (stillPending && mountedRef.current) setStatus("offline");
      return entries.map((entry) => (
        recordsRef.current.find((record) => record.questionId === entry.action.questionId)
        ?? optimistic.progress.find((record) => record.questionId === entry.action.questionId)
      ));
    })();
  }, [replaceState, synchronize]);

  const recordAttempt = useCallback(
    (questionId: string, selectedKeys: string[], correct: boolean | null, confidence: Confidence, mode: PracticeMode) =>
      mutate({ action: "attempt", mutationId: createMutationId(), questionId, selectedKeys, correct, confidence, mode }, true),
    [mutate],
  );
  const toggleBookmark = useCallback((questionId: string, value: boolean) => mutate({ action: "bookmark", questionId, value }), [mutate]);
  const markRead = useCallback((questionId: string, value: "reading" | "done" | "later" | "unread") => mutate({ action: "read", questionId, value }), [mutate]);
  const setMastery = useCallback((questionId: string, value: "pending" | "mastered" | "none") => mutate({ action: "mastery", questionId, value }), [mutate]);

  const resetProgress = useCallback(async (types: ProgressResetType[], questionIds?: string[]) => {
    if (!types.length) throw new Error("請選擇要清除的紀錄。");
    await synchronize();
    const accountKey = accountKeyRef.current;
    if (!accountKey) throw new Error("請重新整理頁面後再試。");
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      const selected = questionIds ? new Set(questionIds) : null;
      const targetsQuestion = (questionId: string) => !selected || selected.has(questionId);
      const clearsAction = (entry: OutboxEntry) => targetsQuestion(entry.action.questionId) && (
        (types.includes("attempts") && ["attempt", "mastery"].includes(entry.action.action))
        || (types.includes("reading") && entry.action.action === "read")
        || (types.includes("bookmarks") && entry.action.action === "bookmark")
      );
      if (!writeOutbox(accountKey, readOutbox(accountKey).filter((entry) => !clearsAction(entry)))) {
        throw new Error("無法清除學習紀錄，請再試一次。");
      }

      const now = new Date().toISOString();
      const nextAttempts = types.includes("attempts")
        ? attemptsRef.current.filter((attempt) => !targetsQuestion(attempt.questionId))
        : attemptsRef.current;
      const nextRecords = recordsRef.current.flatMap((record) => {
        if (!targetsQuestion(record.questionId)) return [record];
        if (types.length === 3) return [];
        const next = { ...record, updatedAt: now };
        if (types.includes("attempts")) Object.assign(next, {
          attempts: 0,
          correctAttempts: 0,
          firstAttemptCorrect: null,
          lastAnswer: null,
          lastCorrect: null,
          lastConfidence: null,
          wrongState: "none",
          streak: 0,
          dueAt: null,
          lastAttemptAt: null,
        });
        if (types.includes("reading")) next.readState = "unread";
        if (types.includes("bookmarks")) next.bookmarked = 0;
        const empty = next.attempts === 0
          && next.correctAttempts === 0
          && next.firstAttemptCorrect === null
          && next.lastAnswer === null
          && next.lastCorrect === null
          && next.lastConfidence === null
          && next.bookmarked === 0
          && next.readState === "unread"
          && next.wrongState === "none"
          && next.streak === 0
          && next.dueAt === null
          && next.lastAttemptAt === null;
        return empty ? [] : [next];
      });
      replaceState({ progress: nextRecords, attempts: nextAttempts });
      if (mountedRef.current) setStatus("offline");
      return;
    }
    if (!navigator.onLine) throw new Error("請連線後再清除學習紀錄。");
    if (readOutbox(accountKey).length) throw new Error("請稍候片刻再清除。");

    resetGenerationRef.current = await deleteProgress(types, resetGenerationRef.current, questionIds);
    const remote = await fetchRemoteProgress();
    if (remote.localOnly) {
      activateLocalState();
      return;
    }
    accountKeyRef.current = remote.accountKey;
    if (mountedRef.current) setAccountKey(remote.accountKey);
    resetGenerationRef.current = remote.resetGeneration;
    replaceState(remote);
    localStorage.setItem(SYNC_SIGNAL_KEY, `${Date.now()}`);
    if (mountedRef.current) setStatus("synced");
  }, [activateLocalState, replaceState, synchronize]);

  return { records, attempts, progressMap, status, accountKey, recordAttempt, recordAttempts, toggleBookmark, markRead, setMastery, resetProgress };
}
