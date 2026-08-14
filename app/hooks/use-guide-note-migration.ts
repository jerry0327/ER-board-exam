"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  executeLegacyGuideNoteMigration,
  guideNoteMigrationScopesAligned,
  legacyGuideNoteMigrationPlan,
} from "../lib/guide-note-migration";
import type { GuideProgressRecord, StudyAnnotation } from "../lib/types";

type Props = {
  progress: GuideProgressRecord[];
  progressStatus: "loading" | "synced" | "offline";
  progressAccountKey: string | null;
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  annotationAccountKey: string | null;
  onUpsert: (draft: {
    id: string;
    questionId: string;
    kind: "question_note";
    body: string;
  }) => Promise<unknown>;
  onClearLegacyNote: (chapterId: number, value: "") => Promise<unknown>;
};

/**
 * One app-level pass migrates every old guide_progress.note into the shared
 * annotation pipeline, even when its chapter has never been opened this
 * session. The legacy field is cleared only after the annotation write is
 * durable; an existing shared note always wins and is never overwritten.
 */
export function useGuideNoteMigration({
  progress,
  progressStatus,
  progressAccountKey,
  annotations,
  annotationStatus,
  annotationAccountKey,
  onUpsert,
  onClearLegacyNote,
}: Props) {
  const [retry, setRetry] = useState(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(false);
  const retryTimerRef = useRef(0);
  const scopeRef = useRef({
    annotationAccountKey,
    annotationStatus,
    progressAccountKey,
    progressStatus,
  });
  const plan = useMemo(
    () => legacyGuideNoteMigrationPlan(progress, annotations),
    [annotations, progress],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    scopeRef.current = {
      annotationAccountKey,
      annotationStatus,
      progressAccountKey,
      progressStatus,
    };
  }, [annotationAccountKey, annotationStatus, progressAccountKey, progressStatus]);

  useEffect(() => {
    if (!guideNoteMigrationScopesAligned(
      annotationAccountKey,
      annotationStatus,
      progressAccountKey,
      progressStatus,
    ) || !plan.length || runningRef.current) return;
    const scopeAtStart = scopeRef.current;
    const scopeStillAligned = () => {
      const current = scopeRef.current;
      return current.annotationAccountKey === scopeAtStart.annotationAccountKey
        && current.annotationStatus === scopeAtStart.annotationStatus
        && current.progressAccountKey === scopeAtStart.progressAccountKey
        && current.progressStatus === scopeAtStart.progressStatus
        && guideNoteMigrationScopesAligned(
          current.annotationAccountKey,
          current.annotationStatus,
          current.progressAccountKey,
          current.progressStatus,
        );
    };
    let failed = false;
    runningRef.current = true;
    void executeLegacyGuideNoteMigration(
      plan,
      (item) => {
        if (!scopeStillAligned()) throw new Error("guide note migration scope changed");
        return onUpsert({
          id: item.annotationId,
          questionId: item.resourceId,
          kind: "question_note",
          body: item.body,
        });
      },
      (chapterId) => {
        if (!scopeStillAligned()) throw new Error("guide note migration scope changed");
        return onClearLegacyNote(chapterId, "");
      },
    ).catch(() => {
      failed = true;
      if (mountedRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => setRetry((value) => value + 1), 1_500);
      }
    }).finally(() => {
      runningRef.current = false;
      if (mountedRef.current && !failed) setRetry((value) => value + 1);
    });
  }, [
    annotationAccountKey,
    annotationStatus,
    onClearLegacyNote,
    onUpsert,
    plan,
    progressAccountKey,
    progressStatus,
    retry,
  ]);
}
