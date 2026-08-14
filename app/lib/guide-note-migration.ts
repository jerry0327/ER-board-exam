import { guideAnnotationResourceId, guideLegacyAnnotationId } from "./annotation-source.ts";
import type { GuideProgressRecord, StudyAnnotation } from "./types";

export type LegacyGuideNoteMigration = {
  chapterId: number;
  resourceId: string;
  annotationId: string;
  body: string;
  sharedAnnotationExists: boolean;
};

export type AnnotationMigrationStatus = "loading" | "synced" | "local" | "error";
export type GuideMigrationStatus = "loading" | "synced" | "offline";

/**
 * A legacy note may be cleared only when both stores have proven that they
 * belong to the same persistence scope. Signed-in data waits for both APIs to
 * finish syncing; anonymous data waits for both hooks to enter device-local
 * mode. Mixed states keep the legacy note intact for a later retry.
 */
export function guideNoteMigrationScopesAligned(
  annotationAccountKey: string | null,
  annotationStatus: AnnotationMigrationStatus,
  progressAccountKey: string | null,
  progressStatus: GuideMigrationStatus,
) {
  if (!annotationAccountKey || annotationAccountKey !== progressAccountKey) return false;
  if (annotationAccountKey === "anonymous-device") {
    return annotationStatus === "local" && progressStatus === "offline";
  }
  return annotationStatus === "synced" && progressStatus === "synced";
}

/** Return every legacy chapter note, not merely the currently open chapter. */
export function legacyGuideNoteMigrationPlan(
  records: GuideProgressRecord[],
  annotations: StudyAnnotation[],
): LegacyGuideNoteMigration[] {
  const annotationKeys = new Set(annotations.map((annotation) => `${annotation.questionId}\u0000${annotation.id}`));
  return records.flatMap((record) => {
    const body = typeof record.note === "string" ? record.note.trim() : "";
    const resourceId = guideAnnotationResourceId(record.chapterId);
    const annotationId = resourceId ? guideLegacyAnnotationId(resourceId) : null;
    if (!body || !resourceId || !annotationId) return [];
    return [{
      chapterId: record.chapterId,
      resourceId,
      annotationId,
      body,
      sharedAnnotationExists: annotationKeys.has(`${resourceId}\u0000${annotationId}`),
    }];
  });
}

export async function executeLegacyGuideNoteMigration(
  plan: LegacyGuideNoteMigration[],
  onUpsert: (item: LegacyGuideNoteMigration) => Promise<unknown>,
  onClear: (chapterId: number) => Promise<unknown>,
) {
  for (const item of plan) {
    if (!item.sharedAnnotationExists) await onUpsert(item);
    await onClear(item.chapterId);
  }
}
