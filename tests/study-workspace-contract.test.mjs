import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const practice = await readFile(new URL("../app/views/practice-view.tsx", import.meta.url), "utf8");
const guide = await readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8");
const guideHook = await readFile(new URL("../app/hooks/use-guide-progress.ts", import.meta.url), "utf8");
const guideNoteMigration = await readFile(new URL("../app/hooks/use-guide-note-migration.ts", import.meta.url), "utf8");
const guideApi = await readFile(new URL("../app/api/guide-progress/route.ts", import.meta.url), "utf8");
const annotationApi = await readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8");
const annotationTools = await readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0004_rare_black_panther.sql", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const siteCss = await readFile(new URL("../app/site.css", import.meta.url), "utf8");

test("launches canonical daily concept ids without routing through mutable filters", () => {
  assert.match(app, /dedupeCanonicalQuestionIds\(ids, questionById, \{ progressMap: progress\.progressMap \}\)/);
  assert.match(app, /setPracticeLaunch\(\{ ids: conceptIds, nonce: Date\.now\(\) \}\)/);
  assert.match(practice, /startSpecificSession\(launch\.ids, launch\.mode \?\? "study"\)/);
  assert.match(practice, /onLaunchConsumed\(launch\.nonce\)/);
  assert.match(practice, /<StudyPlanPanel compact/);
});

test("keeps guide progress separate from shared annotations, account-scoped, additive, and bounded to 303 chapters", () => {
  assert.match(guideHook, /CACHE_PREFIX = "em-board-guide-progress-cache-v1:"/);
  assert.match(guideHook, /OUTBOX_PREFIX = "em-board-guide-progress-outbox-v1:"/);
  assert.match(guideHook, /LOCAL_ACCOUNT_KEY = "anonymous-device"/, "未登入的指引進度應保存在裝置端");
  assert.match(guideHook, /response\.status === 401/, "指引 API 的 localOnly 回應必須切換到本機模式");
  assert.match(guideHook, /migrateLocalOutbox\(remote\.accountKey\)/, "登入後應搬移匿名指引 outbox");
  assert.match(guideHook, /writeOutbox\(LOCAL_ACCOUNT_KEY, \[\]\)/, "帳號 outbox 寫入成功後才能清除匿名來源");
  assert.doesNotMatch(guideHook, /throw new Error\("章節進度尚未完成帳號驗證"\)/, "匿名指引操作不應被帳號驗證阻擋");
  assert.match(guideApi, /Number\(input\.chapterId\) > 303/);
  assert.match(guide, /我的進度/);
  assert.match(guide, /onBookmarkChapter/);
  assert.match(guide, /progressStatus === "loading"/);
  assert.match(guide, /if \(!selectedProgress\) await onMarkChapter/);
  assert.match(guide, /import ContentAnnotationTools, \{ type ContentAnnotationSource \} from "\.\.\/components\/content-annotation-tools"/u);
  assert.match(guide, /annotations=\{annotations\}/u);
  assert.match(guide, /onUpsert=\{onUpsertAnnotation\}/u);
  assert.match(guide, /onRemove=\{onRemoveAnnotation\}/u);
  assert.match(app, /useGuideNoteMigration\(\{/u);
  assert.match(guideNoteMigration, /return onClearLegacyNote\(chapterId, ""\)/u);
  assert.match(guideNoteMigration, /guideNoteMigrationScopesAligned/u);
  assert.doesNotMatch(guide, /onClearLegacyChapterNote|saveChapterNote/u);
  assert.doesNotMatch(guide, /onSaveChapterNote/u);
  assert.match(annotationTools, /source\.kind === "guide"/u);
  assert.match(annotationApi, /annotationBodyLimit\(value\.questionId, value\.kind\)/u);
  assert.match(migration, /CREATE TABLE `guide_progress`/);
  assert.doesNotMatch(migration, /DROP |RENAME /i);
});

test("all primary page formats share one outer frame system", () => {
  assert.match(siteCss, /--site-max:\s*1600px/u);
  assert.match(siteCss, /--page-max-width:\s*var\(--site-max\)/u);
  assert.match(siteCss, /--page-inner-width:\s*var\(--site-max\)/u);
  assert.match(css, /\.dashboard-page \{[^}]*max-width: var\(--page-max-width\)[^}]*padding: var\(--page-top\) var\(--page-gutter\) var\(--page-bottom\)/);
  assert.match(css, /\.workspace-page \{[^}]*max-width: var\(--page-max-width\)[^}]*padding: var\(--page-top\) var\(--page-gutter\) var\(--page-bottom\)/);
  assert.match(css, /\.reader-page \{[^}]*margin: var\(--page-top\) auto var\(--page-bottom\)[^}]*max-width: var\(--page-inner-width\)/);
  assert.match(css, /\.guide-page \{[^}]*margin: var\(--page-top\) auto var\(--page-bottom\)[^}]*max-width: var\(--page-inner-width\)/);
  assert.match(css, /\.practice-session-page \{ max-width: var\(--page-max-width\)/);
  assert.match(css, /\.rest-page \{ max-width: var\(--page-max-width\)/);
});
