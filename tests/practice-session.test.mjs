import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACTIVE_PRACTICE_SESSION_EVENT,
  ACTIVE_PRACTICE_SESSION_KEY,
  activePracticeSessionKey,
  mergePracticeSessions,
  normalizePracticeSession,
  practiceSessionElapsedMs,
  preparePracticeSessionForEntry,
  readActivePracticeSession,
  reconcilePracticeSession,
  writeActivePracticeSession,
} from "../app/lib/practice-session.ts";

const practice = await readFile(new URL("../app/views/practice-view.impl.tsx", import.meta.url), "utf8");

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("normalizes v1 sessions into the durable v2 shape", () => {
  const restored = normalizePracticeSession({
    ids: ["Q-1", "Q-2", "Q-2", 4],
    cursor: 99,
    mode: "exam",
    answers: { "Q-1": ["A"], missing: ["B"] },
    confidence: { "Q-1": "high", "Q-2": "invalid" },
    submitted: ["Q-1", "missing"],
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });

  assert.ok(restored);
  assert.equal(restored.schemaVersion, 2);
  assert.deepEqual(restored.ids, ["Q-1", "Q-2"]);
  assert.equal(restored.cursor, 1);
  assert.deepEqual(restored.answers, { "Q-1": ["A"] });
  assert.deepEqual(restored.confidence, { "Q-1": "high" });
  assert.deepEqual(restored.eliminatedOptions, {});
  assert.deepEqual(restored.scratchpads, {});
  assert.deepEqual(restored.submitted, ["Q-1"]);
  assert.deepEqual(restored.flaggedIds, []);
  assert.equal(restored.timerEnabled, true);
});

