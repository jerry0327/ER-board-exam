import type { StudyAnnotation } from "./types";

export type AnnotationMigrationOutboxEntry = {
  mutationId: string;
  action: "upsert";
  baseRevision: 0;
  annotation: StudyAnnotation;
};

export type AnnotationMigrationPlan = {
  annotations: StudyAnnotation[];
  outbox: AnnotationMigrationOutboxEntry[];
};

function stableHash(value: string) {
  // Two independent 32-bit FNV-1a lanes keep generated ids compact while
  // making a collision with an unrelated note vanishingly unlikely.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36).padStart(7, "0")}${(second >>> 0).toString(36).padStart(7, "0")}`;
}

function semanticValue(annotation: StudyAnnotation) {
  return JSON.stringify([
    annotation.questionId,
    annotation.kind,
    annotation.body,
    annotation.quote,
    annotation.prefix,
    annotation.suffix,
    annotation.startOffset,
    annotation.endOffset,
    Boolean(annotation.deletedAt),
  ]);
}

export function sameAnnotationContent(left: StudyAnnotation, right: StudyAnnotation) {
  return semanticValue(left) === semanticValue(right);
}

function duplicateId(annotation: StudyAnnotation) {
  const readerScope = /^(h_r_(?:original|concise)_(?:quick|standard|full|raw)_)/u.exec(annotation.id)?.[1];
  const guideScope = /^(h_gt\d{3}_(?:concise|detailed)-(?:quick|focus|full|raw)_)/u.exec(annotation.id)?.[1];
  const legacyScope = annotation.id.startsWith("h_c_") ? "h_c_" : annotation.id.startsWith("h_") ? "h_" : null;
  const prefix = readerScope ?? guideScope ?? legacyScope ?? "q_m_";
  const original = annotation.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(-28);
  const marker = stableHash(`${annotation.id}\u0000${semanticValue(annotation)}`);
  return `${prefix}${prefix === "q_m_" ? "" : "m_"}${marker}_${original}`.slice(0, 100);
}

function migratedAnnotation(annotation: StudyAnnotation, id: string): StudyAnnotation {
  return {
    ...annotation,
    id,
    revision: 1,
    deletedAt: null,
    syncState: "pending",
  };
}

/**
 * Plan a one-way anonymous-device import without ever overwriting account
 * data. Identical records are idempotent no-ops. A different account record
 * with the same id keeps its id and the anonymous record receives a stable
 * duplicate id, so rerunning after a crash cannot create another copy.
 */
export function planAnonymousAnnotationMigration(
  accountKey: string,
  anonymous: StudyAnnotation[],
  targetVariants: StudyAnnotation[],
): AnnotationMigrationPlan {
  const occupied = new Map<string, StudyAnnotation[]>();
  for (const annotation of targetVariants) {
    const current = occupied.get(annotation.id) ?? [];
    current.push(annotation);
    occupied.set(annotation.id, current);
  }

  const annotations: StudyAnnotation[] = [];
  const outbox: AnnotationMigrationOutboxEntry[] = [];
  for (const source of anonymous) {
    if (source.deletedAt) continue;
    const original = occupied.get(source.id) ?? [];
    // A stale local account cache can match the anonymous note while the
    // current server row with the same id differs. Only skip when every known
    // target variant agrees; otherwise preserve the anonymous value under a
    // duplicate id.
    if (original.length && original.every((candidate) => sameAnnotationContent(candidate, source))) continue;

    const id = original.length ? duplicateId(source) : source.id;
    // The deterministic duplicate id is also the durable migration marker.
    // If the user edited the imported copy before an interrupted migration
    // reruns, keep that edit and do not manufacture another duplicate.
    if (occupied.has(id)) continue;

    const annotation = migratedAnnotation(source, id);
    const fingerprint = stableHash(`${accountKey}\u0000${source.id}\u0000${id}\u0000${semanticValue(source)}`);
    const entry: AnnotationMigrationOutboxEntry = {
      mutationId: `am_${fingerprint}`,
      action: "upsert",
      baseRevision: 0,
      annotation,
    };
    annotations.push(annotation);
    outbox.push(entry);
    occupied.set(id, [annotation]);
  }
  return { annotations, outbox };
}

export function annotationMigrationSnapshot(annotation: StudyAnnotation) {
  return stableHash(JSON.stringify([
    annotation.id,
    annotation.revision,
    annotation.createdAt,
    annotation.updatedAt,
    annotation.deletedAt,
    annotation.syncState,
    semanticValue(annotation),
  ]));
}
