"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeGuideResourceOutboxEntry,
  normalizeGuideResourceProgressRecords,
  type NormalizedGuideResourceAction,
  type NormalizedGuideResourceOutboxEntry,
} from "../lib/learning-state-normalization";
import { loadAccountSession } from "../lib/account-session";
import type { GuideReadState, GuideResourceProgressRecord } from "../lib/types";

type GuideResourceAction = NormalizedGuideResourceAction;

type OutboxEntry = NormalizedGuideResourceOutboxEntry;
const CACHE_PREFIX = "em-board-guide-resource-progress-cache-v1:";
const OUTBOX_PREFIX = "em-board-guide-resource-progress-outbox-v1:";
const SIGNAL_KEY = "em-board-guide-resource-progress-signal-v1";
const LOCAL_ACCOUNT_KEY = "anonymous-device";

type GuideEndpointState =
  | { localOnly: true }
  | { localOnly: false; accountKey: string; progress: GuideResourceProgressRecord[] };

function key(prefix: string, accountKey: string) { return `${prefix}${accountKey}`; }

function readJson<T>(storageKey: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "") as T;
  } catch {
    return fallback;
  }
}

function readCache(accountKey: string) {
  const value = readJson<unknown>(key(CACHE_PREFIX, accountKey), []);
  return normalizeGuideResourceProgressRecords(value);
}

function readOutbox(accountKey: string) {
  const value = readJson<unknown>(key(OUTBOX_PREFIX, accountKey), []);
  return Array.isArray(value)
    ? value.map(normalizeGuideResourceOutboxEntry).filter((item): item is OutboxEntry => Boolean(item))
    : [];
}

function writeOutbox(accountKey: string, entries: OutboxEntry[]) {
  try {
    if (entries.length) localStorage.setItem(key(OUTBOX_PREFIX, accountKey), JSON.stringify(entries));
    else localStorage.removeItem(key(OUTBOX_PREFIX, accountKey));
    return true;
  } catch {
    return false;
  }
}

function migrateLocalOutbox(accountKey: string) {
  if (accountKey === LOCAL_ACCOUNT_KEY) return true;
  const localEntries = readOutbox(LOCAL_ACCOUNT_KEY);
  if (!localEntries.length) return true;
  const merged = new Map(readOutbox(accountKey).map((entry) => [entry.id, entry]));
  for (const entry of localEntries) merged.set(entry.id, entry);
  const migrated = [...merged.values()].sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
  if (!writeOutbox(accountKey, migrated) || !writeOutbox(LOCAL_ACCOUNT_KEY, [])) return false;
  try { localStorage.removeItem(key(CACHE_PREFIX, LOCAL_ACCOUNT_KEY)); } catch { /* account outbox is durable */ }
  return true;
}

function emptyRecord(resourceId: string, updatedAt: string): GuideResourceProgressRecord {
  return {
    userId: "cached",
    resourceId,
    readState: "unread",
    bookmarked: 0,
    contentHash: null,
    lastOpenedAt: null,
    completedAt: null,
    updatedAt,
  };
}

function applyAction(records: GuideResourceProgressRecord[], entry: OutboxEntry) {
  const existing = records.find((record) => record.resourceId === entry.action.resourceId);
  const next = { ...(existing ?? emptyRecord(entry.action.resourceId, entry.queuedAt)), updatedAt: entry.queuedAt };
  if (entry.action.action === "open") {
    next.lastOpenedAt = entry.queuedAt;
    next.contentHash = entry.action.contentHash ?? null;
  } else if (entry.action.action === "read") {
    next.readState = entry.action.value;
    next.contentHash = entry.action.contentHash ?? next.contentHash;
    if (entry.action.value === "done") next.completedAt = entry.queuedAt;
    if (entry.action.value === "unread") next.completedAt = null;
  } else {
    next.bookmarked = entry.action.value ? 1 : 0;
  }
  return existing
    ? records.map((record) => record.resourceId === next.resourceId ? next : record)
    : [...records, next];
}

async function fetchRemote(): Promise<GuideEndpointState> {
  const session = await loadAccountSession();
  if (!session.authenticated) return { localOnly: true };
  const response = await fetch("/api/guide-resource-progress");
  if (response.status === 401) return { localOnly: true };
  if (!response.ok) throw new Error("sync unavailable");
  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("account unavailable");
  const candidate = payload as { accountKey?: unknown; progress?: unknown };
  if (candidate.accountKey !== session.accountKey) throw new Error("account unavailable");
  return { localOnly: false, accountKey: candidate.accountKey, progress: normalizeGuideResourceProgressRecords(candidate.progress) };
}

async function postAction(action: GuideResourceAction, occurredAt: string) {
  const response = await fetch("/api/guide-resource-progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...action, occurredAt }),
  });
  if (!response.ok) throw new Error("sync unavailable");
  return response.json() as Promise<{ progress?: GuideResourceProgressRecord }>;
}

