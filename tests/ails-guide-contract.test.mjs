import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ailsInteractivePageIds, ailsReadingPageIds, parseAilsReview } from "../app/lib/ails-review.ts";
import {
  buildAilsQuestionSet,
  filterAilsQuestions,
  orderAilsQuestions,
} from "../app/lib/ails-questions.ts";
import {
  AILS_PROGRESS_KEY,
  migrateAilsQuestionProgress,
  parseAilsQuestionProgress,
} from "../app/hooks/use-ails-question-progress.ts";

const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const hub = await readFile(new URL("../app/views/guide-hub-view.tsx", import.meta.url), "utf8");
const wrapper = await readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8");
const reader = await readFile(new URL("../app/views/ails-guide-view.tsx", import.meta.url), "utf8");
const questionCenter = await readFile(new URL("../app/views/ails-question-center-view.tsx", import.meta.url), "utf8");
const progressHook = await readFile(new URL("../app/hooks/use-ails-question-progress.ts", import.meta.url), "utf8");
const questionLib = await readFile(new URL("../app/lib/ails-questions.ts", import.meta.url), "utf8");
const importer = await readFile(new URL("../scripts/import-ails-review.mjs", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const data = parseAilsReview(JSON.parse(await readFile(new URL("../public/data/ails/review.json", import.meta.url), "utf8")));

test("presents AILS as a full learning-guide card without adding global navigation", () => {
  assert.equal((hub.match(/<article className="guide-book-card (?:tintinalli|rosens|ails)"/gu) ?? []).length, 3);
  assert.match(hub, /className="guide-book-card ails"[\s\S]*?<i>A<\/i><b>3<\/b>/u);
  assert.match(hub, /AILS · 第三版[\s\S]*急性中毒救命術 · 10 篇複習內容/u);
  assert.match(hub, /<h2 id="ails-guide-title">AILS急性中毒救命術<\/h2>/u);
  assert.match(reader, /<p>AILS · 第三版<\/p><h1>AILS急性中毒救命術<\/h1>/u);
  assert.equal((reader.match(/currentTextbook="AILS急性中毒救命術"/gu) ?? []).length, 2);
  assert.match(importer, /title: "AILS急性中毒救命術"/u);
  assert.match(hub, /onOpenAils\("home"\)/u);
  assert.match(hub, /onOpenAils\("qbank"\)/u);
  assert.match(hub, /onOpenAils\("answers"\)/u);
  assert.match(hub, /題目練習[\s\S]*自己選題作答[\s\S]*完整詳解[\s\S]*直接閱讀詳解/u);
  const navItems = app.match(/const navItems[\s\S]*?\];/u)?.[0] ?? "";
  assert.match(navItems, /name: "\u5b78\u7fd2\u6307\u5f15"[^}]*hash: "guides"[^}]*group: "knowledge"/u);
  assert.doesNotMatch(navItems, /name: "AILS"|hash: "ails"/u);
  assert.match(wrapper, /requestedGuideModuleId === "ails"[\s\S]{0,180}<AilsGuideView/u);
  assert.match(app, /requestedGuideModuleId=\{requestedGuideModuleId\}/u);
  assert.match(css, /\.guide-book-card\.ails \{[^}]*--guide-book-accent:/u);
  assert.match(css, /\.guide-book-routes-ails \{[^}]*grid-template-columns: minmax\(0, 1\.2fr\)/u);
  assert.match(css, /\.guide-book-route-ails-practice \{[^}]*grid-column: 2/u);
});

test("keeps both legacy overview controls intact while adding the board-textbook reader", () => {
  assert.equal((hub.match(/<article className="guide-book-card (?:tintinalli|rosens)"/gu) ?? []).length, 2);
  assert.equal((hub.match(/<GuideOverviewLink /gu) ?? []).length, 2);
  assert.equal((hub.match(/<\/button>\s*<GuideOverviewLink /gu) ?? []).length, 2);
  assert.equal((hub.match(/className="guide-book-route guide-book-route-chapter"/gu) ?? []).length, 5);
  assert.doesNotMatch(hub, /guide-book-primary/u);
  assert.doesNotMatch(hub, /guide-overview-links/u);
});

test("imports all AILS content deterministically as native Markdown and preserves every table and question", () => {
  assert.equal(data.pages.length, 13);
  assert.equal(data.questions.length, 272);
  assert.deepEqual(data.questions.map((question) => question.num), Array.from({ length: 272 }, (_, index) => index + 1));
  assert.equal(data.pages.reduce((count, page) => count + (page.markdown.match(/^\| ---/gmu) ?? []).length, 0), 24);
  assert.equal(data.topics.length, 22);
  assert.equal(data.pages.some((page) => /<(?:style|script)\b|on\w+=/iu.test(page.markdown)), false);
  assert.match(importer, /pullEnvelope\(source, "pagesData"\)/u);
  assert.match(importer, /parseFragment/u);
  assert.match(importer, /validateQuestions\(questions, topics\)/u);
});

