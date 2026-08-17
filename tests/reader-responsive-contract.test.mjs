import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const css = await readLegacyCss();
const instrument = await readFile(new URL("../app/site.css", import.meta.url), "utf8");
const reader = await readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8");
const guide = await readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8");
const ailsGuide = await readFile(new URL("../app/views/ails-guide-view.tsx", import.meta.url), "utf8");
const readingNavigation = await readFile(new URL("../app/hooks/use-reading-navigation.ts", import.meta.url), "utf8");
const readingFontPreference = await readFile(new URL("../app/hooks/use-reading-font-preference.ts", import.meta.url), "utf8");
const readingVariantPreference = await readFile(new URL("../app/hooks/use-reading-variant-preference.ts", import.meta.url), "utf8");
const explanationPreferences = await readFile(new URL("../app/hooks/use-explanation-preferences.ts", import.meta.url), "utf8");
const readingFontControls = await readFile(new URL("../app/components/reading-font-controls.tsx", import.meta.url), "utf8");
const readingNextPrev = await readFile(new URL("../app/components/reading-next-prev.tsx", import.meta.url), "utf8");
const markdown = await readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8");
const rosens = await readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8");
const ems = await readFile(new URL("../app/views/ems-guide-view.tsx", import.meta.url), "utf8");
const supplementalGuide = await readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8");
const guideReaderTools = await readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8");
const handoff = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");

function mediaSlice(query) {
  const start = css.indexOf(query);
  assert.notEqual(start, -1, `找不到媒體規則：${query}`);
  return css.slice(start);
}

test("mobile reader controls stay compact and horizontal", () => {
  const start = css.indexOf("@media (max-width: 600px)");
  const end = css.indexOf("@media (min-width: 1181px)", start);
  const mobile = css.slice(start, end);

  assert.match(reader, /aria-label="開啟題目目錄"[\s\S]*?<span>目錄<\/span>/);
  assert.doesNotMatch(reader, /<div><span>\{question\.id\}<\/span><strong>\{question\.title\}<\/strong><\/div>/);
  assert.match(reader, /className="reader-mobile-tools-trigger reading-toolbar-tools" disabled=\{!question\}/);
  assert.match(reader, /<ReadingVariantSelector/);
  assert.match(guide, /<ReadingVariantSelector/);
  assert.match(guideReaderTools, /className="guide-mobile-tools-trigger reading-toolbar-tools"/);
  assert.match(guideReaderTools, /className="reader-actions-bar guide-actions-bar"/);
  assert.doesNotMatch(guide, /className="guide-mobile-actions"/);
  assert.doesNotMatch(guide, /guide-rail-secondary|guide-rail-font|StickyNote/u);
  assert.match(guideReaderTools, /className="guide-toc-trigger reading-toolbar-outline"/);
  assert.match(css, /\.reader-toolbar \{[^}]*overflow-x: auto;/);
  assert.match(css, /\.reader-toolbar > \* \{ flex: 0 0 auto; \}/);
  assert.match(mobile, /\.reader-toolbar \{[^}]*flex-wrap: nowrap;/);
  assert.match(mobile, /\.reader-toolbar \.font-controls \{ display: none; \}/);
  assert.match(mobile, /\.reader-mobile-tools-trigger \{[^}]*display: flex;/);
  assert.match(mobile, /\.reader-utility-panel, \.guide-utility-panel \{ display: none; \}/);
  assert.match(mobile, /\.reader-utility-panel\.mobile-open, \.guide-utility-panel\.mobile-open \{[^}]*position: fixed;[^}]*z-index: 92;/);
  assert.match(mobile, /\.reader-actions-bar \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.reading-variant-selector__summary \{ justify-content: center; width: 100%; \}/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.reading-variant-selector__stage \{[\s\S]*?flex-wrap: nowrap;/);
  assert.match(mobile, /\.guide-font-controls \{ display: none; \}/);
  assert.match(mobile, /\.guide-article \.markdown-body > h1:first-child \{ display: none; \}/);
  assert.match(mobile, /\.guide-read-state \{ display: none; \}/);
  assert.match(css, /\.reader-toc-sheet \{[^}]*max-height: min\(82dvh, 760px\);[^}]*overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 400px\) \{[\s\S]*?\.reader-list-trigger span, \.reader-toc-trigger span/);
  assert.match(instrument, /\.reader-actions-bar > button\.active,\s*\.reader-actions-bar > button\.done,\s*\.guide-actions-bar > button\.active\s*\{[^}]*background:\s*var\(--site-success-soft\);[^}]*color:\s*var\(--site-success\);/su);
});

