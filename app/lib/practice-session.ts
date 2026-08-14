import type { Confidence, PracticeMode, PracticeSession } from "./types";

export const ACTIVE_PRACTICE_SESSION_KEY = "em-board-active-session-v1";
export const ACTIVE_PRACTICE_SESSION_EVENT = "em-board-active-session-change";
export const PRACTICE_SESSION_SCHEMA_VERSION = 2 as const;

type SessionRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SessionRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item)))] : [];
}

function answerRecord(value: unknown, validIds: Set<string>) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id]) => validIds.has(id))
      .map(([id, keys]) => [id, stringList(keys)]),
  );
}

function confidenceRecord(value: unknown, validIds: Set<string>) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Confidence] => validIds.has(entry[0]) && ["low", "normal", "high"].includes(String(entry[1])),
    ),
  );
}

function scratchpadRecord(value: unknown, validIds: Set<string>) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => validIds.has(entry[0]) && typeof entry[1] === "string")
      .map(([id, draft]) => [id, draft.slice(0, 4000)]),
  );
}

/**
 * Accepts the original v1 payload as well as the current payload. Keeping the
 * storage key stable means an interrupted session survives the migration.
 */
export function normalizePracticeSession(value: unknown): PracticeSession | null {
  if (!isRecord(value)) return null;
  const ids = stringList(value.ids);
  if (!ids.length) return null;
  const validIds = new Set(ids);
  const mode: PracticeMode = value.mode === "exam" ? "exam" : "study";
  const startedAt = validIso(value.startedAt) ?? new Date().toISOString();
  const completedAt = validIso(value.completedAt);
  const pausedAt = validIso(value.pausedAt);
  const rawCursor = typeof value.cursor === "number" && Number.isFinite(value.cursor) ? Math.trunc(value.cursor) : 0;
  const cursor = Math.min(ids.length - 1, Math.max(0, rawCursor));
  const accumulatedPausedMs = typeof value.accumulatedPausedMs === "number" && Number.isFinite(value.accumulatedPausedMs)
    ? Math.max(0, Math.trunc(value.accumulatedPausedMs))
    : 0;

  return {
    schemaVersion: PRACTICE_SESSION_SCHEMA_VERSION,
    ids,
    cursor,
    mode,
    answers: answerRecord(value.answers, validIds),
    confidence: confidenceRecord(value.confidence, validIds),
    eliminatedOptions: answerRecord(value.eliminatedOptions, validIds),
    scratchpads: scratchpadRecord(value.scratchpads, validIds),
    submitted: stringList(value.submitted).filter((id) => validIds.has(id)),
    flaggedIds: stringList(value.flaggedIds).filter((id) => validIds.has(id)),
    timerEnabled: typeof value.timerEnabled === "boolean" ? value.timerEnabled : mode === "exam",
    reviewing: mode === "exam" && value.reviewing === true,
    completed: value.completed === true,
    startedAt,
    ...(pausedAt ? { pausedAt } : {}),
    ...(accumulatedPausedMs ? { accumulatedPausedMs } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

function parseStoredSession(raw: string | null) {
  if (!raw) return { session: null, current: false, savedAt: 0, present: false, deleted: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = isRecord(parsed) ? parsed : {};
    const deleted = record.deleted === true;
    const session = deleted ? null : normalizePracticeSession(parsed);
    return {
      session,
      current: record.schemaVersion === PRACTICE_SESSION_SCHEMA_VERSION,
      savedAt: Date.parse(validIso(record.savedAt) ?? session?.completedAt ?? session?.pausedAt ?? session?.startedAt ?? "") || 0,
      present: deleted || Boolean(session),
      deleted,
    };
  } catch {
    return { session: null, current: false, savedAt: 0, present: false, deleted: false };
  }
}

export function activePracticeSessionKey(accountKey: string, namespace = "board") {
  const prefix = namespace === "board"
    ? ACTIVE_PRACTICE_SESSION_KEY
    : `${ACTIVE_PRACTICE_SESSION_KEY}:${encodeURIComponent(namespace)}`;
  return `${prefix}:${encodeURIComponent(accountKey)}`;
}

function newerStoredSession(
  left: ReturnType<typeof parseStoredSession>,
  right: ReturnType<typeof parseStoredSession>,
) {
  if (!left.present) return right;
  if (!right.present) return left;
  return right.savedAt > left.savedAt ? right : left;
}

function persistMigration(key: string, session: PracticeSession) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...session, savedAt: new Date().toISOString() }));
    try { window.sessionStorage.removeItem(key); } catch { /* The durable copy is authoritative. */ }
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ ...session, savedAt: new Date().toISOString() }));
      return false;
    } catch {
      return false;
    }
  }
}

