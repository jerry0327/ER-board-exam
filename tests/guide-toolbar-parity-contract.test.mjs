import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const [tintinalli, rosens, supplemental, ems, tools, progressFilter, css, siteCss, handoff] = await Promise.all([
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ems-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/guide-progress-filter.tsx", import.meta.url), "utf8"),
  readLegacyCss(),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
]);

test("every textbook guide delegates the complete right and mobile tool panel to one shared system", () => {
  for (const view of [tintinalli, rosens, supplemental, ems]) {
    assert.match(view, /import GuideReaderToolsPanel, \{ GuideReaderToolbar, GuideTextbookSwitcher \} from "\.\.\/components\/guide-reader-tools"/u);
    assert.equal((view.match(/<GuideReaderToolbar/gu) ?? []).length, 1);
    assert.equal((view.match(/<GuideReaderToolsPanel/gu) ?? []).length, 1);
    assert.match(view, /open=\{compactTools && mobileToolsOpen\}/u);
    assert.match(view, /hidden=\{compactTools && !mobileToolsOpen\}/u);
    assert.match(view, /currentTextbook=/u);
    assert.match(view, /onOpenLibrary=\{onOpenLibrary\}/u);
    assert.match(view, /navigation=\{/u);
    assert.match(view, /progressActions=/u);
    assert.doesNotMatch(view, /className="reader-actions-bar guide-actions-bar"/u);
    assert.doesNotMatch(view, /className="guide-toolbar"/u);
    assert.doesNotMatch(view, /guide-textbook-switcher-rail/u);
  }

  assert.match(tools, /Shared top toolbar for every textbook and supplemental guide reader/u);
  assert.match(tools, /className=\{\["guide-toolbar", "reading-toolbar", className\]\.filter\(Boolean\)\.join\(" "\)\}/u);
  assert.match(tools, /<ReadingNextPrev className="guide-toolbar-step-controls reading-toolbar-steps"/u);
  const libraryTrigger = tools.indexOf('className="guide-list-trigger reading-toolbar-library"');
  const outlineTrigger = tools.indexOf('className="guide-toc-trigger reading-toolbar-outline"');
  const fontControl = tools.indexOf('className="guide-font-controls reading-toolbar-font"');
  const mobileTrigger = tools.indexOf('className="guide-mobile-tools-trigger reading-toolbar-tools"');
  assert.ok(libraryTrigger >= 0 && libraryTrigger < outlineTrigger, "目錄入口必須先於文章目錄");
  assert.ok(outlineTrigger < fontControl, "文章目錄必須先於字級控制");
  assert.ok(fontControl < mobileTrigger, "字級控制必須先於手機閱讀工具入口");
  assert.match(tools, /Shared right rail and mobile reading panel for every textbook guide/u);
  assert.match(tools, /const panelClasses = \["guide-utility-panel", className, open \? "mobile-open" : ""\]/u);
  assert.match(tools, /className="guide-utility-inner overlay-panel"/u);
  assert.match(tools, /<GuideTextbookSwitcher rail currentTextbook=\{currentTextbook\} onOpenLibrary=\{onOpenLibrary\} \/>/u);
  assert.ok(tools.indexOf("{open && variantSelector}") < tools.indexOf("<GuideTextbookSwitcher rail"), "閱讀深度切換必須排在手機面板的教科書與音檔工具之前");
  assert.ok(tools.indexOf("{!open && variantSelector}") > tools.indexOf("{progressActions && ("), "寬螢幕工具欄必須保留既有的閱讀深度位置");
  assert.match(tools, /aria-label=\{`切換教科書，目前為 \$\{currentTextbook\}`\}/u);
  assert.match(tools, /<ReadingFontControls className="mobile-reading-font-tools"/u);
  assert.match(tools, /className="guide-outline guide-outline-rail"/u);
});

test("mobile guide tools expose one-tap reading depths in the opening viewport", () => {
  const mobileBreakpoint = siteCss.indexOf("@media (max-width: 600px)");
  assert.notEqual(mobileBreakpoint, -1);
  const mobileCss = siteCss.slice(mobileBreakpoint);
  assert.match(mobileCss, /\.guide-utility-panel \.reading-variant-selector__desktop-matrix \{\s*display: grid;\s*\}/u);
  assert.match(mobileCss, /\.guide-utility-panel \.reading-variant-selector__mobile-flow \{\s*display: none;\s*\}/u);
  assert.match(mobileCss, /\.guide-utility-panel \.reading-variant-selector__desktop-choice \{\s*min-height: 44px;\s*\}/u);
});

test("the shared guide action bar fixes one order for later, done, bookmark, and notes", () => {
  const later = tools.indexOf("onClick={progressActions.onToggleLater}");
  const done = tools.indexOf("onClick={progressActions.onToggleDone}");
  const bookmark = tools.indexOf("onClick={progressActions.onToggleBookmark}");
  const annotation = tools.indexOf("{progressActions.annotationControl}");

  assert.ok(later >= 0 && later < done, "稍後必須先於讀完");
  assert.ok(done < bookmark, "讀完必須先於收藏");
  assert.ok(bookmark < annotation, "收藏必須先於筆記");
  assert.match(tools, /className="reader-actions-bar guide-actions-bar"/u);
  assert.match(tools, /onSelectOutline\?\.\(item\.id\); if \(open\) onClose\(\);/u);
});

test("every chapter catalog shares all personal-progress filter options", () => {
  for (const view of [tintinalli, rosens, ems]) {
    assert.match(view, /import GuideProgressFilter, \{ matchesGuideProgressFilter, type GuideProgressFilterValue \} from "\.\.\/components\/guide-progress-filter"/u);
    assert.match(view, /<GuideProgressFilter/u);
    assert.match(view, /matchesGuideProgressFilter\(progress, progressFilter\)/u);
  }

  assert.match(progressFilter, /GuideProgressFilterValue = "all" \| "reading" \| "later" \| "done" \| "bookmarked"/u);
  assert.match(progressFilter, /<option value="all">我的全部進度<\/option>[\s\S]{0,120}<option value="reading">閱讀中<\/option>[\s\S]{0,120}<option value="later">稍後閱讀<\/option>[\s\S]{0,120}<option value="done">已完成<\/option>[\s\S]{0,120}<option value="bookmarked">已收藏<\/option>/u);
  assert.match(progressFilter, /return progress\?\.readState === filter/u);
});

test("the repository contract forbids a second Rosen or Tintinalli toolbar implementation", () => {
  assert.doesNotMatch(`${tintinalli}\n${rosens}\n${supplemental}\n${ems}\n${css}\n${siteCss}`, /rosens-utility-panel/u);
  assert.match(handoff, /必須共用 `GuideReaderToolbar`[\s\S]{0,120}必須共用 `GuideReaderToolsPanel`/u);
  assert.match(handoff, /必須共用 `GuideProgressFilter`，包含「稍後閱讀」/u);
});