test("detailed reader and guide share navigation, font sizing, and the same four common actions", () => {
  for (const view of [reader, guide]) {
    assert.match(view, /import ReadingFontControls from "\.\.\/components\/reading-font-controls"/u);
    assert.match(view, /import ReadingNextPrev from "\.\.\/components\/reading-next-prev"/u);
    assert.match(view, /import \{ useReadingFontPreference \} from "\.\.\/hooks\/use-reading-font-preference"/u);
    assert.match(view, /import \{ useReadingNavigation \} from "\.\.\/hooks\/use-reading-navigation"/u);
    assert.match(view, /const \{ level: fontSize, setLevel: setFontSize \} = useReadingFontPreference\(\)/u);
    assert.match(view, /const readingNavigation = useReadingNavigation\(\{/u);
    assert.match(view, /<ReadingFontControls/u);
    assert.match(view, /<ReadingNextPrev/u);
    assert.match(view, /\.\.\.readingNavigation/u);
  }

  assert.match(reader, /className="reader-actions-bar"[\s\S]{0,2500}稍後[\s\S]{0,2500}讀完[\s\S]{0,2500}收藏[\s\S]{0,2500}<ContentAnnotationTools/u);
  assert.match(guideReaderTools, /className="reader-actions-bar guide-actions-bar"[\s\S]{0,2200}稍後再讀[\s\S]{0,2200}標記讀完[\s\S]{0,2200}收藏[\s\S]{0,2200}progressActions\.annotationControl/u);
  assert.match(guide, /annotationControl: <ContentAnnotationTools/u);
  assert.match(reader, /const selectQuestion = useCallback\([\s\S]{0,260}setJumpOpen\(false\)[\s\S]{0,120}setTocOpen\(false\)[\s\S]{0,120}setMobileToolsOpen\(false\)/u);
  assert.match(css, /\.reader-actions-bar \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/u);
  assert.doesNotMatch(css, /\.guide-mobile-actions \{[^}]*grid-template-columns:/u);

  assert.match(readingNavigation, /export const READING_SWIPE_THRESHOLD = 78/u);
  assert.match(readingNavigation, /export const READING_SWIPE_DIRECTION_RATIO = 1\.45/u);
  for (const exclusion of ["button", "textarea", "dialog", "pre", ".table-scroll", ".katex", ".katex-display", ".flow-sequence", ".flow-tree", ".decision-tree", ".selection-action-bar", ".annotation-panel", ".reading-variant-selector", "[data-reading-navigation-ignore]"]) {
    assert.match(readingNavigation, new RegExp(exclusion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(readingNavigation, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/u);
  assert.match(readingNavigation, /hasExpandedSelection\(\)/u);
  assert.match(readingFontPreference, /READING_FONT_PREFERENCE_KEY = "em-board-reading-font-level-v1"/u);
  assert.match(readingFontPreference, /value === 0 \|\| value === 1 \|\| value === 2/u);
  assert.match(readingFontControls, /level === 0/u);
  assert.match(readingFontControls, /level === 2/u);
  assert.match(readingNextPrev, /export type ReadingNextPrevVariant = "icons" \| "labels" \| "titles"/u);
  assert.ok((markdown.match(/data-reading-navigation-ignore/gu) ?? []).length >= 4);
  assert.match(markdown, /className=\{className\} role="region"[\s\S]{0,220}tabIndex=\{0\} data-reading-navigation-ignore/u);
});

test("shared reading controls keep accessible targets and one font-control visual language", () => {
  assert.match(readingFontControls, /\["reading-font-controls", className\]\.filter\(Boolean\)\.join\(" "\)/u);
  assert.match(css, /\.reading-font-controls button \{[^}]*height: 29px;[^}]*width: 29px;/u);
  assert.match(instrument, /\.reader-size-0 \{\s*--reading-font-size: 14px;/u);
  assert.match(instrument, /\.reader-size-1 \{\s*--reading-font-size: 16px;/u);
  assert.match(instrument, /\.reader-size-2 \{\s*--reading-font-size: 18px;/u);
  assert.match(css, /\.guide-font-controls \{ margin-left: auto; \}/u);
  assert.doesNotMatch(css, /\.guide-font-controls button(?!:)/u);

  assert.match(css, /\.reader-actions-bar > button,\s*\.reader-actions-bar > \.reader-annotation-control > button \{[^}]*min-height: 44px;[^}]*transition:/u);
  assert.match(css, /\.reader-actions-bar > button\.active,\s*\.reader-actions-bar > \.reader-annotation-control > button\[aria-expanded="true"\]/u);
  assert.match(css, /@media \(hover: hover\)[\s\S]*?\.reader-actions-bar > \.reader-annotation-control > button[\s\S]*?:not\(:disabled\):hover/u);
  assert.match(css, /\.selection-action-bar button \{[^}]*min-height: 44px;[^}]*min-width: 44px;/u);
  assert.match(css, /\.annotation-panel > header button \{[^}]*height: 44px;[^}]*width: 44px;/u);

  const wide = mediaSlice("@media (min-width: 1181px)");
  assert.match(wide, /\.reader-rail-step-controls button \{[^}]*min-height: 44px;/u);
  assert.match(wide, /\.guide-rail-step-controls button \{[^}]*min-height: 44px;/u);
  assert.match(wide, /\.reader-actions-bar > button, \.reader-actions-bar > \.reader-annotation-control > button \{[^}]*min-height: 44px;/u);
});

test("guide outline remains open across the full compact-toolbar width", () => {
  for (const view of [guide, rosens, supplementalGuide, ailsGuide]) {
    assert.match(
      view,
      /open: outlineOpen,[\s\S]{0,240}dismissWhenMediaQueryStopsMatching: "\(max-width: 1440px\)"/u,
    );
  }
});

test("textbook readers share namespaced variant persistence without changing question-reader preferences", () => {
  assert.match(readingVariantPreference, /export type ReadingVariantPreferenceNamespace = "tintinalli" \| "rosens" \| "ems"/u);
  assert.match(readingVariantPreference, /tintinalli: "em-board-guide-preferences-v2"/u);
  assert.match(readingVariantPreference, /rosens: "em-board-rosens-guide-preferences-v2"/u);
  assert.match(readingVariantPreference, /ems: "em-board-ems-guide-preferences-v2"/u);
  assert.match(readingVariantPreference, /export function useNamespacedReadingVariantPreference/u);
  for (const [view, namespace] of [[guide, "tintinalli"], [rosens, "rosens"], [ems, "ems"]]) {
    assert.match(view, /import \{ useNamespacedReadingVariantPreference \} from "\.\.\/hooks\/use-reading-variant-preference"/u);
    assert.match(view, new RegExp(`namespace: "${namespace}"`, "u"));
    assert.doesNotMatch(view, /localStorage/u);
  }
  assert.match(explanationPreferences, /const PACK_KEY = "em-board-explanation-pack-v2"/u);
  assert.match(explanationPreferences, /const MODE_KEY = "em-board-explanation-mode-v2"/u);
  assert.doesNotMatch(readingVariantPreference, /em-board-explanation-(?:pack|mode)-v1/u);
  assert.match(handoff, /Tintinalli 與 Rosen’s 的裝置偏好共用 namespaced persistence hook/u);
  assert.match(handoff, /`useExplanationPreferences` 是全站題目詳解偏好/u);
});

test("Rosen’s imported reader shares navigation, depth, font, progress, and annotation controls", () => {
  assert.match(rosens, /import ReadingNextPrev from "\.\.\/components\/reading-next-prev"/u);
  assert.match(rosens, /import ReadingVariantSelector,[\s\S]{0,120}from "\.\.\/components\/reading-variant-selector"/u);
  assert.match(rosens, /import \{ useReadingNavigation \} from "\.\.\/hooks\/use-reading-navigation"/u);
  assert.equal((rosens.match(/<ReadingNextPrev/gu) ?? []).length, 2);
  assert.match(guideReaderTools, /<ReadingNextPrev className="guide-toolbar-step-controls reading-toolbar-steps"/u);
  assert.match(rosens, /<ReadingVariantSelector/u);
  assert.doesNotMatch(rosens, /data-reading-placeholder="true"/u);
  assert.match(rosens, /ContentAnnotationTools/u);
  assert.match(rosens, /ReadingFontControls/u);
  assert.match(rosens, /<GuideReaderToolsPanel/u);
  assert.match(guideReaderTools, /稍後再讀/u);
  assert.match(guideReaderTools, /標記讀完/u);
  assert.match(guideReaderTools, /收藏\$\{bookmarkNoun\}/u);
  assert.match(rosens, /data-content-annotation-root=\{annotationResourceId\}/u);
  assert.doesNotMatch(css, /\.rosens-(?:depth-selector|placeholder-levels)/u);
  assert.match(handoff, /Rosen’s 固定為 192 個核心章與 e01–e16，共 208 篇可閱讀正文/u);
  assert.match(handoff, /namespaced string resource ID/u);
});

test("obsolete Reader and Guide variant selector CSS does not survive the shared selector migration", () => {
  assert.doesNotMatch(css, /\.(?:reader-mode-bar|reader-pack-bar|mobile-reading-preferences|mobile-reading-pack|mobile-reading-depths|guide-content-selector|guide-pack-selector|guide-mode-selector|guide-sync-state)(?![-\w])/u);
  assert.doesNotMatch(css, /\.reader-rail-secondary\s*>\s*button/u);
});

test("wide reader gives the explanation priority while the compact rail never overlays it", () => {
  const wide = mediaSlice("@media (min-width: 1181px)");
  assert.match(wide, /\.reader-page \{[^}]*grid-template-columns: clamp\(220px, 15vw, 280px\) minmax\(0, 1160px\) clamp\(180px, 12vw, 210px\)/);
  assert.match(wide, /\.reader-page \{[^}]*max-width: 1760px;[^}]*width: calc\(100% - 32px\);/);
  assert.match(wide, /\.reader-reading-column \{ grid-column: 2;/);
  assert.match(wide, /\.reader-reading-column \.reader-sheet, \.reader-reading-column \.reader-notice, \.reader-reading-column \.reader-next-prev \{ max-width: 1160px; \}/);
  assert.match(wide, /\.reader-utility-panel \{[^}]*grid-column: 3;[^}]*position: sticky;[^}]*top: 80px;/);
  assert.match(wide, /\.reader-utility-panel \{[^}]*max-height: calc\(100dvh - 96px\);[^}]*overflow-y: auto;/);
  assert.doesNotMatch(wide, /\.reader-utility-(?:panel|inner) \{[^}]*position: fixed;/);
  assert.match(reader, /className="reader-rail-toc" aria-label="本題文章目錄"/);
  assert.match(wide, /\.reader-rail-toc, \.guide-utility-panel \.guide-outline-rail \{[^}]*display: grid;/);
});

test("wide guide shares the explanation reader's center width and sticky article rail", () => {
  const wide = mediaSlice("@media (min-width: 1181px)");
  assert.match(guide, /<GuideReaderToolsPanel/u);
  assert.match(guideReaderTools, /const panelClasses = \["guide-utility-panel"/u);
  assert.match(guideReaderTools, /className="guide-outline guide-outline-rail" aria-label=\{outlineAriaLabel\}/u);
  assert.match(wide, /\.guide-page \{[^}]*grid-template-columns: clamp\(220px, 15vw, 280px\) minmax\(0, 1160px\) clamp\(180px, 12vw, 210px\)/);
  assert.match(wide, /\.guide-reading-column \{[^}]*grid-column: 2;[^}]*max-width: 1160px;/);
  assert.match(wide, /\.guide-utility-panel \{[^}]*grid-column: 3;[^}]*position: sticky;[^}]*top: 80px;/);
  assert.match(wide, /\.guide-utility-panel \{[^}]*max-height: calc\(100dvh - 96px\);[^}]*overflow-y: auto;/);
  assert.doesNotMatch(wide, /\.guide-utility-(?:panel|inner) \{[^}]*position: fixed;/);
});

