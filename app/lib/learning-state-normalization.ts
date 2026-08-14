import { parseAnyGuideAnnotationResourceId } from "./annotation-source.ts";
import type {
  AttemptRecord,
  Confidence,
  GuideProgressRecord,
  GuideReadState,
  GuideResourceProgressRecord,
  PracticeMode,
  ProgressAction,
  ProgressRecord,
} from "./types";

const EPOCH = "1970-01-01T00:00:00.000Z";
const QUESTION_ID = /^\d{3}[AB]?-Q\d{3}$/u;
const CONFIDENCE = new Set<Confidence>(["low", "normal", "high"]);
const PRACTICE_MODE = new Set<PracticeMode>(["study", "exam"]);
const READ_STATE = new Set<GuideReadState>(["unread", "reading", "done", "later"]);
const WRONG_STATE = new Set<ProgressRecord["wrongState"]>(["none", "pending", "mastered"]);

export type NormalizedProgressOutboxEntry = {
  id: string;
  queuedAt: string;
  generation: number;
  action: ProgressAction;
};

export type NormalizedGuideAction =
  | { action: "open"; chapterId: number; contentHash?: string | null }
  | { action: "read"; chapterId: number; value: GuideReadState; contentHash?: string | null }
  | { action: "bookmark"; chapterId: number; value: boolean }
  | { action: "note"; chapterId: number; value: string };

export type NormalizedGuideOutboxEntry = {
  id: string;
  queuedAt: string;
  action: NormalizedGuideAction;
};

export type NormalizedGuideResourceAction =
  | { action: "open"; resourceId: string; contentHash?: string | null }
  | { action: "read"; resourceId: string; value: GuideReadState; contentHash?: string | null }
  | { action: "bookmark"; resourceId: string; value: boolean };

export type NormalizedGuideResourceOutboxEntry = {
  id: string;
  queuedAt: string;
  action: NormalizedGuideResourceAction;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function nullableDate(value: unknown) {
  return validDate(value) ? value : null;
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function bitOrNull(value: unknown) {
  return value === 0 || value === 1 ? value : null;
}

function contentHash(value: unknown) {
  return typeof value === "string" && value.length <= 256 ? value : null;
}

function stringOr(value: unknown, fallback: string, maximum = 256) {
  return typeof value === "string" ? value.slice(0, maximum) : fallback;
}

function normalizeSelectedKeys(value: unknown) {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      candidate = [];
    }
  }
  const keys = Array.isArray(candidate)
    ? candidate.filter((key): key is string => typeof key === "string").slice(0, 16)
    : [];
  return JSON.stringify(keys);
}

function dedupeNewest<T>(items: T[], keyOf: (item: T) => string | number, dateOf: (item: T) => string) {
  const values = new Map<string | number, T>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = values.get(key);
    if (!existing || Date.parse(dateOf(item)) >= Date.parse(dateOf(existing))) values.set(key, item);
  }
  return [...values.values()];
}

export function normalizeProgressRecord(value: unknown): ProgressRecord | null {
  if (!isRecord(value) || typeof value.questionId !== "string" || !QUESTION_ID.test(value.questionId)) return null;
  const attempts = nonNegativeInteger(value.attempts);
  const correctAttempts = Math.min(attempts, nonNegativeInteger(value.correctAttempts));
  const lastAttemptAt = nullableDate(value.lastAttemptAt);
  const dueAt = nullableDate(value.dueAt);
  const updatedAt = validDate(value.updatedAt) ? value.updatedAt : lastAttemptAt ?? dueAt ?? EPOCH;
  return {
    userId: stringOr(value.userId, "cached"),
    questionId: value.questionId,
    attempts,
    correctAttempts,
    firstAttemptCorrect: bitOrNull(value.firstAttemptCorrect),
    lastAnswer: typeof value.lastAnswer === "string" ? normalizeSelectedKeys(value.lastAnswer) : null,
    lastCorrect: bitOrNull(value.lastCorrect),
    lastConfidence: CONFIDENCE.has(value.lastConfidence as Confidence) ? value.lastConfidence as Confidence : null,
    bookmarked: value.bookmarked === 1 ? 1 : 0,
    readState: READ_STATE.has(value.readState as GuideReadState) ? value.readState as GuideReadState : "unread",
    wrongState: WRONG_STATE.has(value.wrongState as ProgressRecord["wrongState"])
      ? value.wrongState as ProgressRecord["wrongState"]
      : "none",
    streak: nonNegativeInteger(value.streak),
    dueAt,
    lastAttemptAt,
    updatedAt,
  };
}

