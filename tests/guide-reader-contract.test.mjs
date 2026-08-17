import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const guide = await readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8");
const learningGuide = await readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../app/components/learning-data-dialog.tsx", import.meta.url), "utf8");
const sheet = await readFile(new URL("../app/components/question-sheet.tsx", import.meta.url), "utf8");
const markdown = await readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8");
const css = await readLegacyCss();
const instrument = await readFile(new URL("../app/site.css", import.meta.url), "utf8");
const guideReaderTools = await readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8");

test("adds a first-class 303-chapter guide route with its own 2-by-3 reading matrix", () => {
  assert.match(app, /name: "學習指引"[^}]*hash: "guides"/);
  assert.match(app, /<LearningGuideView/);
  assert.match(learningGuide, /<GuideView/);
  assert.match(guide, /303 章學習指引目錄/);
  assert.match(guide, /<MarkdownContent[\s\S]{0,160}variant="guide"/);
  assert.match(guide, /<ReadingVariantSelector/);
  assert.match(guide, /ariaLabel="學習指引版本與閱讀程度選擇器"/);
  assert.match(guide, /<GuideReaderToolsPanel/u);
  assert.match(guideReaderTools, /const panelClasses = \["guide-utility-panel"/u);
  assert.match(guide, /aria-label="本章文章目錄"/);
  assert.match(guide, /mode === "quick"\) return "5 分鐘"/);
  assert.match(guide, /mode === "focus" \? "標準" : "完整"/);
  assert.match(guide, /const defaultGuideReadingPreference[\s\S]{0,180}packId: "detailed",[\s\S]{0,80}readingMode: "full"/u);
  assert.match(guide, /guideModeFromDepth/);
  assert.match(guide, /loadStudyGuideMarkdown\(selectedChapter, effectivePackId, loadedReadingMode\)/);
  assert.match(guide, /setDisplayedGuide/);
  assert.match(guide, /本章相關歷屆題目/);
  assert.match(guide, /onOpenReader\(question\.id\)/);

  const editions = guide.match(/const guideEditionOptions[\s\S]*?const markdown/)?.[0] ?? "";
  assert.match(editions, /label: "精要學習指引"/);
  assert.match(editions, /label: "詳細學習指引"/);
  assert.match(editions, /disabled: !detailedAvailable/);
  assert.match(editions, /詳細版尚未開放/);
  assert.doesNotMatch(editions, /label: "(?:精要|詳細)詳解"/);
  assert.equal((editions.match(/label: "(?:精要|詳細)學習指引"/g) ?? []).length, 2);
});

test("advanced source view is an opt-in fourth guide depth, not a third content family", () => {
  assert.match(dialog, /type="checkbox" checked=\{rawDraftEnabled\}/);
  assert.match(dialog, /<strong>顯示進階內容<\/strong>/);
  assert.match(dialog, /onRawDraftEnabledChange\(event\.target\.checked\)/);
  assert.match(app, /em-board-raw-draft-enabled-v1/);
  assert.match(app, /rawDraftMode=\{rawDraftEnabled\}/);

  assert.match(guide, /rawDraftMode: boolean/);
  assert.match(guide, /rawReadingDepthOption[\s\S]*?id: "raw"[\s\S]*?label: "進階內容"/);
  assert.match(guide, /rawDraftMode\s*\?\s*\[\.\.\.defaultReadingDepthOptions, rawReadingDepthOption\]\s*:\s*defaultReadingDepthOptions/);
  assert.match(guide, /depthOptions=\{guideDepthOptions\}/);
  assert.match(guide, /const rawActive = deepLinkScope[\s\S]{0,140}: rawDraftMode && rawSelected/);
  assert.match(guide, /serializeGuideReadingPreference[\s\S]{0,140}JSON\.stringify\(value\)/);
  assert.match(guide, /useNamespacedReadingVariantPreference\(\{[\s\S]{0,180}namespace: "tintinalli"/);
  assert.match(guide, /displayedRaw\s*\?\s*<pre><code>\{markdown\}<\/code><\/pre>\s*:\s*<MarkdownContent/);

  const depthOptions = guide.match(/const guideDepthOptions[\s\S]*?;/)?.[0] ?? "";
  assert.doesNotMatch(depthOptions, /學習指引|詳解/);
});

test("links questions back to guides only after study metadata is visible", () => {
  assert.match(sheet, /showStudyMetadata && onOpenGuide && Boolean\(question\.tintinalliChapters\?\.length\)/);
  assert.match(sheet, /onOpenGuide\(chapter\)/);
  assert.match(sheet, /aria-label="本題對應的 Tintinalli 學習指引"/);
});

test("uses a guide-safe Markdown path and prevents chapter anchors from breaking app routing", () => {
  assert.match(markdown, /variant === "question" \? normalizeMarkdown\(markdown\) : markdown\.replace/);
  assert.match(markdown, /event\.preventDefault\(\)/);
  assert.match(markdown, /scrollElementIntoView\(document\.getElementById\(id\), \{ block: "start" \}\)/);
  assert.match(css, /\.guide-page \{[^}]*display: grid/);
  assert.match(instrument, /:root\s*\{[\s\S]*?color-scheme:\s*light;[\s\S]*?--site-reading:/u);
  assert.match(instrument, /html\[data-theme="dark"\]\s*\{[\s\S]*?color-scheme:\s*dark;/u);
  assert.match(instrument, /html\[data-theme-mode="black"\]\s*\{[\s\S]*?--site-canvas:\s*#000000;/u);
  assert.match(instrument, /\.reader-reading-column > article,\s*\.guide-article,\s*\.ails-guide-article\s*\{[^}]*max-width:\s*var\(--site-reading-max\);/su);
  assert.doesNotMatch(guide, /background:\s*#fff/);
});