function actionId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `gr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function useGuideResourceProgress() {
  const [records, setRecords] = useState<GuideResourceProgressRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "synced" | "offline">("loading");
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const accountKeyRef = useRef<string | null>(null);
  const recordsRef = useRef<GuideResourceProgressRecord[]>([]);
  const syncRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(false);

  const replace = useCallback((next: GuideResourceProgressRecord[]) => {
    recordsRef.current = next;
    if (mountedRef.current) setRecords(next);
    const currentAccountKey = accountKeyRef.current;
    if (currentAccountKey) {
      try { localStorage.setItem(key(CACHE_PREFIX, currentAccountKey), JSON.stringify(next)); } catch { /* keep memory state */ }
    }
  }, []);

  const activateLocalState = useCallback(() => {
    accountKeyRef.current = LOCAL_ACCOUNT_KEY;
    if (mountedRef.current) setAccountKey(LOCAL_ACCOUNT_KEY);
    replace(readOutbox(LOCAL_ACCOUNT_KEY).reduce(applyAction, readCache(LOCAL_ACCOUNT_KEY)));
    if (mountedRef.current) setStatus("offline");
  }, [replace]);

  const synchronize = useCallback(() => {
    if (syncRef.current) return syncRef.current;
    const operation = (async () => {
      try {
        const endpointState = await fetchRemote();
        if (endpointState.localOnly) {
          activateLocalState();
          return;
        }
        let remote = endpointState;
        const synchronizingAccountKey = remote.accountKey;
        if (accountKeyRef.current !== synchronizingAccountKey && mountedRef.current) setStatus("loading");
        if (!migrateLocalOutbox(remote.accountKey)) throw new Error("local migration unavailable");
        accountKeyRef.current = remote.accountKey;
        if (mountedRef.current) setAccountKey(remote.accountKey);
        let pending = readOutbox(remote.accountKey);
        replace(pending.reduce(applyAction, remote.progress));
        for (const entry of pending) {
          await postAction(entry.action, entry.queuedAt);
          writeOutbox(remote.accountKey, readOutbox(remote.accountKey).filter((item) => item.id !== entry.id));
        }
        const refreshed = await fetchRemote();
        if (refreshed.localOnly) {
          activateLocalState();
          return;
        }
        if (refreshed.accountKey !== synchronizingAccountKey) throw new Error("guide account changed");
        remote = refreshed;
        accountKeyRef.current = remote.accountKey;
        if (mountedRef.current) setAccountKey(remote.accountKey);
        pending = readOutbox(remote.accountKey);
        replace(pending.reduce(applyAction, remote.progress));
        if (mountedRef.current) setStatus(pending.length ? "offline" : "synced");
      } catch {
        const currentAccountKey = accountKeyRef.current;
        if (currentAccountKey) {
          replace(readOutbox(currentAccountKey).reduce(applyAction, readCache(currentAccountKey)));
          if (mountedRef.current) setStatus("offline");
        } else {
          activateLocalState();
        }
      }
    })();
    syncRef.current = operation;
    void operation.finally(() => { if (syncRef.current === operation) syncRef.current = null; });
    return operation;
  }, [activateLocalState, replace]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(synchronize);
    const resync = () => { void synchronize(); };
    const onStorage = (event: StorageEvent) => { if (event.key === SIGNAL_KEY) void synchronize(); };
    window.addEventListener("online", resync);
    window.addEventListener("focus", resync);
    window.addEventListener("storage", onStorage);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", resync);
      window.removeEventListener("focus", resync);
      window.removeEventListener("storage", onStorage);
    };
  }, [synchronize]);

  const mutate = useCallback(async (action: GuideResourceAction) => {
    if (!accountKeyRef.current) await synchronize();
    const currentAccountKey = accountKeyRef.current ?? LOCAL_ACCOUNT_KEY;
    const entry: OutboxEntry = { id: actionId(), queuedAt: new Date().toISOString(), action };
    if (!writeOutbox(currentAccountKey, [...readOutbox(currentAccountKey), entry])) throw new Error("閱讀進度暫時無法保存，請稍後再試");
    const optimistic = applyAction(recordsRef.current, entry);
    replace(optimistic);
    try {
      await synchronize();
      if (readOutbox(currentAccountKey).some((item) => item.id === entry.id)) await synchronize();
      localStorage.setItem(SIGNAL_KEY, `${Date.now()}`);
      return recordsRef.current.find((record) => record.resourceId === action.resourceId)
        ?? optimistic.find((record) => record.resourceId === action.resourceId);
    } catch {
      if (mountedRef.current) setStatus("offline");
      return optimistic.find((record) => record.resourceId === action.resourceId);
    }
  }, [replace, synchronize]);

  const progressMap = useMemo(() => new Map(records.map((record) => [record.resourceId, record])), [records]);
  const openResource = useCallback((resourceId: string, contentHash: string | null) => mutate({ action: "open", resourceId, contentHash }), [mutate]);
  const markResource = useCallback((resourceId: string, value: GuideReadState, contentHash: string | null) => mutate({ action: "read", resourceId, value, contentHash }), [mutate]);
  const bookmarkResource = useCallback((resourceId: string, value: boolean) => mutate({ action: "bookmark", resourceId, value }), [mutate]);
  return { records, progressMap, status, accountKey, openResource, markResource, bookmarkResource };
}
