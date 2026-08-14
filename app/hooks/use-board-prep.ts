"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteBoardPrepAttachment,
  downloadBoardPrepAttachment,
  listBoardPrepAttachments,
  replaceBoardPrepAttachment,
  saveBoardPrepAttachment,
  type BoardPrepAttachmentMeta,
} from "../lib/board-prep-attachments";
import {
  boardPrepProgressSummary,
  defaultBoardPrepState,
  getApplicableBoardPrepSections,
  getBoardPrepCohort,
  normalizeBoardPrepState,
  quotaYearTrainingStart,
  updateBoardPrepItem,
  updateBoardPrepOccurrence,
  type BoardPrepCompletionState,
  type BoardPrepItemState,
  type BoardPrepSelectionMode,
  type BoardPrepState,
} from "../lib/board-prep";

const LEGACY_KEY_PREFIX = "em-board-board-prep-v1:";
const LOCAL_ACCOUNT_KEY = "anonymous-device";

type SaveStatus = "loading" | "ready" | "unavailable";

async function payloadError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch { return fallback; }
}

function legacyState(accountKey: string | null) {
  if (!accountKey) return null;
  try {
    const raw = window.localStorage.getItem(`${LEGACY_KEY_PREFIX}${accountKey}`);
    return raw ? normalizeBoardPrepState(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function useBoardPrep(accountKey: string | null) {
  const [state, setState] = useState<BoardPrepState>(() => defaultBoardPrepState());
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [attachments, setAttachments] = useState<BoardPrepAttachmentMeta[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState<SaveStatus>("loading");
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const stateRef = useRef(state);
  const revisionRef = useRef(0);
  const accountRef = useRef(accountKey);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistState = useCallback((next: BoardPrepState) => {
    const normalized = normalizeBoardPrepState(next);
    stateRef.current = normalized;
    setState(normalized);
    if (accountRef.current === LOCAL_ACCOUNT_KEY) {
      try {
        window.localStorage.setItem(`${LEGACY_KEY_PREFIX}${LOCAL_ACCOUNT_KEY}`, JSON.stringify(normalized));
        setStatus("ready");
        setAttachmentNotice("");
      } catch {
        setStatus("unavailable");
        setAttachmentNotice("完訓清單暫時無法儲存，請再試一次。");
      }
      return true;
    }
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const response = await fetch("/api/board-prep-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateRef.current, baseRevision: revisionRef.current }),
      });
      if (response.status === 409) {
        const conflict = await response.json() as { state?: unknown; revision?: number };
        if (conflict.state) {
          const remote = normalizeBoardPrepState(conflict.state);
          stateRef.current = remote;
          setState(remote);
          revisionRef.current = Number(conflict.revision ?? revisionRef.current);
        }
        setAttachmentNotice("已顯示最新清單。");
        return;
      }
      if (!response.ok) throw new Error(await payloadError(response, "無法更新清單，請再試一次。"));
      const payload = await response.json() as { state: unknown; revision: number };
      const saved = normalizeBoardPrepState(payload.state);
      stateRef.current = saved;
      setState(saved);
      revisionRef.current = payload.revision;
      setStatus("ready");
      setAttachmentNotice("");
    }).catch((error: unknown) => {
      setStatus("unavailable");
      setAttachmentNotice(error instanceof Error ? error.message : "無法更新清單，請再試一次。");
    });
    return true;
  }, []);

  const refreshAttachments = useCallback(async () => {
    if (!accountRef.current) {
      setAttachments([]);
      setAttachmentStatus("unavailable");
      return;
    }
    try {
      const next = await listBoardPrepAttachments(accountRef.current);
      setAttachments(next);
      setAttachmentStatus("ready");
    } catch (error) {
      setAttachmentStatus("unavailable");
      setAttachmentNotice(error instanceof Error ? error.message : "無法載入證明文件，請再試一次。");
    }
  }, []);

  useEffect(() => {
    accountRef.current = accountKey;
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        const local = legacyState(accountKey) ?? defaultBoardPrepState();
        stateRef.current = local;
        setState(local);
        setStatus("ready");
        setAttachments([]);
        setAttachmentStatus("unavailable");
        setAttachmentNotice("");
      });
      return () => { cancelled = true; };
    }
    if (!accountKey) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        const fallback = defaultBoardPrepState();
        stateRef.current = fallback;
        setState(fallback);
        setStatus("unavailable");
        setAttachments([]);
        setAttachmentStatus("unavailable");
        setAttachmentNotice("");
      });
      return () => { cancelled = true; };
    }
    const controller = new AbortController();
    void fetch("/api/board-prep-state", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error("請重新整理頁面後再試。");
        if (!response.ok) throw new Error(await payloadError(response, "無法載入清單，請重新整理後再試。"));
        return response.json() as Promise<{ state: unknown; revision: number }>;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const migrated = payload.state ? normalizeBoardPrepState(payload.state) : legacyState(accountKey) ?? defaultBoardPrepState();
        stateRef.current = migrated;
        setState(migrated);
        revisionRef.current = payload.revision ?? 0;
        setStatus("ready");
        if (!payload.state && legacyState(accountKey)) persistState(migrated);
        void refreshAttachments();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const fallback = legacyState(accountKey) ?? defaultBoardPrepState();
        stateRef.current = fallback;
        setState(fallback);
        setStatus("unavailable");
        setAttachmentStatus("unavailable");
        setAttachmentNotice(error instanceof Error ? error.message : "無法載入清單，請重新整理後再試。");
      });
    return () => controller.abort();
  }, [accountKey, persistState, refreshAttachments]);

  const setSelectionMode = useCallback((selectionMode: BoardPrepSelectionMode) => {
    const current = stateRef.current;
    return persistState(normalizeBoardPrepState({
      ...current,
      selectionMode,
      trainingStartDate: selectionMode === "training-start" && !current.trainingStartDate ? quotaYearTrainingStart(current.quotaYear) : current.trainingStartDate,
      updatedAt: new Date().toISOString(),
    }));
  }, [persistState]);

  const setQuotaYear = useCallback((quotaYear: number) => persistState(normalizeBoardPrepState({
    ...stateRef.current,
    selectionMode: "quota-year",
    quotaYear,
    updatedAt: new Date().toISOString(),
  })), [persistState]);

  const setTrainingStartDate = useCallback((trainingStartDate: string) => persistState(normalizeBoardPrepState({
    ...stateRef.current,
    selectionMode: "training-start",
    trainingStartDate,
    updatedAt: new Date().toISOString(),
  })), [persistState]);

  const updateItem = useCallback((itemId: string, patch: Partial<Pick<BoardPrepItemState, "completed" | "completedAt" | "certificateNumber" | "note">>) => (
    persistState(updateBoardPrepItem(stateRef.current, itemId, patch))
  ), [persistState]);

  const updateOccurrence = useCallback((
    itemId: string,
    occurrenceKey: string,
    patch: Partial<Pick<BoardPrepCompletionState, "completed" | "completedAt" | "certificateNumber" | "note">>,
  ) => persistState(updateBoardPrepOccurrence(stateRef.current, itemId, occurrenceKey, patch)), [persistState]);

  const addAttachment = useCallback(async (itemId: string, file: File) => {
    if (!accountKey || accountKey === LOCAL_ACCOUNT_KEY) throw new Error("目前無法上傳證明文件。");
    await saveQueueRef.current;
    const meta = await saveBoardPrepAttachment(accountKey, itemId, file);
    setAttachments((current) => [meta, ...current.filter((entry) => entry.id !== meta.id)]);
    setAttachmentStatus("ready");
    setAttachmentNotice("");
    return meta;
  }, [accountKey]);

  const replaceAttachment = useCallback(async (itemId: string, current: BoardPrepAttachmentMeta, file: File) => {
    if (!accountKey || accountKey === LOCAL_ACCOUNT_KEY) throw new Error("目前無法更換證明文件。");
    await saveQueueRef.current;
    const meta = await replaceBoardPrepAttachment(accountKey, itemId, current, file);
    setAttachments((items) => items.map((item) => item.id === current.id ? meta : item));
    setAttachmentStatus("ready");
    setAttachmentNotice("");
    return meta;
  }, [accountKey]);

  const removeAttachment = useCallback(async (id: string) => {
    if (!accountKey || accountKey === LOCAL_ACCOUNT_KEY) throw new Error("目前無法刪除證明文件。");
    const removed = await deleteBoardPrepAttachment(accountKey, id);
    if (removed) setAttachments((current) => current.filter((entry) => entry.id !== id));
    return removed;
  }, [accountKey]);

  const downloadAttachment = useCallback((id: string) => {
    if (!accountKey || accountKey === LOCAL_ACCOUNT_KEY) return Promise.reject(new Error("目前無法下載證明文件。"));
    return downloadBoardPrepAttachment(accountKey, id);
  }, [accountKey]);

  const sections = useMemo(() => getApplicableBoardPrepSections(state), [state]);
  const cohort = useMemo(() => getBoardPrepCohort(state.quotaYear), [state.quotaYear]);
  const summary = useMemo(() => boardPrepProgressSummary(state, sections), [sections, state]);

  return {
    state,
    status,
    ready: status !== "loading",
    cohort,
    sections,
    summary,
    attachments,
    attachmentStatus,
    attachmentNotice,
    setSelectionMode,
    setQuotaYear,
    setTrainingStartDate,
    updateItem,
    updateOccurrence,
    addAttachment,
    replaceAttachment,
    removeAttachment,
    downloadAttachment,
    refreshAttachments,
  };
}
