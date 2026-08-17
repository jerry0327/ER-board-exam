import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const browse = await readFile(new URL("../app/views/browse-view.tsx", import.meta.url), "utf8");
const review = await readFile(new URL("../app/views/review-view.tsx", import.meta.url), "utf8");
const guide = await readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8");
const analytics = await readFile(new URL("../app/views/analytics-view.tsx", import.meta.url), "utf8");
const css = await readLegacyCss();

test("threads the existing direct-practice launcher into every study workspace", () => {
  assert.match(app, /<BrowseView[\s\S]{0,400}onStartQuestions=\{openPracticeIds\}/);
  assert.match(app, /<LearningGuideView[^>]*onStartQuestions=\{openPracticeIds\}/);
  assert.match(app, /<ReviewView[\s\S]{0,400}onStartQuestions=\{openPracticeIds\}/);
  assert.match(app, /<AnalyticsView[\s\S]{0,500}onStartQuestions=\{openPracticeIds\}/);
});

test("browse opens a fresh one-question practice while keeping explanation reading explicit", () => {
  assert.match(browse, /selectedIds/);
  assert.match(browse, /選取本頁/);
  assert.match(browse, /className="browse-selection-bar floating-action-bar"/);
  assert.match(browse, /BROWSE_SELECTION_KEY/);
  assert.match(browse, /selectionStorageKey = BROWSE_SELECTION_KEY/);
  assert.match(browse, /window\.sessionStorage\.setItem\(selectionStorageKey/);
  assert.match(browse, /onStartQuestions\(selectedPracticeIds\)/);
  assert.match(browse, /practiceEligible \? onStartQuestions\(\[question\.id\]\) : onOpenReader\(question\.id\)/);
  assert.match(browse, /className="question-result-actions"/);
  assert.match(browse, /className="question-result-practice primary-button"/);
  assert.match(browse, /className="question-result-reader quiet-button"/);
  assert.match(browse, /直接閱讀 \$\{question\.id\} 詳解/);
  assert.doesNotMatch(browse, /className="question-result-primary-cue"/);
  assert.doesNotMatch(browse, /question\.answerKeys\.length > 1/, "browse cards must not disclose answer cardinality before practice");
  assert.match(browse, /onOpenReader\(question\.id\)/);
  assert.match(browse, /question\.excludedFromPractice/);
  assert.match(css, /\.browse-selection-bar\s*\{[^}]*position: fixed/);
  assert.match(css, /\.result-id strong\s*\{[^}]*white-space: nowrap/);
  assert.match(css, /\.question-result-card\s*\{[^}]*display: grid/);
  assert.match(css, /\.question-result-actions\s*\{[^}]*grid-column: 3/);
  assert.match(css, /\.question-result-actions\s*\{[^}]*grid-column: 2[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("review exposes the full filtered set through explicit incremental loading and practice", () => {
  assert.match(review, /const REVIEW_PAGE_SIZE = 100/);
  assert.match(review, /visibleResults = results\.slice\(0, visibleCount\)/);
  assert.match(review, /載入更多（剩餘/);
  assert.match(review, /onStartQuestions\(practiceIds\)/);
  assert.doesNotMatch(review, /results\.slice\(0, 100\)\.map/);
});

test("guide chapters and the selected analytics category can launch focused practice", () => {
  assert.match(guide, /relatedPracticeIds/);
  assert.match(guide, /練習本章/);
  assert.match(guide, /onStartQuestions\(relatedPracticeIds\)/);
  assert.match(analytics, /pendingIds/);
  assert.match(analytics, /unansweredIds/);
  assert.match(analytics, /onStartQuestions\(selectedTopic\.pendingIds\)/);
  assert.match(analytics, /onStartQuestions\(selectedTopic\.unansweredIds\)/);
  assert.match(analytics, /onStartQuestions\(selectedTopic\.allIds\)/);
  assert.match(analytics, /className="topic-mobile-practice paper-card"/);
});
