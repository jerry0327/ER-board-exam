"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAccountSession } from "../lib/account-session";
import {
  annotationMigrationSnapshot,
  planAnonymousAnnotationMigration,
  type AnnotationMigrationOutboxEntry,
} from "../lib/annotation-migration";
import type { AnnotationKind, StudyAnnotation } from "../lib/types";

const DB_NAME_PREFIX = "em-board-annotations-v2-";
const ANNOTATIONS = "annotations";
const OUTBOX = "outbox";
const LOCAL_ACCOUNT_KEY = "anonymous-device";

type AnnotationDraft = {
  id: string;
  questionId: string;
  kind: AnnotationKind;
  body?: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  startOffset?: number | null;
  endOffset?: number | null;
};

type OutboxEntry = {
  mutationId: string;
  action: "upsert" | "delete";
  baseRevision: number;
  annotation: StudyAnnotation;
};

function mutationId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function openStore(accountKey: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${DB_NAME_PREFIX}${accountKey}`, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ANNOTATIONS)) db.createObjectStore(ANNOTATIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "mutationId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allFromStore<T>(accountKey: string, name: string) {
  const db = await openStore(accountKey);
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(name, "readonly");
    const request = transaction.objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function putInStore<T>(accountKey: string, name: string, value: T) {
  const db = await openStore(accountKey);
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(name, "readwrite");
    transaction.objectStore(name).put(value);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function deleteFromStore(accountKey: string, name: string, key: string) {
  const db = await openStore(accountKey);
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(name, "readwrite");
    transaction.objectStore(name).delete(key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function putMigrationBatch(
  accountKey: string,
  annotations: StudyAnnotation[],
  outbox: AnnotationMigrationOutboxEntry[],
) {
  if (!annotations.length && !outbox.length) return;
  const db = await openStore(accountKey);
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([ANNOTATIONS, OUTBOX], "readwrite");
    const annotationStore = transaction.objectStore(ANNOTATIONS);
    const outboxStore = transaction.objectStore(OUTBOX);
    for (const annotation of annotations) annotationStore.put(annotation);
    for (const entry of outbox) outboxStore.put(entry);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

async function deleteSourceSnapshots(accountKey: string, snapshots: Map<string, string>) {
  if (!snapshots.size) return;
  const db = await openStore(accountKey);
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ANNOTATIONS, "readwrite");
    const store = transaction.objectStore(ANNOTATIONS);
    for (const [id, snapshot] of snapshots) {
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as StudyAnnotation | undefined;
        // An edit made while identity migration was running stays in the
        // source store and will be picked up by the next pass.
        if (current && annotationMigrationSnapshot(current) === snapshot) store.delete(id);
      };
    }
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

function withoutUserFields(value: Record<string, unknown>): StudyAnnotation | null {
  if (typeof value.id !== "string" || typeof value.questionId !== "string") return null;
  return {
    id: value.id,
    questionId: value.questionId,
    kind: value.kind === "highlight" ? "highlight" : value.kind === "excerpt" ? "excerpt" : "question_note",
    body: typeof value.body === "string" ? value.body : "",
    quote: typeof value.quote === "string" ? value.quote : "",
    prefix: typeof value.prefix === "string" ? value.prefix : "",
    suffix: typeof value.suffix === "string" ? value.suffix : "",
    startOffset: typeof value.startOffset === "number" ? value.startOffset : null,
    endOffset: typeof value.endOffset === "number" ? value.endOffset : null,
    revision: typeof value.revision === "number" ? value.revision : 1,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    deletedAt: typeof value.deletedAt === "string" ? value.deletedAt : null,
    syncState: "saved",
  };
}

async function migrateStoredAnnotations(
  sourceAccountKey: string,
  accountKey: string,
  remote: StudyAnnotation[],
) {
  if (sourceAccountKey === accountKey) return;
  // Usually one pass is enough. Repeating covers an annotation saved in the
  // tiny interval between reading and snapshot-checked cleanup without ever
  // deleting that newer value.
  for (let pass = 0; pass < 3; pass += 1) {
    const source = await allFromStore<StudyAnnotation>(sourceAccountKey, ANNOTATIONS);
    if (!source.length) return;
    const target = await allFromStore<StudyAnnotation>(accountKey, ANNOTATIONS);
    const plan = planAnonymousAnnotationMigration(accountKey, source, [...target, ...remote]);
    // Annotation and matching outbox entry become durable in one target DB
    // transaction. Only then may unchanged anonymous source rows be removed.
    await putMigrationBatch(accountKey, plan.annotations, plan.outbox);
    await deleteSourceSnapshots(sourceAccountKey, new Map(source.map((item) => [item.id, annotationMigrationSnapshot(item)])));
  }
}

export function useAnnotations() {
  const [annotations, setAnnotations] = useState<StudyAnnotation[]>([]);
  const [status, setStatus] = useState<"loading" | "synced" | "local" | "error">("loading");
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const annotationsRef = useRef<StudyAnnotation[]>([]);
  const syncingRef = useRef<Promise<void> | null>(null);
  const accountKeyRef = useRef<string | null>(null);

  const replace = useCallback((next: StudyAnnotation[]) => {
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  const activateLocalState = useCallback(async () => {
    accountKeyRef.current = LOCAL_ACCOUNT_KEY;
    setAccountKey(LOCAL_ACCOUNT_KEY);
    const local = await allFromStore<StudyAnnotation>(LOCAL_ACCOUNT_KEY, ANNOTATIONS).catch(() => []);
    replace(local);
    setStatus("local");
  }, [replace]);

  const drain = useCallback(() => {
    if (syncingRef.current) return syncingRef.current;
    const operation = (async () => {
      try {
        const session = await loadAccountSession();
        if (!session.authenticated) { await activateLocalState(); return; }
        const identityResponse = await fetch("/api/annotations");
        if (identityResponse.status === 401) { await activateLocalState(); return; }
        if (!identityResponse.ok) throw new Error("annotation sync unavailable");
        const identityPayload = await identityResponse.json() as { accountKey?: string; annotations?: Record<string, unknown>[] };
        if (!identityPayload.accountKey) throw new Error("annotation account unavailable");
        const accountKey = identityPayload.accountKey;
        if (accountKey !== session.accountKey) throw new Error("annotation account changed");
        const accountChanged = accountKeyRef.current !== accountKey;
        if (accountChanged) setStatus("loading");
        const initialRemote = (identityPayload.annotations ?? [])
          .map(withoutUserFields)
          .filter((item): item is StudyAnnotation => Boolean(item));
        if (session.legacyAccountKey) {
          await migrateStoredAnnotations(session.legacyAccountKey, accountKey, initialRemote);
        }
        await migrateStoredAnnotations(LOCAL_ACCOUNT_KEY, accountKey, initialRemote);
        accountKeyRef.current = accountKey;
        setAccountKey(accountKey);

        const local = await allFromStore<StudyAnnotation>(accountKey, ANNOTATIONS);
        if (accountChanged || !annotationsRef.current.length) replace(local);
        const entries = (await allFromStore<OutboxEntry>(accountKey, OUTBOX)).sort((left, right) => {
          if (left.annotation.id === right.annotation.id) return left.baseRevision - right.baseRevision;
          return left.annotation.updatedAt.localeCompare(right.annotation.updatedAt);
        });
        for (const entry of entries) {
          const response = await fetch("/api/annotations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(entry),
          });
          if (response.status === 401) { await activateLocalState(); return; }
          const payload = await response.json() as { annotation?: Record<string, unknown> };
          if (response.status === 409) {
            const local = annotationsRef.current.find((item) => item.id === entry.annotation.id);
            if (local) {
              const remote = payload.annotation ? withoutUserFields(payload.annotation) : null;
              // Preserve the user's local text, but advance its base revision
              // to the server revision. The next explicit edit can then be
              // saved instead of entering a permanent 409 loop.
              const conflicted = {
                ...local,
                revision: remote?.revision ?? 0,
                syncState: "conflict" as const,
              };
              await putInStore(accountKey, ANNOTATIONS, conflicted);
              replace(annotationsRef.current.map((item) => item.id === conflicted.id ? conflicted : item));
            }
            await deleteFromStore(accountKey, OUTBOX, entry.mutationId);
            continue;
          }
          if (!response.ok) throw new Error("annotation sync unavailable");
          const remote = payload.annotation ? withoutUserFields(payload.annotation) : null;
          if (remote) {
            const local = annotationsRef.current.find((item) => item.id === remote.id);
            // An older mutation can finish while a newer local edit is still
            // queued. Keep the newer draft until its own mutation succeeds.
            if (!local || (local.syncState !== "conflict" && remote.revision >= local.revision)) {
              await putInStore(accountKey, ANNOTATIONS, remote);
              replace(local
                ? annotationsRef.current.map((item) => item.id === remote.id ? remote : item)
                : [...annotationsRef.current, remote]);
            }
          }
          await deleteFromStore(accountKey, OUTBOX, entry.mutationId);
        }

        const response = await fetch("/api/annotations");
        if (response.status === 401) { await activateLocalState(); return; }
        if (!response.ok) throw new Error("annotation sync unavailable");
        const payload = await response.json() as { accountKey?: string; annotations?: Record<string, unknown>[] };
        if (payload.accountKey !== accountKey) throw new Error("annotation account changed");
        const remote = (payload.annotations ?? []).map(withoutUserFields).filter((item): item is StudyAnnotation => Boolean(item));
        const merged = new Map(annotationsRef.current.map((item) => [item.id, item]));
        for (const item of remote) {
          const local = merged.get(item.id);
          // A 409 marks the local copy for an explicit user decision. The
          // follow-up GET must not silently replace that conflicted draft with
          // the remote value that caused the conflict.
          if (!local || (local.syncState !== "conflict" && item.revision >= local.revision)) {
            merged.set(item.id, item);
          }
        }
        const next = [...merged.values()];
        for (const item of next) await putInStore(accountKey, ANNOTATIONS, item);
        replace(next);
        setStatus(next.some((item) => item.syncState === "conflict") ? "error" : "synced");
      } catch {
        const accountKey = accountKeyRef.current;
        if (accountKey) {
          const local = await allFromStore<StudyAnnotation>(accountKey, ANNOTATIONS).catch(() => []);
          replace(local);
        } else {
          await activateLocalState();
        }
        setStatus(accountKeyRef.current === LOCAL_ACCOUNT_KEY || !navigator.onLine ? "local" : "error");
      }
    })();
    syncingRef.current = operation;
    void operation.finally(() => { if (syncingRef.current === operation) syncingRef.current = null; });
    return operation;
  }, [activateLocalState, replace]);

  useEffect(() => {
    let active = true;
    void drain().catch(() => { if (active) setStatus("error"); });
    const retry = () => { void drain(); };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => { active = false; window.removeEventListener("online", retry); window.removeEventListener("focus", retry); };
  }, [drain]);

  const flushPersistedMutation = useCallback((accountKey: string, mutationId: string) => {
    void (async () => {
      await drain();
      // The mutation may have been written while another drain was already in
      // its final GET. Recheck once that run has released the shared promise.
      await Promise.resolve();
      const pending = await allFromStore<OutboxEntry>(accountKey, OUTBOX).catch(() => []);
      if (pending.some((entry) => entry.mutationId === mutationId)) await drain();
    })();
  }, [drain]);

  const upsert = useCallback(async (draft: AnnotationDraft) => {
    if (!accountKeyRef.current) await drain();
    const accountKey = accountKeyRef.current;
    if (!accountKey) throw new Error("目前無法儲存筆記，請稍後再試。");
    const existing = annotationsRef.current.find((item) => item.id === draft.id);
    const now = new Date().toISOString();
    const baseRevision = existing?.revision ?? 0;
    const annotation: StudyAnnotation = {
      id: draft.id,
      questionId: draft.questionId,
      kind: draft.kind,
      body: draft.body ?? existing?.body ?? "",
      quote: draft.quote ?? existing?.quote ?? "",
      prefix: draft.prefix ?? existing?.prefix ?? "",
      suffix: draft.suffix ?? existing?.suffix ?? "",
      startOffset: draft.startOffset ?? existing?.startOffset ?? null,
      endOffset: draft.endOffset ?? existing?.endOffset ?? null,
      revision: baseRevision + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      syncState: "pending",
    };
    const entry: OutboxEntry = { mutationId: mutationId(), action: "upsert", baseRevision, annotation };
    try {
      await putInStore(accountKey, ANNOTATIONS, annotation);
      if (accountKey === LOCAL_ACCOUNT_KEY) {
        replace(existing ? annotationsRef.current.map((item) => item.id === annotation.id ? annotation : item) : [...annotationsRef.current, annotation]);
        setStatus("local");
        return annotation;
      }
      await putInStore(accountKey, OUTBOX, entry);
      replace(existing ? annotationsRef.current.map((item) => item.id === annotation.id ? annotation : item) : [...annotationsRef.current, annotation]);
      flushPersistedMutation(accountKey, entry.mutationId);
      return annotation;
    } catch {
      setStatus("error");
      throw new Error("筆記尚未儲存，請先複製內容後再試一次。");
    }
  }, [drain, flushPersistedMutation, replace]);

  const remove = useCallback(async (id: string) => {
    if (!accountKeyRef.current) await drain();
    const accountKey = accountKeyRef.current;
    if (!accountKey) throw new Error("目前無法刪除筆記，請稍後再試。");
    const existing = annotationsRef.current.find((item) => item.id === id);
    if (!existing) return;
    const now = new Date().toISOString();
    const annotation = { ...existing, revision: existing.revision + 1, updatedAt: now, deletedAt: now, syncState: "pending" as const };
    const entry: OutboxEntry = { mutationId: mutationId(), action: "delete", baseRevision: existing.revision, annotation };
    await putInStore(accountKey, ANNOTATIONS, annotation);
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      replace(annotationsRef.current.map((item) => item.id === id ? annotation : item));
      setStatus("local");
      return;
    }
    await putInStore(accountKey, OUTBOX, entry);
    replace(annotationsRef.current.map((item) => item.id === id ? annotation : item));
    flushPersistedMutation(accountKey, entry.mutationId);
  }, [drain, flushPersistedMutation, replace]);

  const active = useMemo(() => annotations.filter((item) => !item.deletedAt), [annotations]);
  return { annotations: active, status, accountKey, upsert, remove };
}