test("migrates the compatible global key into the current account scope", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const events = [];
  sessionStorage.setItem(ACTIVE_PRACTICE_SESSION_KEY, JSON.stringify({
    ids: ["Q-1"],
    cursor: 0,
    mode: "study",
    answers: {},
    confidence: {},
    submitted: [],
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  }));
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage,
    sessionStorage,
    dispatchEvent: (event) => events.push(event),
  };

  try {
    const restored = readActivePracticeSession("account-a");
    const scopedKey = activePracticeSessionKey("account-a");
    assert.equal(restored?.schemaVersion, 2);
    assert.equal(sessionStorage.getItem(ACTIVE_PRACTICE_SESSION_KEY), null);
    assert.equal(JSON.parse(localStorage.getItem(scopedKey)).schemaVersion, 2);
    assert.equal(readActivePracticeSession("account-b"), null, "another account must not inherit the migrated session");
    writeActivePracticeSession(restored, "account-a");
    assert.equal(events.at(-1)?.type, ACTIVE_PRACTICE_SESSION_EVENT);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("reconciles a restored session against the current question bank", () => {
  const restored = normalizePracticeSession({
    ids: ["Q-removed", "Q-current"],
    cursor: 0,
    mode: "study",
    answers: { "Q-removed": ["A"], "Q-current": ["B"] },
    confidence: {},
    eliminatedOptions: { "Q-removed": ["B"], "Q-current": ["C"] },
    scratchpads: { "Q-removed": "old", "Q-current": "keep" },
    submitted: ["Q-removed"],
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });
  const reconciled = reconcilePracticeSession(restored, new Set(["Q-current"]));
  assert.deepEqual(reconciled?.ids, ["Q-current"]);
  assert.equal(reconciled?.cursor, 0);
  assert.deepEqual(reconciled?.answers, { "Q-current": ["B"] });
  assert.deepEqual(reconciled?.eliminatedOptions, { "Q-current": ["C"] });
  assert.deepEqual(reconciled?.scratchpads, { "Q-current": "keep" });
  assert.equal(reconcilePracticeSession(restored, new Set()), null);
});

test("re-entering practice never opens on a previously revealed answer", () => {
  const submittedCurrent = normalizePracticeSession({
    ids: ["Q-1", "Q-2", "Q-3"],
    cursor: 0,
    mode: "study",
    answers: { "Q-1": ["A"] },
    confidence: { "Q-1": "high" },
    submitted: ["Q-1"],
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });
  const resumed = preparePracticeSessionForEntry(submittedCurrent, new Set(["Q-1", "Q-2", "Q-3"]));
  assert.equal(resumed?.cursor, 1);
  assert.equal(resumed?.submitted.includes(resumed.ids[resumed.cursor]), false);
  assert.deepEqual(resumed?.answers, { "Q-1": ["A"] }, "past results stay recorded without pre-filling the next answer");

  const allSubmitted = normalizePracticeSession({
    ids: ["Q-1"],
    cursor: 0,
    mode: "study",
    answers: { "Q-1": ["A"] },
    confidence: {},
    submitted: ["Q-1"],
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });
  assert.equal(preparePracticeSessionForEntry(allSubmitted, new Set(["Q-1"])), null);

  const completed = normalizePracticeSession({
    ...allSubmitted,
    completed: true,
    completedAt: "2026-07-18T00:01:00.000Z",
  });
  assert.equal(preparePracticeSessionForEntry(completed, new Set(["Q-1"])), null);
});

test("normalizes per-question elimination marks and temporary scratchpads without touching answers", () => {
  const restored = normalizePracticeSession({
    ids: ["Q-1", "Q-2"],
    cursor: 0,
    mode: "study",
    answers: { "Q-1": ["A"] },
    confidence: {},
    eliminatedOptions: { "Q-1": ["B", "B", "C"], missing: ["D"] },
    scratchpads: { "Q-1": "AG = Na - Cl - HCO3", "Q-2": "x".repeat(4100), missing: "drop" },
    submitted: [],
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });

  assert.deepEqual(restored?.answers, { "Q-1": ["A"] });
  assert.deepEqual(restored?.eliminatedOptions, { "Q-1": ["B", "C"] });
  assert.equal(restored?.scratchpads["Q-1"], "AG = Na - Cl - HCO3");
  assert.equal(restored?.scratchpads["Q-2"].length, 4000);
});

test("round-trips temporary question tools through the durable active session", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage, sessionStorage, dispatchEvent: () => undefined };
  const session = normalizePracticeSession({
    ids: ["Q-1"], cursor: 0, mode: "study", answers: {}, confidence: {}, submitted: [], completed: false,
    eliminatedOptions: { "Q-1": ["B"] }, scratchpads: { "Q-1": "temporary differential" },
    startedAt: "2026-07-18T00:00:00.000Z",
  });

  try {
    assert.equal(writeActivePracticeSession(session, "account-a"), true);
    const restored = readActivePracticeSession("account-a");
    assert.deepEqual(restored?.eliminatedOptions, { "Q-1": ["B"] });
    assert.deepEqual(restored?.scratchpads, { "Q-1": "temporary differential" });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("keeps named practice-session namespaces isolated from the board bank", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage, sessionStorage, dispatchEvent: () => undefined };
  const boardSession = normalizePracticeSession({
    ids: ["BOARD-Q1"], cursor: 0, mode: "study", answers: {}, confidence: {}, submitted: [], completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });
  const ailsSession = normalizePracticeSession({
    ids: ["AILS-Q001"], cursor: 0, mode: "exam", answers: {}, confidence: {}, submitted: [], completed: false,
    startedAt: "2026-07-18T01:00:00.000Z",
  });

  try {
    assert.notEqual(activePracticeSessionKey("anonymous-device"), activePracticeSessionKey("anonymous-device", "ails"));
    assert.equal(writeActivePracticeSession(boardSession, "anonymous-device"), true);
    assert.equal(readActivePracticeSession("anonymous-device", "ails"), null);
    assert.equal(writeActivePracticeSession(ailsSession, "anonymous-device", "ails"), true);
    assert.deepEqual(readActivePracticeSession("anonymous-device")?.ids, ["BOARD-Q1"]);
    assert.deepEqual(readActivePracticeSession("anonymous-device", "ails")?.ids, ["AILS-Q001"]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("merges disjoint concurrent answers while the incoming tab wins direct conflicts", () => {
  const base = {
    schemaVersion: 2,
    ids: ["Q-1", "Q-2"],
    cursor: 0,
    mode: "exam",
    confidence: {},
    submitted: [],
    flaggedIds: [],
    timerEnabled: true,
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  };
  const current = normalizePracticeSession({
    ...base,
    answers: { "Q-1": ["A"], "Q-2": ["B"] },
    eliminatedOptions: { "Q-1": ["D"] },
    scratchpads: { "Q-1": "first tab" },
  });
  const incoming = normalizePracticeSession({
    ...base,
    cursor: 1,
    answers: { "Q-2": ["C"] },
    eliminatedOptions: { "Q-2": ["A"] },
    scratchpads: { "Q-2": "second tab" },
  });
  const merged = mergePracticeSessions(current, incoming);
  assert.deepEqual(merged?.answers, { "Q-1": ["A"], "Q-2": ["C"] });
  assert.deepEqual(merged?.eliminatedOptions, { "Q-1": ["D"], "Q-2": ["A"] });
  assert.deepEqual(merged?.scratchpads, { "Q-1": "first tab", "Q-2": "second tab" });
  assert.equal(merged?.cursor, 1);
});

test("never merges unfinished answers across the completed submission boundary", () => {
  const base = {
    schemaVersion: 2,
    ids: ["Q-1", "Q-2"],
    cursor: 1,
    mode: "exam",
    confidence: {},
    flaggedIds: [],
    timerEnabled: true,
    startedAt: "2026-07-18T00:00:00.000Z",
  };
  const unfinished = normalizePracticeSession({ ...base, answers: { "Q-1": ["A"] }, submitted: [], completed: false });
  const completed = normalizePracticeSession({ ...base, answers: { "Q-2": ["B"] }, submitted: ["Q-1", "Q-2"], completed: true, completedAt: "2026-07-18T00:10:00.000Z" });
  assert.equal(mergePracticeSessions(unfinished, completed), completed);
  assert.equal(mergePracticeSessions(completed, unfinished), completed);
});

test("a durable deletion marker prevents a discarded session from returning", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage, sessionStorage, dispatchEvent: () => undefined };
  const session = normalizePracticeSession({
    ids: ["Q-1"], cursor: 0, mode: "study", answers: {}, confidence: {}, submitted: [], completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
  });

  try {
    assert.equal(writeActivePracticeSession(session, "account-a"), true);
    assert.equal(writeActivePracticeSession(null, "account-a"), true);
    const stored = JSON.parse(localStorage.getItem(activePracticeSessionKey("account-a")));
    assert.equal(stored.deleted, true);
    assert.equal(readActivePracticeSession("account-a"), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("a newer anonymous session supersedes an older account deletion marker", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  const accountKey = activePracticeSessionKey("account-a");
  const anonymousKey = activePracticeSessionKey("anonymous-device");
  localStorage.setItem(accountKey, JSON.stringify({ schemaVersion: 2, deleted: true, savedAt: "2026-07-18T00:00:00.000Z" }));
  localStorage.setItem(anonymousKey, JSON.stringify({
    schemaVersion: 2,
    ids: ["Q-new"], cursor: 0, mode: "study", answers: {}, confidence: {}, submitted: [], flaggedIds: [], timerEnabled: false, completed: false,
    startedAt: "2026-07-18T01:00:00.000Z",
    savedAt: "2026-07-18T01:00:00.000Z",
  }));
  globalThis.window = { localStorage, sessionStorage, dispatchEvent: () => undefined };

  try {
    assert.deepEqual(readActivePracticeSession("account-a")?.ids, ["Q-new"]);
    assert.equal(JSON.parse(localStorage.getItem(accountKey)).deleted, undefined);
    assert.equal(localStorage.getItem(anonymousKey), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("elapsed time is timestamp-based and excludes an explicit pause", () => {
  const session = normalizePracticeSession({
    schemaVersion: 2,
    ids: ["Q-1"],
    cursor: 0,
    mode: "exam",
    answers: {},
    confidence: {},
    submitted: [],
    flaggedIds: ["Q-1"],
    timerEnabled: true,
    completed: false,
    startedAt: "2026-07-18T00:00:00.000Z",
    pausedAt: "2026-07-18T00:00:12.000Z",
    accumulatedPausedMs: 2000,
  });
  assert.ok(session);
  assert.equal(practiceSessionElapsedMs(session, Date.parse("2026-07-18T01:00:00.000Z")), 10_000);
});

test("exam flow requires review, exposes navigator states, and protects replacement decisions", () => {
  assert.match(practice, /if \(session\.mode === "exam" && !session\.reviewing\)/u);
  assert.match(practice, /交卷前檢查/u);
  assert.match(practice, /未作答題目/u);
  assert.match(practice, /標記待檢查/u);
  assert.match(practice, /className="exam-question-grid"/u);
  assert.match(practice, />暫停<\/button>/u);
  assert.match(practice, />捨棄本輪<\/button>/u);
  assert.match(practice, /if \(session && !session\.completed\) return;/u);
  assert.match(practice, /resolvePendingLaunch\(false\)/u);
  assert.match(practice, /resolvePendingLaunch\(true\)/u);
  assert.match(practice, /onAttempts\(attempts\)/u, "exam completion must retain the existing idempotent batch path");
  assert.match(practice, /mutationId: `\$\{submissionPrefix\}_\$\{index\}`/u, "a restored exam must reuse stable mutation ids");
});