/** Read the current account's durable session and migrate the former global key once. */
export function readActivePracticeSession(accountKey: string, namespace = "board"): PracticeSession | null {
  if (typeof window === "undefined" || !accountKey) return null;
  const key = activePracticeSessionKey(accountKey, namespace);
  let durable = parseStoredSession(null);
  let tab = parseStoredSession(null);
  try {
    durable = parseStoredSession(window.localStorage.getItem(key));
  } catch {
    // A sessionStorage copy can still keep the current tab usable.
  }
  try {
    tab = parseStoredSession(window.sessionStorage.getItem(key));
  } catch {
    // Ignore an inaccessible tab store.
  }
  const selected = newerStoredSession(durable, tab);

  // A newer signed-out or legacy session can follow the user into the current
  // account. Compare timestamps even when the account already has a deletion
  // marker so an older discard cannot hide newer work.
  let migration = parseStoredSession(null);
  let migrationKey: string | null = null;
  if (namespace === "board" && accountKey !== "anonymous-device") {
    const anonymousKey = activePracticeSessionKey("anonymous-device");
    let anonymousDurable = parseStoredSession(null);
    let anonymousTab = parseStoredSession(null);
    try { anonymousDurable = parseStoredSession(window.localStorage.getItem(anonymousKey)); } catch { /* Anonymous local storage may be unavailable. */ }
    try { anonymousTab = parseStoredSession(window.sessionStorage.getItem(anonymousKey)); } catch { /* Ignore an inaccessible anonymous tab store. */ }
    const anonymous = newerStoredSession(anonymousDurable, anonymousTab);
    if (anonymous.session && anonymous.savedAt > migration.savedAt) {
      migration = anonymous;
      migrationKey = anonymousKey;
    }
  }
  if (namespace === "board") {
    let legacyDurable = parseStoredSession(null);
    let legacyTab = parseStoredSession(null);
    try { legacyDurable = parseStoredSession(window.localStorage.getItem(ACTIVE_PRACTICE_SESSION_KEY)); } catch { /* Legacy local storage may be unavailable. */ }
    try { legacyTab = parseStoredSession(window.sessionStorage.getItem(ACTIVE_PRACTICE_SESSION_KEY)); } catch { /* Ignore an inaccessible legacy tab store. */ }
    const legacy = newerStoredSession(legacyDurable, legacyTab);
    if (legacy.session && legacy.savedAt > migration.savedAt) {
      migration = legacy;
      migrationKey = ACTIVE_PRACTICE_SESSION_KEY;
    }
  }
  if (migration.session && migration.savedAt > selected.savedAt) {
    if (persistMigration(key, migration.session) && migrationKey) {
      try { window.localStorage.removeItem(migrationKey); } catch { /* The account-scoped copy is safe. */ }
      try { window.sessionStorage.removeItem(migrationKey); } catch { /* The account-scoped copy is safe. */ }
    }
    return migration.session;
  }

  // A deletion marker wins over any older session copy and prevents a legacy
  // global payload from resurrecting a deliberately discarded session.
  if (selected.deleted) {
    if (selected === tab && selected.savedAt > durable.savedAt) {
      try {
        window.localStorage.setItem(key, JSON.stringify({ schemaVersion: PRACTICE_SESSION_SCHEMA_VERSION, deleted: true, savedAt: new Date(selected.savedAt).toISOString() }));
        window.sessionStorage.removeItem(key);
      } catch {
        // Keep the newer tab-scoped deletion marker authoritative.
      }
    }
    return null;
  }

  if (!selected.session) {
    return null;
  }

  // Keep the newest fallback copy if localStorage rejected a recent write;
  // only clear it after a successful durable migration.
  if ((!durable.session || !durable.current || selected === tab) && persistMigration(key, selected.session)) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // The migrated localStorage copy is already authoritative.
    }
  }
  return selected.session;
}

/** Persist and notify same-tab consumers such as the dashboard resume card. */
export function writeActivePracticeSession(value: PracticeSession | null, accountKey: string, namespace = "board") {
  if (typeof window === "undefined" || !accountKey) return false;
  const key = activePracticeSessionKey(accountKey, namespace);
  const savedAt = new Date().toISOString();
  const payload = value
    ? JSON.stringify({ ...value, savedAt })
    : JSON.stringify({ schemaVersion: PRACTICE_SESSION_SCHEMA_VERSION, deleted: true, savedAt });
  let saved = false;
  let durableSaved = false;
  try {
    window.localStorage.setItem(key, payload);
    saved = true;
    durableSaved = true;
  } catch {
    // Fall through to the tab-scoped store below.
  }
  if (durableSaved) {
    try {
      window.sessionStorage.removeItem(key);
      saved = true;
    } catch {
      // A durable save is still sufficient.
    }
  } else {
    try {
      window.sessionStorage.setItem(key, payload);
      saved = true;
    } catch { /* Keep the in-memory session usable. */ }
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PRACTICE_SESSION_EVENT, { detail: { accountKey, namespace, session: value } }));
  return saved;
}