test("wide article rails expand their TOCs and scroll only as a whole when the viewport is short", () => {
  const wide = mediaSlice("@media (min-width: 1181px)");
  const tocRule = wide.match(/\.reader-rail-toc, \.guide-utility-panel \.guide-outline-rail \{[^}]*\}/)?.[0] ?? "";

  assert.match(tocRule, /max-height: none;/);
  assert.match(tocRule, /overflow: visible;/);
  assert.doesNotMatch(tocRule, /overflow-y: auto;/);
  assert.doesNotMatch(tocRule, /max-height: 290px;/);
  assert.match(wide, /\.reader-utility-panel \{[^}]*max-height: calc\(100dvh - 96px\);[^}]*overflow-y: auto;/);
  assert.match(wide, /\.guide-utility-panel \{[^}]*max-height: calc\(100dvh - 96px\);[^}]*overflow-y: auto;/);
});

test("guide H4 outline entries use the same semantic dot in rails and mobile sheets", () => {
  const h4LayoutRule = instrument.match(
    /\.guide-outline > button\[data-level="4"\],\s*\.guide-toc-sheet > button\[data-level="4"\]\s*\{[^}]*\}/u,
  )?.[0] ?? "";
  const h4DotRule = instrument.match(
    /\.guide-outline > button\[data-level="4"\]::before,\s*\.guide-toc-sheet > button\[data-level="4"\]::before\s*\{[^}]*\}/u,
  )?.[0] ?? "";

  assert.match(h4LayoutRule, /padding-left:\s*22px;/u);
  assert.match(h4LayoutRule, /position:\s*relative;/u);
  assert.match(h4DotRule, /background:\s*var\(--site-success\);/u);
  assert.match(h4DotRule, /content:\s*"";/u);
  assert.match(h4DotRule, /height:\s*5px;/u);
  assert.match(h4DotRule, /width:\s*5px;/u);
  assert.doesNotMatch(h4DotRule, /#[\da-f]{3,8}|rgba?\(|hsla?\(/iu);
  assert.match(css, /\.markdown-body h4::before \{[^}]*background:\s*var\(--site-success\);[^}]*height:\s*5px;[^}]*width:\s*5px;/u);
});

test("Tintinalli chapter progress becomes a bounded mobile grid", () => {
  const baseRule = css.indexOf(".section-performance-head, .section-performance-list > button");
  const mobileRule = css.lastIndexOf(".section-performance-head { display: none; }");
  assert.ok(baseRule >= 0 && mobileRule > baseRule, "手機覆寫必須位於桌面四欄規則之後");
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 840px)", mobileRule), css.indexOf("@media (max-width: 600px)", mobileRule));
  assert.match(mobile, /\.section-performance \{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*width: 100%;/);
  assert.match(mobile, /\.section-performance-head \{ display: none; \}/);
  assert.match(mobile, /\.section-performance-list \{[^}]*max-width: 100%;[^}]*overflow-x: hidden;[^}]*width: 100%;/);
  assert.match(mobile, /\.section-performance-list > button \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) 64px;[^}]*min-width: 0;[^}]*width: 100%;/);
  assert.doesNotMatch(css, /\.section-performance-head, \.section-performance-list > button \{ min-width: 610px; \}/);
});