export function normalizeAttemptRecord(value: unknown): AttemptRecord | null {
  if (
    !isRecord(value)
    || typeof value.questionId !== "string"
    || !QUESTION_ID.test(value.questionId)
    || !validDate(value.createdAt)
  ) return null;
  return {
    id: Number.isSafeInteger(value.id) ? Number(value.id) : 0,
    mutationId: typeof value.mutationId === "string" ? value.mutationId.slice(0, 256) : null,
    questionId: value.questionId,
    selectedKeys: normalizeSelectedKeys(value.selectedKeys),
    correct: bitOrNull(value.correct),
    confidence: CONFIDENCE.has(value.confidence as Confidence) ? value.confidence as Confidence : "normal",
    mode: PRACTICE_MODE.has(value.mode as PracticeMode) ? value.mode as PracticeMode : "study",
    createdAt: value.createdAt,
  };
}

export function normalizeProgressSnapshot(value: unknown) {
  const candidate = isRecord(value) ? value : {};
  const progress = Array.isArray(candidate.progress)
    ? candidate.progress.map(normalizeProgressRecord).filter((record): record is ProgressRecord => Boolean(record))
    : [];
  const attempts = Array.isArray(candidate.attempts)
    ? candidate.attempts.map(normalizeAttemptRecord).filter((record): record is AttemptRecord => Boolean(record)).slice(0, 1000)
    : [];
  return {
    progress: dedupeNewest(progress, (record) => record.questionId, (record) => record.updatedAt),
    attempts,
  };
}

export function normalizeProgressOutboxEntry(value: unknown): NormalizedProgressOutboxEntry | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || !value.id
    || !validDate(value.queuedAt)
    || !Number.isSafeInteger(value.generation)
    || Number(value.generation) < 0
    || !isRecord(value.action)
  ) return null;
  const action = value.action;
  if (typeof action.questionId !== "string" || !QUESTION_ID.test(action.questionId)) return null;
  let normalized: ProgressAction;
  if (action.action === "attempt") {
    if (
      typeof action.mutationId !== "string"
      || !Array.isArray(action.selectedKeys)
      || action.selectedKeys.some((key) => typeof key !== "string")
      || !(action.correct === true || action.correct === false || action.correct === null)
      || !CONFIDENCE.has(action.confidence as Confidence)
      || !PRACTICE_MODE.has(action.mode as PracticeMode)
      || (action.attemptedAt !== undefined && !validDate(action.attemptedAt))
    ) return null;
    normalized = {
      action: "attempt",
      mutationId: action.mutationId,
      questionId: action.questionId,
      selectedKeys: action.selectedKeys.slice(0, 16) as string[],
      correct: action.correct,
      confidence: action.confidence as Confidence,
      mode: action.mode as PracticeMode,
      attemptedAt: action.attemptedAt as string | undefined,
    };
  } else if (action.action === "bookmark" && typeof action.value === "boolean") {
    normalized = { action: "bookmark", questionId: action.questionId, value: action.value };
  } else if (action.action === "read" && READ_STATE.has(action.value as GuideReadState)) {
    normalized = { action: "read", questionId: action.questionId, value: action.value as GuideReadState };
  } else if (action.action === "mastery" && WRONG_STATE.has(action.value as ProgressRecord["wrongState"])) {
    normalized = { action: "mastery", questionId: action.questionId, value: action.value as ProgressRecord["wrongState"] };
  } else {
    return null;
  }
  return { id: value.id, queuedAt: value.queuedAt, generation: Number(value.generation), action: normalized };
}

function normalizeGuideReadState(value: unknown): GuideReadState {
  return READ_STATE.has(value as GuideReadState) ? value as GuideReadState : "unread";
}

