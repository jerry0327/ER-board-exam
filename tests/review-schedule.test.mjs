import assert from "node:assert/strict";
import test from "node:test";
import { isChronologicallyOlder, scheduleReview } from "../app/lib/review-schedule.ts";

const base = { streak: 0, dueAt: "2026-07-20T00:00:00.000Z", wrongState: "none" };
const answeredAt = "2026-07-16T00:00:00.000Z";

test("uses one shared deterministic review schedule for wrong and confidence intervals", () => {
  const wrong = scheduleReview({ previous: { ...base, streak: 7, wrongState: "mastered" }, correct: false, confidence: "high", answeredAt });
  assert.deepEqual(wrong, { streak: 0, dueAt: "2026-07-17T00:00:00.000Z", wrongState: "pending", intervalDays: 1 });
  assert.equal(scheduleReview({ previous: base, correct: true, confidence: "low", answeredAt }).intervalDays, 3);
  assert.equal(scheduleReview({ previous: base, correct: true, confidence: "normal", answeredAt }).intervalDays, 7);
  assert.equal(scheduleReview({ previous: base, correct: true, confidence: "high", answeredAt }).intervalDays, 14);
});

test("requires two consecutive correct answers to master a pending wrong and caps intervals", () => {
  const first = scheduleReview({ previous: { ...base, wrongState: "pending" }, correct: true, confidence: "normal", answeredAt });
  assert.equal(first.wrongState, "pending");
  const second = scheduleReview({ previous: first, correct: true, confidence: "high", answeredAt });
  assert.equal(second.wrongState, "mastered");
  const capped = scheduleReview({ previous: { ...base, streak: 20 }, correct: true, confidence: "high", answeredAt });
  assert.equal(capped.intervalDays, 120);
});

test("all-credit results preserve schedule state without mutating the input", () => {
  const previous = { ...base, wrongState: "pending" };
  const snapshot = structuredClone(previous);
  assert.deepEqual(scheduleReview({ previous, correct: null, confidence: "high", answeredAt }), { ...previous, intervalDays: null });
  assert.deepEqual(previous, snapshot);
});

test("recognizes an offline attempt that predates the current schedule", () => {
  assert.equal(isChronologicallyOlder("2026-07-16T03:00:00.000Z", "2026-07-15T03:00:00.000Z"), true);
  assert.equal(isChronologicallyOlder("2026-07-16T03:00:00.000Z", "2026-07-16T03:00:00.000Z"), false);
  assert.equal(isChronologicallyOlder(null, "2026-07-15T03:00:00.000Z"), false);
});
