import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/views/dashboard-view.tsx", import.meta.url), "utf8");
const practice = await readFile(new URL("../app/views/practice-view.impl.tsx", import.meta.url), "utf8");
const review = await readFile(new URL("../app/views/review-view.tsx", import.meta.url), "utf8");

test("deduplicates every cross-page concept launch before opening practice", () => {
  assert.match(app, /dedupeCanonicalQuestionIds\(ids, questionById, \{ progressMap: progress\.progressMap \}\)/);
  assert.match(app, /setPracticeLaunch\(\{ ids: conceptIds, nonce: Date\.now\(\) \}\)/);
});

test("uses aggregate concept state for general practice and focused retries", () => {
  assert.match(practice, /buildCanonicalConcepts\(questions\.filter/);
  assert.match(practice, /concept\.progress\.attempts > 0/);
  assert.match(practice, /concept\.progress\.pending/);
  assert.match(practice, /canonicalizeSelection[\s\S]{0,120}dedupeCanonicalQuestionIds\(availableIds/);
});

test("keeps a full paper on its original rows and sequence", () => {
  assert.match(practice, /if \(fullPaper\)/);
  assert.match(practice, /\.filter\(\(question\) => question\.exam === activeFilters\.exam\)/);
  assert.match(practice, /\.sort\(\(left, right\) => left\.number - right\.number\)/);
  assert.match(practice, /fullPaper\s*\? candidates\.map/);
});

test("shows review and dashboard learning state once per canonical concept", () => {
  assert.match(review, /buildCanonicalConcepts\(questions, progressMap, now\)/);
  assert.match(review, /同一觀念集中呈現/);
  assert.match(dashboard, /buildCanonicalConcepts\(\s*questions\.filter/);
});
