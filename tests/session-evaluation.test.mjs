import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSession, sameAnswer } from "../app/lib/session-evaluation.ts";

const question = (id, category, answerKeys, chapters, allCredit = false) => ({
  id,
  category,
  answerKeys,
  allCredit,
  sourceSections: category === "心血管急症" ? [7] : [15],
  tintinalliChapters: chapters,
});

test("compares multiple-answer selections without depending on order", () => {
  assert.equal(sameAnswer(["C", "A"], ["A", "C"]), true);
  assert.equal(sameAnswer(["A"], ["A", "C"]), false);
});

test("evaluates score, completion, confidence, topics, duration, and guide recommendations", () => {
  const evaluation = evaluateSession({
    questions: [
      question("Q1", "心血管急症", ["A"], [49]),
      question("Q2", "心血管急症", ["B"], [49]),
      question("Q3", "心血管急症", ["C"], [50]),
      question("Q4", "毒物學", ["D"], [176]),
      question("Q5", "毒物學", ["A"], [176]),
      question("Q6", "毒物學", [], [], true),
    ],
    answers: { Q1: ["B"], Q2: ["B"], Q3: [], Q4: ["D"], Q5: ["C"], Q6: [] },
    confidence: { Q1: "high", Q2: "low", Q3: "normal", Q4: "normal", Q5: "normal", Q6: "normal" },
    mode: "exam",
    startedAt: "2026-07-16T12:00:00.000Z",
    completedAt: "2026-07-16T12:10:00.000Z",
  });

  assert.equal(evaluation.scored, 5, "全部給分題不得進入計分分母");
  assert.equal(evaluation.correct, 2);
  assert.equal(evaluation.wrong, 3);
  assert.equal(evaluation.unanswered, 1, "全部給分題應視為已完成而非未作答");
  assert.equal(evaluation.completion, 83);
  assert.equal(evaluation.accuracy, 40);
  assert.equal(evaluation.durationSeconds, 600);
  assert.equal(evaluation.highConfidenceWrong, 1);
  assert.equal(evaluation.lowConfidenceCorrect, 1);
  assert.equal(evaluation.band, "priority");
  assert.deepEqual(evaluation.wrongIds, ["Q1", "Q3", "Q5"]);
  assert.deepEqual(evaluation.recommendedGuides, [
    { kind: "chapter", id: 49, wrongCount: 1 },
    { kind: "chapter", id: 50, wrongCount: 1 },
    { kind: "chapter", id: 176, wrongCount: 1 },
  ]);
  assert.match(evaluation.recommendationTitle, /高信心/);
  assert.equal(evaluation.topics.find((row) => row.category === "心血管急症")?.sampleSufficient, true);
});

test("uses a direct low-question-count label and freezes missing legacy duration", () => {
  const evaluation = evaluateSession({
    questions: [question("Q1", "外傷", ["A"], [])],
    answers: { Q1: ["A"] },
    confidence: { Q1: "normal" },
    mode: "study",
    startedAt: "2026-07-16T12:00:00.000Z",
  });
  assert.equal(evaluation.band, "baseline");
  assert.equal(evaluation.durationSeconds, null);
  assert.match(evaluation.bandLabel, /題數較少/);
  assert.match(evaluation.bandDetail, /查看錯題與未作答題目/);
});

test("excludes explicitly paused time from duration and pace", () => {
  const evaluation = evaluateSession({
    questions: [question("Q1", "外傷", ["A"], [])],
    answers: { Q1: ["A"] },
    confidence: { Q1: "normal" },
    mode: "exam",
    startedAt: "2026-07-16T12:00:00.000Z",
    completedAt: "2026-07-16T12:10:00.000Z",
    accumulatedPausedMs: 120_000,
  });
  assert.equal(evaluation.durationSeconds, 480);
  assert.equal(evaluation.averageSeconds, 480);
});