export function normalizeGuideProgressRecord(value: unknown): GuideProgressRecord | null {
  if (!isRecord(value) || !Number.isInteger(value.chapterId) || Number(value.chapterId) < 1 || Number(value.chapterId) > 303) return null;
  const updatedAt = validDate(value.updatedAt) ? value.updatedAt : nullableDate(value.lastOpenedAt) ?? EPOCH;
  return {
    userId: stringOr(value.userId, "cached"),
    chapterId: Number(value.chapterId),
    readState: normalizeGuideReadState(value.readState),
    bookmarked: value.bookmarked === 1 ? 1 : 0,
    note: stringOr(value.note, "", 12_000),
    contentHash: contentHash(value.contentHash),
    lastOpenedAt: nullableDate(value.lastOpenedAt),
    completedAt: nullableDate(value.completedAt),
    updatedAt,
  };
}

export function normalizeGuideProgressRecords(value: unknown) {
  if (!Array.isArray(value)) return [];
  const records = value.map(normalizeGuideProgressRecord).filter((record): record is GuideProgressRecord => Boolean(record));
  return dedupeNewest(records, (record) => record.chapterId, (record) => record.updatedAt);
}

export function normalizeGuideOutboxEntry(value: unknown): NormalizedGuideOutboxEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || !validDate(value.queuedAt) || !isRecord(value.action)) return null;
  const action = value.action;
  if (!Number.isInteger(action.chapterId) || Number(action.chapterId) < 1 || Number(action.chapterId) > 303) return null;
  const chapterId = Number(action.chapterId);
  let normalized: NormalizedGuideAction;
  if (action.action === "open") {
    normalized = { action: "open", chapterId, contentHash: contentHash(action.contentHash) };
  } else if (action.action === "read" && READ_STATE.has(action.value as GuideReadState)) {
    normalized = { action: "read", chapterId, value: action.value as GuideReadState, contentHash: contentHash(action.contentHash) };
  } else if (action.action === "bookmark" && typeof action.value === "boolean") {
    normalized = { action: "bookmark", chapterId, value: action.value };
  } else if (action.action === "note" && typeof action.value === "string") {
    normalized = { action: "note", chapterId, value: action.value.slice(0, 12_000) };
  } else {
    return null;
  }
  return { id: value.id, queuedAt: value.queuedAt, action: normalized };
}

export function normalizeGuideResourceProgressRecord(value: unknown): GuideResourceProgressRecord | null {
  if (!isRecord(value) || typeof value.resourceId !== "string" || !parseAnyGuideAnnotationResourceId(value.resourceId)) return null;
  const updatedAt = validDate(value.updatedAt) ? value.updatedAt : nullableDate(value.lastOpenedAt) ?? EPOCH;
  return {
    userId: stringOr(value.userId, "cached"),
    resourceId: value.resourceId,
    readState: normalizeGuideReadState(value.readState),
    bookmarked: value.bookmarked === 1 ? 1 : 0,
    contentHash: contentHash(value.contentHash),
    lastOpenedAt: nullableDate(value.lastOpenedAt),
    completedAt: nullableDate(value.completedAt),
    updatedAt,
  };
}

export function normalizeGuideResourceProgressRecords(value: unknown) {
  if (!Array.isArray(value)) return [];
  const records = value.map(normalizeGuideResourceProgressRecord)
    .filter((record): record is GuideResourceProgressRecord => Boolean(record));
  return dedupeNewest(records, (record) => record.resourceId, (record) => record.updatedAt);
}

export function normalizeGuideResourceOutboxEntry(value: unknown): NormalizedGuideResourceOutboxEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || !validDate(value.queuedAt) || !isRecord(value.action)) return null;
  const action = value.action;
  if (typeof action.resourceId !== "string" || !parseAnyGuideAnnotationResourceId(action.resourceId)) return null;
  let normalized: NormalizedGuideResourceAction;
  if (action.action === "open") {
    normalized = { action: "open", resourceId: action.resourceId, contentHash: contentHash(action.contentHash) };
  } else if (action.action === "read" && READ_STATE.has(action.value as GuideReadState)) {
    normalized = { action: "read", resourceId: action.resourceId, value: action.value as GuideReadState, contentHash: contentHash(action.contentHash) };
  } else if (action.action === "bookmark" && typeof action.value === "boolean") {
    normalized = { action: "bookmark", resourceId: action.resourceId, value: action.value };
  } else {
    return null;
  }
  return { id: value.id, queuedAt: value.queuedAt, action: normalized };
}
