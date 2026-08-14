import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCanonicalProgress,
  buildCanonicalConcepts,
  canonicalConceptId,
  dedupeCanonicalQuestionIds,
  dedupeCanonicalQuestions,
  groupQuestionsByCanonical,
  selectCanonicalRepresentative,
} from "../app/lib/canonical-concepts.ts";

const question = (id, canonicalId) => ({ id, canonicalId });
const progress = (questionId, extra = {}) => ({
  userId: "user",
  questionId,
  attempts: 1,
  correctAttempts: 0,
  firstAttemptCorrect: 0,
  lastAnswer: "A",
  lastCorrect: 0,
  lastConfidence: "normal",
  bookmarked: 0,
  readState: "unread",
  wrongState: "none",
  streak: 0,
  dueAt: null,
  lastAttemptAt: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...extra,
});

test("groups by canonicalId with id fallback and preserves concept order", () => {
  const questions = [question("B-Q1", "C1"), question("A-Q2"), question("A-Q1", "C1")];
  const groups = groupQuestionsByCanonical(questions);
  assert.equal(canonicalConceptId(questions[1]), "A-Q2");
  assert.deepEqual([...groups.keys()], ["C1", "A-Q2"]);
  assert.deepEqual(groups.get("C1")?.map(({ id }) => id), ["B-Q1", "A-Q1"]);
});

test("selects the latest-progress member, then uses a stable canonical fallback", () => {
  const members = [question("B-Q1", "A-Q1"), question("A-Q1", "A-Q1")];
  assert.equal(selectCanonicalRepresentative(members)?.id, "A-Q1");

  const progressMap = new Map([
    ["A-Q1", progress("A-Q1", { attempts: 4, updatedAt: "2026-07-10T00:00:00.000Z" })],
    ["B-Q1", progress("B-Q1", { attempts: 1, updatedAt: "2026-07-12T00:00:00.000Z" })],
  ]);
  assert.equal(selectCanonicalRepresentative([...members].reverse(), progressMap)?.id, "B-Q1");
});

test("aggregates totals while the latest attempted variant owns schedule state", () => {
  const members = [question("A-Q1", "C1"), question("B-Q1", "C1")];
  const progressMap = new Map([
    ["A-Q1", progress("A-Q1", {
      attempts: 2,
      correctAttempts: 1,
      bookmarked: 1,
      wrongState: "mastered",
      dueAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    })],
    ["B-Q1", progress("B-Q1", {
      attempts: 3,
      correctAttempts: 2,
      wrongState: "pending",
      dueAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    })],
  ]);
  const state = aggregateCanonicalProgress(members, progressMap, "2026-07-16T12:00:00.000Z");
  assert.equal(state.recordCount, 2);
  assert.equal(state.attempts, 5);
  assert.equal(state.correctAttempts, 3);
  assert.equal(state.bookmarked, true);
  assert.equal(state.wrongState, "pending");
  assert.equal(state.pending, true);
  assert.equal(state.mastered, false);
  assert.equal(state.due, true);
  assert.equal(state.dueAt, "2026-07-15T00:00:00.000Z");
  assert.equal(state.latestRecord?.questionId, "B-Q1");
});

test("does not let a stale parallel row revive a cleared wrong or due state", () => {
  const members = [question("A-Q1", "C1"), question("B-Q1", "C1")];
  const progressMap = new Map([
    ["A-Q1", progress("A-Q1", {
      wrongState: "mastered",
      dueAt: "2026-08-01T00:00:00.000Z",
      lastAttemptAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    })],
    ["B-Q1", progress("B-Q1", {
      wrongState: "pending",
      dueAt: "2026-07-10T00:00:00.000Z",
      lastAttemptAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    })],
  ]);
  const state = aggregateCanonicalProgress(members, progressMap, "2026-07-22T00:00:00.000Z");
  assert.equal(state.latestRecord?.questionId, "A-Q1");
  assert.equal(state.wrongState, "mastered");
  assert.equal(state.pending, false);
  assert.equal(state.due, false);
  assert.equal(state.dueAt, "2026-08-01T00:00:00.000Z");
});

test("never lets an unattempted bookmark hide an attempted wrong variant", () => {
  const members = [question("A-Q1", "C1"), question("B-Q1", "C1")];
  const progressMap = new Map([
    ["A-Q1", progress("A-Q1", {
      wrongState: "pending",
      dueAt: "2026-07-17T00:00:00.000Z",
      lastAttemptAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    })],
    ["B-Q1", progress("B-Q1", {
      attempts: 0,
      bookmarked: 1,
      updatedAt: "2026-07-18T00:00:00.000Z",
    })],
  ]);
  const state = aggregateCanonicalProgress(members, progressMap, "2026-07-18T12:00:00.000Z");
  assert.equal(selectCanonicalRepresentative(members, progressMap)?.id, "A-Q1");
  assert.equal(state.latestRecord?.questionId, "A-Q1");
  assert.equal(state.pending, true);
  assert.equal(state.due, true);
  assert.equal(state.bookmarked, true);
});

test("builds canonical concepts with their representative and aggregate state", () => {
  const questions = [
    { ...question("A-Q1", "C1"), category: "stable-category" },
    { ...question("B-Q1", "C1"), category: "parallel-category" },
    question("A-Q2"),
  ];
  const progressMap = new Map([["B-Q1", progress("B-Q1", { attempts: 3 })]]);
  const concepts = buildCanonicalConcepts(questions, progressMap, "2026-07-16T00:00:00.000Z");
  assert.deepEqual(concepts.map(({ id }) => id), ["C1", "A-Q2"]);
  assert.deepEqual(concepts[0].memberIds, ["A-Q1", "B-Q1"]);
  assert.equal(concepts[0].anchor.id, "A-Q1");
  assert.equal(concepts[0].anchor.category, "stable-category");
  assert.equal(concepts[0].representative.id, "B-Q1");
  assert.equal(concepts[0].progress.attempts, 3);
});

test("dedupes concept practice but leaves an explicit full paper untouched", () => {
  const questions = [question("A-Q1", "C1"), question("B-Q1", "C1"), question("A-Q2")];
  const progressMap = new Map([["B-Q1", progress("B-Q1", { updatedAt: "2026-07-12T00:00:00.000Z" })]]);
  assert.deepEqual(
    dedupeCanonicalQuestions(questions, { progressMap }).map(({ id }) => id),
    ["B-Q1", "A-Q2"],
  );
  assert.deepEqual(
    dedupeCanonicalQuestions(questions, { mode: "full-paper", progressMap }).map(({ id }) => id),
    ["A-Q1", "B-Q1", "A-Q2"],
  );
});

test("dedupes id queues, preserves unknown ids, and keeps full-paper order", () => {
  const questions = [question("A-Q1", "C1"), question("B-Q1", "C1"), question("A-Q2")];
  const byId = new Map(questions.map((item) => [item.id, item]));
  const ids = ["A-Q1", "missing", "B-Q1", "missing", "A-Q2"];
  const progressMap = new Map([["B-Q1", progress("B-Q1", { updatedAt: "2026-07-12T00:00:00.000Z" })]]);
  assert.deepEqual(dedupeCanonicalQuestionIds(ids, byId, { progressMap }), ["B-Q1", "missing", "A-Q2"]);
  assert.deepEqual(dedupeCanonicalQuestionIds(ids, byId, { mode: "full-paper" }), ids);
});
