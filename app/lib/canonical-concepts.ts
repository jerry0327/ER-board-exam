import type { ProgressRecord, QuestionIndex } from "./types";

export type CanonicalSelectionMode = "concept" | "full-paper";

export type CanonicalProgressState = {
  recordCount: number;
  attempts: number;
  correctAttempts: number;
  bookmarked: boolean;
  wrongState: ProgressRecord["wrongState"];
  pending: boolean;
  mastered: boolean;
  due: boolean;
  dueAt: string | null;
  latestRecord: ProgressRecord | null;
};

export type CanonicalConcept = {
  id: string;
  members: QuestionIndex[];
  memberIds: string[];
  anchor: QuestionIndex;
  representative: QuestionIndex;
  progress: CanonicalProgressState;
};

export type CanonicalDedupeOptions = {
  mode?: CanonicalSelectionMode;
  progressMap?: ReadonlyMap<string, ProgressRecord>;
};

const EMPTY_PROGRESS = new Map<string, ProgressRecord>();

export function canonicalConceptId(question: Pick<QuestionIndex, "id" | "canonicalId">) {
  return question.canonicalId ?? question.id;
}

export function groupQuestionsByCanonical(questions: readonly QuestionIndex[]) {
  const groups = new Map<string, QuestionIndex[]>();
  for (const question of questions) {
    const id = canonicalConceptId(question);
    const members = groups.get(id);
    if (members) members.push(question);
    else groups.set(id, [question]);
  }
  return groups;
}

/** Stable metadata owner used for reporting, independent of recent activity. */
export function selectCanonicalAnchor(members: readonly QuestionIndex[]) {
  if (!members.length) return undefined;
  const stableMembers = [...members].sort((left, right) => left.id.localeCompare(right.id));
  const canonicalId = canonicalConceptId(stableMembers[0]);
  return stableMembers.find((question) => question.id === canonicalId) ?? stableMembers[0];
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function progressTimestamp(record: ProgressRecord) {
  // Scheduling state belongs to the latest actual attempt. A later bookmark
  // or reading-state write on a parallel row must not revive an older wrong
  // answer. updatedAt remains the fallback for legacy records without an
  // attempt timestamp.
  return timestamp(record.lastAttemptAt) || timestamp(record.updatedAt);
}

function compareProgressEntries(
  left: { question: QuestionIndex; record: ProgressRecord },
  right: { question: QuestionIndex; record: ProgressRecord },
) {
  const leftAttempted = timestamp(left.record.lastAttemptAt) > 0 ? 1 : 0;
  const rightAttempted = timestamp(right.record.lastAttemptAt) > 0 ? 1 : 0;
  return rightAttempted - leftAttempted
    || progressTimestamp(right.record) - progressTimestamp(left.record)
    || right.record.attempts - left.record.attempts
    || left.question.id.localeCompare(right.question.id);
}

function progressEntries(
  members: readonly QuestionIndex[],
  progressMap: ReadonlyMap<string, ProgressRecord>,
) {
  return members.flatMap((question) => {
    const record = progressMap.get(question.id);
    return record ? [{ question, record }] : [];
  });
}

/**
 * Picks the member that most recently changed. With no progress, the member
 * whose id is the canonical id wins, followed by a stable lexical fallback.
 */
export function selectCanonicalRepresentative(
  members: readonly QuestionIndex[],
  progressMap: ReadonlyMap<string, ProgressRecord> = EMPTY_PROGRESS,
) {
  if (!members.length) return undefined;
  const stableMembers = [...members].sort((left, right) => left.id.localeCompare(right.id));
  const entries = progressEntries(stableMembers, progressMap)
    .sort(compareProgressEntries);
  if (entries.length) return entries[0].question;
  return selectCanonicalAnchor(stableMembers);
}

/**
 * Rolls legacy per-question progress up to concept level. Attempts and
 * bookmarks aggregate across variants, while the most recently attempted
 * variant owns mutable learning state. This prevents stale parallel rows from
 * keeping a concept pending or overdue after a newer successful review.
 */
export function aggregateCanonicalProgress(
  members: readonly QuestionIndex[],
  progressMap: ReadonlyMap<string, ProgressRecord>,
  now: string | number | Date = Date.now(),
): CanonicalProgressState {
  const entries = progressEntries(members, progressMap);
  const records = entries.map(({ record }) => record);
  const nowTime = now instanceof Date
    ? now.getTime()
    : typeof now === "number"
      ? now
      : timestamp(now);
  const latest = [...entries].sort(compareProgressEntries)[0]?.record ?? null;
  const wrongState: ProgressRecord["wrongState"] = latest?.wrongState ?? "none";
  const dueAt = latest?.dueAt ?? null;
  const dueTime = timestamp(dueAt);

  return {
    recordCount: records.length,
    attempts: records.reduce((total, record) => total + record.attempts, 0),
    correctAttempts: records.reduce((total, record) => total + record.correctAttempts, 0),
    bookmarked: records.some((record) => record.bookmarked === 1),
    wrongState,
    pending: wrongState === "pending",
    mastered: wrongState === "mastered",
    due: dueTime > 0 && Number.isFinite(nowTime) && dueTime <= nowTime,
    dueAt,
    latestRecord: latest,
  };
}

export function buildCanonicalConcepts(
  questions: readonly QuestionIndex[],
  progressMap: ReadonlyMap<string, ProgressRecord> = EMPTY_PROGRESS,
  now: string | number | Date = Date.now(),
) {
  return [...groupQuestionsByCanonical(questions)].map(([id, members]): CanonicalConcept => ({
    id,
    members,
    memberIds: members.map((question) => question.id),
    anchor: selectCanonicalAnchor(members) ?? members[0],
    representative: selectCanonicalRepresentative(members, progressMap) ?? members[0],
    progress: aggregateCanonicalProgress(members, progressMap, now),
  }));
}

/**
 * Concept practice receives one representative per canonical id. A caller
 * launching an actual paper must pass `mode: "full-paper"`; that returns the
 * source sequence untouched, including parallel questions and repeated ids.
 */
export function dedupeCanonicalQuestions(
  questions: readonly QuestionIndex[],
  options: CanonicalDedupeOptions = {},
) {
  if (options.mode === "full-paper") return [...questions];
  return buildCanonicalConcepts(questions, options.progressMap).map((concept) => concept.representative);
}

export function dedupeCanonicalQuestionIds(
  ids: readonly string[],
  questionById: ReadonlyMap<string, QuestionIndex>,
  options: CanonicalDedupeOptions = {},
) {
  if (options.mode === "full-paper") return [...ids];

  const order: string[] = [];
  const knownGroups = new Map<string, QuestionIndex[]>();
  const unknownIds = new Map<string, string>();
  for (const id of ids) {
    const question = questionById.get(id);
    const key = question ? `known:${canonicalConceptId(question)}` : `unknown:${id}`;
    if (!knownGroups.has(key) && !unknownIds.has(key)) order.push(key);
    if (question) {
      const members = knownGroups.get(key) ?? [];
      if (!members.some((member) => member.id === question.id)) members.push(question);
      knownGroups.set(key, members);
    } else {
      unknownIds.set(key, id);
    }
  }

  return order.map((key) => {
    const members = knownGroups.get(key);
    if (!members) return unknownIds.get(key)!;
    return selectCanonicalRepresentative(members, options.progressMap)?.id ?? members[0].id;
  });
}