test("reuses the shared guide, browse, practice, reader, and question-sheet modules", () => {
  assert.match(reader, /<GuideReaderToolbar/u);
  assert.match(reader, /<GuideReaderToolsPanel/u);
  assert.match(reader, /useOverlayFocusManagement/u);
  assert.match(reader, /useReadingNavigation/u);
  assert.match(reader, /<MarkdownContent markdown=\{selectedPage\.markdown\} variant="guide"/u);
  assert.match(reader, /onAddToNotes=\{setPendingExcerpt\}/u);
  assert.match(reader, /data-content-annotation-root=\{annotationResourceId\}/u);
  assert.match(reader, /<ContentAnnotationTools[\s\S]*?pendingExcerpt=\{pendingExcerpt\}/u);
  assert.match(reader, /<AilsQuestionCenterView/u);
  assert.match(questionCenter, /import QuestionSheet from "\.\.\/components\/question-sheet"/u);
  assert.match(questionCenter, /import BrowseView from "\.\/browse-view"/u);
  assert.match(questionCenter, /import PracticeView from "\.\/practice-view"/u);
  assert.match(questionCenter, /import ReaderView from "\.\/reader-view"/u);
  assert.match(questionCenter, /<BrowseView/u);
  assert.match(questionCenter, /<PracticeView/u);
  assert.match(questionCenter, /<ReaderView/u);
  assert.match(questionCenter, /<QuestionSheet/u);
  assert.match(questionCenter, /flashcard/u);
  assert.match(css, /\.ails-guide-article \{[^}]*margin-top/u);
  assert.doesNotMatch(css, /\.ails-workspace-header/u);
  assert.match(css, /\.markdown-body table \{[^}]*border-collapse/u);
});

test("isolates AILS answers, bookmarks, and mastery from the emergency-board question bank", () => {
  assert.equal(AILS_PROGRESS_KEY, "em-board-ails-progress-v2");
  assert.match(progressHook, /em-board-ails-bookmarks-v1/u);
  assert.match(progressHook, /em-board-ails-mastered-v1/u);
  assert.match(questionLib, /return `AILS-Q\$\{/u);
  assert.match(questionCenter, /sessionNamespace="ails"/u);
  assert.match(questionCenter, /selectionStorageKey="em-board-ails-browse-selection-v1"/u);
  assert.doesNotMatch(questionCenter, /useProgress|openPracticeIds|ACTIVE_PRACTICE_SESSION/u);
  assert.doesNotMatch(app, /questions=\{\[\.\.\.questions,\s*\.\.\.ails/u);
});

test("gives question practice, cards, quizzes, and direct explanation reading distinct behavior", () => {
  assert.match(questionCenter, /每題提交後可立即閱讀解析/u);
  assert.match(questionCenter, /先在心中作答，再翻面核對/u);
  assert.match(questionCenter, /還不熟[\s\S]*已掌握/u);
  assert.match(questionCenter, /整輪交卷後才公布答案與逐題解析/u);
  assert.match(questionCenter, /variantSelectionEnabled=\{false\}/u);
  assert.doesNotMatch(questionCenter, /type AilsSession|type Screen|cardRatings/u);
  assert.match(progressHook, /mastered: (?:correct|attempt\.correct) \? record\.mastered : false/u);
  assert.match(reader, /requestedPage === "answers"/u);
  assert.match(reader, /initialReaderNum=\{explanationEntry \? review\.questions\[0\]\?\.num : undefined\}/u);
});

test("keeps interactive AILS routes out of the learning-guide reading directory", () => {
  assert.deepEqual(ailsInteractivePageIds, ["qbank", "cards", "quiz"]);
  assert.equal(ailsReadingPageIds.length, 10);
  assert.deepEqual(ailsReadingPageIds.slice(-2), ["names", "references"]);
  assert.match(reader, /ailsReadingPageIds\.map/u);
  assert.match(reader, /positionTotal=\{readingPages\.length\}/u);
  assert.doesNotMatch(data.groups.find((group) => group.id === "practice")?.label ?? "", /練習/u);
});

test("builds bounded non-repeating AILS sets and filters from its own progress", () => {
  const untouched = () => ({ bookmarked: false, mastered: false, read: false, attempts: 0, lastCorrect: null });
  const wrongOnly = filterAilsQuestions(
    data.questions,
    { learningState: "wrong" },
    (number) => ({ ...untouched(), attempts: number === 7 ? 1 : 0, lastCorrect: number === 7 ? false : null }),
  );
  assert.deepEqual(wrongOnly.map((question) => question.num), [7]);

  const sequential = buildAilsQuestionSet(data.questions, { topic: data.questions[0].topic }, untouched, 10, "sequential");
  assert.equal(sequential.length, 10);
  assert.equal(new Set(sequential).size, sequential.length);

  const randomized = orderAilsQuestions(data.questions.slice(0, 12), "random", () => 0).map((question) => question.num);
  assert.equal(new Set(randomized).size, 12);
  assert.notDeepEqual(randomized, data.questions.slice(0, 12).map((question) => question.num));
});

test("migrates legacy AILS bookmarks and mastery into the isolated v2 schema", () => {
  const parsed = parseAilsQuestionProgress({
    schemaVersion: 2,
    records: {
      1: { bookmarked: true, attempts: 2, correctAttempts: 1, lastCorrect: false, lastSelectedKeys: ["B"], lastAttemptAt: "2026-07-23T00:00:00.000Z" },
      273: { bookmarked: true },
    },
  });
  assert.deepEqual(Object.keys(parsed.records), ["1"]);
  const migrated = migrateAilsQuestionProgress(parsed, [2], [3]);
  assert.equal(migrated.records["1"].attempts, 2);
  assert.equal(migrated.records["2"].bookmarked, true);
  assert.equal(migrated.records["3"].mastered, true);
  const cancelledState = migrateAilsQuestionProgress({
    schemaVersion: 2,
    records: {
      2: { ...migrated.records["2"], bookmarked: false },
      3: { ...migrated.records["3"], mastered: false },
    },
  }, [2], [3]);
  assert.equal(cancelledState.records["2"].bookmarked, false);
  assert.equal(cancelledState.records["3"].mastered, false);
  assert.match(progressHook, /localStorage\.removeItem\(AILS_BOOKMARKS_LEGACY_KEY\)/u);
  assert.match(progressHook, /localStorage\.removeItem\(AILS_MASTERED_LEGACY_KEY\)/u);
});