/**
 * Reconciles concurrent edits of the same session. Incoming values own direct
 * conflicts, while answers made on different questions and submitted ids are
 * preserved so two tabs converge instead of erasing one another.
 */
export function mergePracticeSessions(current: PracticeSession | null, incoming: PracticeSession | null) {
  if (!current || !incoming) return incoming;
  const sameIdentity = current.startedAt === incoming.startedAt
    && current.mode === incoming.mode
    && current.ids.length === incoming.ids.length
    && current.ids.every((id, index) => incoming.ids[index] === id);
  if (!sameIdentity) return incoming;
  // Completion is a commit boundary: the submitted tab's exact answers must
  // remain aligned with the already-created outbox batch and result score.
  if (incoming.completed) return incoming;
  if (current.completed) return current;

  const currentOnlyAnswers = Object.keys(current.answers).some((id) => !(id in incoming.answers));
  const currentOnlyConfidence = Object.keys(current.confidence).some((id) => !(id in incoming.confidence));
  const currentOnlyEliminatedOptions = Object.keys(current.eliminatedOptions).some((id) => !(id in incoming.eliminatedOptions));
  const currentOnlyScratchpads = Object.keys(current.scratchpads).some((id) => !(id in incoming.scratchpads));
  const currentOnlySubmitted = current.submitted.some((id) => !incoming.submitted.includes(id));
  if (!currentOnlyAnswers && !currentOnlyConfidence && !currentOnlyEliminatedOptions && !currentOnlyScratchpads && !currentOnlySubmitted) return incoming;

  return normalizePracticeSession({
    ...incoming,
    answers: { ...current.answers, ...incoming.answers },
    confidence: { ...current.confidence, ...incoming.confidence },
    eliminatedOptions: { ...current.eliminatedOptions, ...incoming.eliminatedOptions },
    scratchpads: { ...current.scratchpads, ...incoming.scratchpads },
    submitted: [...new Set([...current.submitted, ...incoming.submitted])],
  });
}

export function reconcilePracticeSession(session: PracticeSession | null, validQuestionIds: ReadonlySet<string>) {
  if (!session) return null;
  const currentId = session.ids[session.cursor];
  const ids = session.ids.filter((id) => validQuestionIds.has(id));
  if (!ids.length) return null;
  const preservedCursor = currentId ? ids.indexOf(currentId) : -1;
  return normalizePracticeSession({
    ...session,
    ids,
    cursor: preservedCursor >= 0 ? preservedCursor : Math.min(session.cursor, ids.length - 1),
  });
}

/**
 * Prepare a durable session for re-entering the answering workspace.
 *
 * Completed sessions belong to the result flow that just produced them; they
 * should not reopen as an answer-revealing screen from primary navigation.
 * Likewise, a study session that was left on an already-submitted question
 * resumes at its next unanswered question instead of exposing the prior answer
 * on entry.
 */
export function preparePracticeSessionForEntry(
  session: PracticeSession | null,
  validQuestionIds: ReadonlySet<string>,
) {
  const reconciled = reconcilePracticeSession(session, validQuestionIds);
  if (!reconciled || reconciled.completed) return null;
  if (reconciled.mode !== "study") return reconciled;

  const currentId = reconciled.ids[reconciled.cursor];
  if (!currentId || !reconciled.submitted.includes(currentId)) return reconciled;

  const submitted = new Set(reconciled.submitted);
  const nextCursor = reconciled.ids.findIndex((id, index) => index > reconciled.cursor && !submitted.has(id));
  const wrappedCursor = nextCursor >= 0
    ? nextCursor
    : reconciled.ids.findIndex((id) => !submitted.has(id));
  if (wrappedCursor < 0) return null;

  return normalizePracticeSession({ ...reconciled, cursor: wrappedCursor });
}

export function practiceSessionElapsedMs(session: PracticeSession, now = Date.now()) {
  const started = Date.parse(session.startedAt);
  if (!Number.isFinite(started)) return 0;
  const end = session.completedAt
    ? Date.parse(session.completedAt)
    : session.pausedAt
      ? Date.parse(session.pausedAt)
      : now;
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - started - (session.accumulatedPausedMs ?? 0));
}
