import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyStudyPlan, localDateKey, normalizeStudyPlanSettings } from "../app/lib/study-plan.ts";

const question = (id, category = "心血管", extra = {}) => ({ id, category, allCredit: false, excludedFromPractice: false, ...extra });
const progress = (questionId, extra = {}) => ({
  questionId,
  attempts: 1,
  firstAttemptCorrect: 0,
  lastCorrect: 0,
  lastConfidence: "normal",
  wrongState: "pending",
  dueAt: "2026-07-15T00:00:00.000Z",
  lastAttemptAt: "2026-07-10T00:00:00.000Z",
  ...extra,
});

test("uses the Taiwan calendar date instead of UTC around midnight", () => {
  assert.equal(localDateKey("2026-07-15T16:30:00.000Z", "Asia/Taipei"), "2026-07-16");
  assert.equal(localDateKey("2026-07-15T16:30:00.000Z", "America/New_York"), "2026-07-15");
});

test("prioritizes due high-confidence wrong concepts and canonical-deduplicates", () => {
  const questions = [
    question("100-Q001", "心血管", { canonicalId: "C1" }),
    question("101-Q001", "心血管", { canonicalId: "C1" }),
    question("100-Q002", "毒物"),
    question("100-Q003", "外傷", { allCredit: true }),
    question("100-Q004", "外傷", { excludedFromPractice: true }),
  ];
  const progressMap = new Map([
    ["100-Q001", progress("100-Q001", { lastAttemptAt: "2026-07-01T00:00:00.000Z" })],
    ["101-Q001", progress("101-Q001", { lastAttemptAt: "2026-07-14T00:00:00.000Z", lastConfidence: "high" })],
    ["100-Q002", progress("100-Q002", { lastCorrect: 1, wrongState: "none" })],
  ]);
  const settings = normalizeStudyPlanSettings({ schemaVersion: 1, dailyGoal: 5, maxNewPerDay: 0, sessionSize: 5, categoryIds: [] }, ["心血管", "毒物", "外傷"]);
  const plan = buildDailyStudyPlan({ questions, progressMap, attempts: [], settings, now: "2026-07-16T00:00:00.000Z" });
  assert.deepEqual(plan.questionIds, ["101-Q001", "100-Q002"]);
  assert.equal(plan.dueBacklog, 2);
});

test("today's completed canonical concepts reduce the goal without being replaced", () => {
  const questions = [question("100-Q001"), question("100-Q002"), question("100-Q003"), question("100-Q004"), question("100-Q005")];
  const progressMap = new Map([
    ["100-Q001", progress("100-Q001")],
    ["100-Q002", progress("100-Q002")],
    ["100-Q003", progress("100-Q003")],
    ["100-Q004", progress("100-Q004")],
    ["100-Q005", progress("100-Q005")],
  ]);
  const attempts = ["100-Q001", "100-Q002", "100-Q003", "100-Q004"].map((questionId) => ({ questionId, createdAt: "2026-07-15T16:30:00.000Z" }));
  const settings = normalizeStudyPlanSettings({ schemaVersion: 1, dailyGoal: 5, maxNewPerDay: 0, sessionSize: 5, categoryIds: [] }, ["心血管"]);
  const plan = buildDailyStudyPlan({ questions, progressMap, attempts, settings, now: "2026-07-16T01:00:00.000Z" });
  assert.equal(plan.completedToday, 4);
  assert.equal(plan.remaining, 1);
  assert.deepEqual(plan.questionIds, ["100-Q005"]);
});

test("new-question order is deterministic even when source arrays are reordered", () => {
  const questions = [question("100-Q001"), question("100-Q002"), question("100-Q003")];
  const settings = normalizeStudyPlanSettings({ schemaVersion: 1, dailyGoal: 3, maxNewPerDay: 3, sessionSize: 3, categoryIds: [] }, ["心血管"]);
  const first = buildDailyStudyPlan({ questions, progressMap: new Map(), attempts: [], settings, now: "2026-07-16T01:00:00.000Z" });
  const second = buildDailyStudyPlan({ questions: [...questions].reverse(), progressMap: new Map(), attempts: [], settings, now: "2026-07-16T01:00:00.000Z" });
  assert.deepEqual(first.questionIds, second.questionIds);
});

test("caps the next launch to the configured session size", () => {
  const questions = Array.from({ length: 12 }, (_, index) => question(`100-Q${String(index + 1).padStart(3, "0")}`));
  const progressMap = new Map(questions.map(({ id }) => [id, progress(id)]));
  const settings = normalizeStudyPlanSettings({ schemaVersion: 1, dailyGoal: 30, maxNewPerDay: 10, sessionSize: 5, categoryIds: [] }, ["心血管"]);
  const plan = buildDailyStudyPlan({ questions, progressMap, attempts: [], settings, now: "2026-07-16T01:00:00.000Z" });
  assert.equal(plan.questionIds.length, 5);
  assert.equal(plan.tasks.reduce((total, task) => total + task.questionIds.length, 0), 5);
  assert.equal(plan.remaining, 30);
});

test("ignores stale attempts with invalid dates instead of crashing the homepage", () => {
  const questions = [question("100-Q001")];
  const settings = normalizeStudyPlanSettings({ schemaVersion: 1, dailyGoal: 1, maxNewPerDay: 1, sessionSize: 1, categoryIds: [] }, ["心血管"]);
  const plan = buildDailyStudyPlan({
    questions,
    progressMap: new Map(),
    attempts: [{ questionId: "100-Q001", createdAt: "not-a-date" }],
    settings,
    now: "2026-07-16T01:00:00.000Z",
  });
  assert.equal(plan.completedToday, 0);
  assert.deepEqual(plan.questionIds, ["100-Q001"]);
});
