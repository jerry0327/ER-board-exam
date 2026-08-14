"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeRecognizedCourseCompletion, type RecognizedCourseCompletion, type SemRecognizedCourse } from "../lib/sem-recognized-courses";
import { taiwanDateKey } from "../lib/taiwan-date";

export type SavedRecognizedCourseCompletion = RecognizedCourseCompletion & { revision: number };

const LOCAL_ACCOUNT_KEY = "anonymous-device";
const LOCAL_KEY_PREFIX = "em-board-recognized-course-progress-v1:";

function localKey(accountKey: string) {
  return `${LOCAL_KEY_PREFIX}${accountKey}`;
}

function readLocal(accountKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(localKey(accountKey)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const normalized = normalizeRecognizedCourseCompletion(value);
      if (!normalized) return [];
      const revision = typeof (value as { revision?: unknown }).revision === "number"
        ? Math.max(1, Math.trunc((value as { revision: number }).revision))
        : 1;
      return [{ ...normalized, revision }];
    });
  } catch {
    return [];
  }
}

function writeLocal(accountKey: string, completions: SavedRecognizedCourseCompletion[]) {
  localStorage.setItem(localKey(accountKey), JSON.stringify(completions));
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch { return fallback; }
}

export function useRecognizedCourseProgress(accountKey: string | null) {
  const [completions, setCompletions] = useState<SavedRecognizedCourseCompletion[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [notice, setNotice] = useState("");
  const completionsRef = useRef(completions);

  const apply = useCallback((next: SavedRecognizedCourseCompletion[]) => {
    completionsRef.current = next;
    setCompletions(next);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      apply(readLocal(accountKey));
      setStatus("ready");
      setNotice("");
      return;
    }
    const response = await fetch("/api/disaster-course-completions", { cache: "no-store", signal });
    if (response.status === 401) throw new Error("請重新整理頁面後再試。");
    if (!response.ok) throw new Error(await responseError(response, "無法載入完成狀態，請再試一次。"));
    const payload = await response.json() as { completions?: SavedRecognizedCourseCompletion[] };
    apply(Array.isArray(payload.completions) ? payload.completions : []);
    setStatus("ready");
    setNotice("");
  }, [accountKey, apply]);

  useEffect(() => {
    if (!accountKey) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        apply([]);
        setStatus("unavailable");
        setNotice("");
      });
      return () => { cancelled = true; };
    }
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        apply(readLocal(accountKey));
        setStatus("ready");
        setNotice("");
      });
      return () => { cancelled = true; };
    }
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal)).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus("unavailable");
      setNotice(error instanceof Error ? error.message : "無法載入完成狀態，請再試一次。");
    });
    return () => controller.abort();
  }, [accountKey, apply, refresh]);

  const save = useCallback(async (course: SemRecognizedCourse, patch: Partial<Pick<RecognizedCourseCompletion, "completedAt" | "certificateNumber" | "note">>) => {
    const existing = completionsRef.current.find((entry) => entry.courseId === course.id);
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      const now = new Date().toISOString();
      const completion: SavedRecognizedCourseCompletion = {
        courseId: course.id,
        completedAt: patch.completedAt ?? existing?.completedAt ?? now.slice(0, 10),
        certificateNumber: patch.certificateNumber ?? existing?.certificateNumber ?? "",
        note: patch.note ?? existing?.note ?? "",
        snapshot: course,
        updatedAt: now,
        revision: (existing?.revision ?? 0) + 1,
      };
      const next = [completion, ...completionsRef.current.filter((entry) => entry.courseId !== course.id)];
      try {
        writeLocal(accountKey, next);
        apply(next);
        setStatus("ready");
        setNotice("");
        return completion;
      } catch {
        throw new Error("完成紀錄暫時無法儲存，請再試一次。");
      }
    }
    const response = await fetch("/api/disaster-course-completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        courseId: course.id,
        baseRevision: existing?.revision ?? 0,
        completedAt: patch.completedAt ?? existing?.completedAt ?? taiwanDateKey(),
        certificateNumber: patch.certificateNumber ?? existing?.certificateNumber ?? "",
        note: patch.note ?? existing?.note ?? "",
        snapshot: course,
      }),
    });
    if (!response.ok) {
      if (response.status === 409) await refresh();
      throw new Error(await responseError(response, "無法標記完成，請再試一次。"));
    }
    const payload = await response.json() as { completion: SavedRecognizedCourseCompletion };
    apply([payload.completion, ...completionsRef.current.filter((entry) => entry.courseId !== course.id)]);
    setStatus("ready");
    setNotice("");
    return payload.completion;
  }, [accountKey, apply, refresh]);

  const remove = useCallback(async (courseId: string) => {
    const existing = completionsRef.current.find((entry) => entry.courseId === courseId);
    if (!existing) return;
    if (accountKey === LOCAL_ACCOUNT_KEY) {
      const next = completionsRef.current.filter((entry) => entry.courseId !== courseId);
      try {
        writeLocal(accountKey, next);
        apply(next);
        setStatus("ready");
        setNotice("");
        return;
      } catch {
        throw new Error("完成紀錄暫時無法更新，請再試一次。");
      }
    }
    const response = await fetch("/api/disaster-course-completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", courseId, baseRevision: existing.revision }),
    });
    if (!response.ok) {
      if (response.status === 409) await refresh();
      throw new Error(await responseError(response, "無法取消完成標記，請再試一次。"));
    }
    apply(completionsRef.current.filter((entry) => entry.courseId !== courseId));
  }, [accountKey, apply, refresh]);

  const byCourseId = useMemo(() => new Map(completions.map((entry) => [entry.courseId, entry])), [completions]);

  return { completions, byCourseId, status, notice, save, remove, refresh };
}
