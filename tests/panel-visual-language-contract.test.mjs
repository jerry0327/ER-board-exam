import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readLegacyCss() {
  const siteCss = await readFile(new URL("../app/site.css", import.meta.url), "utf8");
  const legacyImports = [...siteCss.matchAll(/^@import\s+"\.\/([^"]+\.css)"\s+layer\(legacy\);$/gmu)]
    .map((match) => match[1]);
  const sources = await Promise.all(
    legacyImports.map((file) => readFile(new URL(`../app/${file}`, import.meta.url), "utf8")),
  );
  return sources.join("\n");
}

const [practice, practiceCss, legacyCss, boardCss, recognizedCss, spotlightCss, handoff, annotationTools, annotationDrawer, recognizedArea, spotlight, browse, themeToggle, reader, guide, rosensGuide, guideReaderTools, learningData, remoc] = await Promise.all([
  readFile(new URL("../app/views/practice-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/practice-tools.css", import.meta.url), "utf8"),
  readLegacyCss(),
  readFile(new URL("../app/board-prep.css", import.meta.url), "utf8"),
  readFile(new URL("../app/recognized-courses.css", import.meta.url), "utf8"),
  readFile(new URL("../app/spotlight.css", import.meta.url), "utf8"),
  readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
  readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/annotation-drawer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/recognized-courses-area.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/global-spotlight.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/browse-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/theme-toggle.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/learning-data-dialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/board-prep-remoc.tsx", import.meta.url), "utf8"),
]);
const [analyticsCss, analytics, boardView] = await Promise.all([
  readFile(new URL("../app/analytics-map.css", import.meta.url), "utf8"),
  readFile(new URL("../app/views/analytics-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/board-prep-view.tsx", import.meta.url), "utf8"),
]);
const [siteCss, layout] = await Promise.all([
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
]);

test("adjacent practice tools share one paper panel instead of inventing nested cards", () => {
  assert.match(practice, /className="practice-question-tools paper-card"/u);
  assert.match(practice, /className="quiet-button"[\s\S]{0,180}aria-pressed=\{eliminated\}/u);
  assert.match(practiceCss, /\.practice-question-tools\s*\{[^}]*gap:\s*0;[^}]*overflow:\s*hidden;/su);
  assert.doesNotMatch(practiceCss, /\.practice-question-tools\s*\{[^}]*(?:background|border-radius|box-shadow):/su);
  assert.match(practiceCss, /\.practice-scratchpad-tool\s*\{[^}]*border-top:\s*1px solid var\(--site-line\);/su);
  assert.doesNotMatch(practiceCss, /\.practice-elimination-tool,\s*\.practice-scratchpad-tool\s*\{[^}]*(?:background|box-shadow|border-radius):/su);
  assert.match(siteCss, /\.primary-button,\s*\.quiet-button,\s*\.outline-button,\s*\.text-action\s*\{[\s\S]*?border-radius:\s*var\(--site-radius\);/u);
  assert.match(practiceCss, /@media \(max-width: 760px\)[\s\S]*?\.practice-elimination-buttons \.quiet-button\s*\{[^}]*min-height:\s*52px;/u);
  assert.match(practiceCss, /@media \(max-width: 390px\)[\s\S]*?\.practice-elimination-buttons \.quiet-button\s*\{[^}]*font-size:\s*0;/u);
  assert.match(practiceCss, /\.practice-scratchpad-editor footer \.text-action\s*\{[^}]*color:\s*var\(--site-muted\);/su);
  assert.match(practiceCss, /\.practice-scratchpad-toggle:focus-visible\s*\{[^}]*outline-offset:\s*-3px;/su);
});

test("dialogs, sheets, drawers, and floating action bars use the shared overlay language", () => {
  for (const token of ["site-scrim", "site-shadow-overlay", "site-shadow-drawer", "site-shadow-sheet", "site-panel-radius"]) {
    assert.match(siteCss, new RegExp(`--${token}:`, "u"));
  }
  for (const selector of ["learning-data-backdrop", "practice-dialog-backdrop", "reader-modal-backdrop", "annotation-panel-backdrop", "reader-drawer-backdrop", "guide-drawer-backdrop", "mobile-reading-tools-backdrop"]) {
    assert.match(siteCss, new RegExp(`\\.${selector}(?:,|\\s*\\{)`, "u"));
  }
  assert.match(siteCss, /\.drawer-backdrop,[\s\S]*?\.annotation-panel-backdrop\s*\{[^}]*background:\s*var\(--site-scrim\);/u);
  assert.match(siteCss, /\.overlay-panel,\s*\.drawer-panel,\s*\.bottom-sheet-panel\s*\{[^}]*background:\s*var\(--site-paper\);/su);
  assert.match(siteCss, /\.overlay-panel\s*\{[^}]*box-shadow:\s*var\(--site-shadow-overlay\);/su);
  assert.match(legacyCss, /\.floating-action-bar\s*\{[^}]*background:\s*var\(--site-primary-fill\);[^}]*color:\s*var\(--site-on-primary\);/su);
  assert.match(annotationTools, /className="selection-action-bar floating-action-bar"/u);
  assert.match(annotationTools, /import AnnotationDrawer from "\.\/annotation-drawer"/u);
  assert.match(reader, /import ContentAnnotationTools, \{ type ContentAnnotationSource \} from "\.\.\/components\/content-annotation-tools"/u);
  assert.match(guide, /import ContentAnnotationTools, \{ type ContentAnnotationSource \} from "\.\.\/components\/content-annotation-tools"/u);
  assert.match(reader, /<ContentAnnotationTools/u);
  assert.match(guide, /<ContentAnnotationTools/u);
  assert.doesNotMatch(guide, /import AnnotationDrawer|<AnnotationDrawer/u);
  assert.match(annotationDrawer, /className="annotation-panel-backdrop"/u);
  assert.match(annotationDrawer, /className="annotation-panel drawer-panel"/u);
  assert.match(recognizedArea, /className="recognized-selection-bar floating-action-bar"/u);
  assert.match(browse, /className="browse-selection-bar floating-action-bar"/u);
  assert.match(themeToggle, /className="theme-menu overlay-panel"/u);
  assert.match(reader, /className="reader-utility-inner overlay-panel"/u);
  assert.match(guideReaderTools, /className="guide-utility-inner overlay-panel"/u);
  assert.match(guide, /<GuideReaderToolsPanel/u);
  assert.match(rosensGuide, /<GuideReaderToolsPanel/u);
  assert.match(reader, /listOpen \? "open drawer-panel"/u);
  assert.match(guide, /libraryOpen \? "open drawer-panel"/u);
  assert.match(rosensGuide, /libraryOpen \? "open drawer-panel"/u);
  assert.match(learningData, /className="quiet-button"[\s\S]{0,120}>取消<\/button>/u);
  assert.match(learningData, /className=\{confirming \? "danger-button" : "primary-button"\}/u);
  assert.match(siteCss, /\.reader-utility-inner,\s*\.guide-utility-inner\s*\{[^}]*background:\s*var\(--site-paper\);[^}]*border-color:\s*var\(--site-line\);/su);
  assert.doesNotMatch(legacyCss, /\.(?:browse-selection-bar|selection-action-bar)\s*\{[^}]*border-radius:/su);
  assert.doesNotMatch(recognizedCss, /\.recognized-selection-bar\s*\{[^}]*border-radius:/su);
  assert.match(recognizedCss, /\.recognized-dialog::backdrop\s*\{[^}]*background:\s*var\(--site-scrim\);/su);
  assert.doesNotMatch(recognizedCss, /\.recognized-dialog::backdrop\s*\{[^}]*var\(--site-ink\)/su);
  assert.doesNotMatch(recognizedCss, /\.recognized-selection-bar\s*\{[^}]*background:\s*var\(--site-ink\)/su);
  assert.match(handoff, /題庫與學習指引的筆記屬同一功能/u);
  assert.match(handoff, /必須共用同一套 annotation 資料管線、右側筆記 drawer、Markdown 預覽、筆記本匯入/u);
  assert.match(handoff, /詳解閱讀與學習指引的字級、精要／詳細選擇器、稍後、讀完、收藏、筆記、上一／下一/u);
  assert.match(handoff, /不得在正文中插入頁內筆記卡/u);
});

test("analytics maps reuse shared surfaces and controls", () => {
  assert.match(analytics, /className="topic-treemap paper-card"/u);
  assert.match(analytics, /className="topic-map-detail paper-card"/u);
  assert.match(analytics, /className="topic-browse-action primary-button"/u);
  assert.match(analytics, /className="topic-mobile-practice paper-card"/u);
  assert.match(analytics, /<select className="field-control"/u);
  assert.match(analytics, /className="topic-mobile-browse text-action"/u);
  assert.match(analytics, /className="paper-card" key=\{row\.key\}/u);
  assert.ok((analytics.match(/className="quiet-button"/gu) ?? []).length >= 7);

  for (const selector of [
    String.raw`\.topic-treemap`,
    String.raw`\.topic-map-detail`,
    String.raw`\.overlap-list\s*>\s*div`,
    String.raw`\.topic-mobile-practice`,
    String.raw`\.topic-practice-actions\s*>\s*button`,
    String.raw`\.topic-mobile-ranking\s*>\s*button`,
    String.raw`\.topic-mobile-practice\s*>\s*div\s*>\s*button`,
    String.raw`\.topic-mobile-browse`,
  ]) {
    assert.doesNotMatch(
      analyticsCss,
      new RegExp(`${selector}\\s*\\{[^}]*(?:background(?:-color)?|border(?:-[\\w-]+)?|border-radius|box-shadow|color)\\s*:`, "su"),
    );
  }

  for (const [tone, token] of [
    [0, "success-soft"],
    [1, "paper-soft"],
    [3, "warning-soft"],
    [4, "paper"],
  ]) {
    assert.match(
      analyticsCss,
      new RegExp(
        `\\.topic-treemap\\s*>\\s*button\\[data-tone="${tone}"\\]\\s*\\{[^}]*background:\\s*var\\(--site-${token}\\);`,
        "su",
      ),
    );
  }
  assert.match(
    analyticsCss,
    /\.topic-treemap\s*>\s*button\[data-tone="2"\]\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--site-info\)[^}]*var\(--site-paper\)\);/su,
  );
  assert.doesNotMatch(analyticsCss, /(?:background|border(?:-color)?|box-shadow|color):\s*(?:#[0-9a-f]{3,8}|rgba?\(|white\b)/iu);
  assert.doesNotMatch(analytics, /#[0-9a-f]{3,8}/iu);
  assert.doesNotMatch(legacyCss, /\.topic-map-canvas/u);
  assert.doesNotMatch(legacyCss, /\.topic-map-card\s*\{[^}]*(?:background|border(?:-[\w-]+)?|border-radius|box-shadow)\s*:/su);
  assert.doesNotMatch(analyticsCss, /data-theme(?:-mode)?=/u);
});

test("page styles do not create fallback palettes or independent panel systems", () => {
  assert.doesNotMatch(`${boardCss}\n${recognizedCss}`, /--(?:board-prep|prep)-(?:sage|gold)[^:]*:\s*#/u);
  assert.doesNotMatch(`${boardCss}\n${recognizedCss}`, /var\(--(?:board-prep|prep)-(?:sage|gold)/u);
  assert.doesNotMatch(spotlightCss, /var\(--[^,)]+,/u);
  assert.doesNotMatch(spotlightCss, /backdrop-filter|border-radius:\s*17px|110px/u);
  assert.match(spotlightCss, /\.spotlight-overlay\s*\{[^}]*background:\s*var\(--site-scrim\);/su);
  assert.match(spotlight, /className="spotlight-dialog overlay-panel"/u);
  assert.match(spotlight, /className="quiet-button spotlight-trigger"/u);
  assert.match(spotlight, /className="icon-button spotlight-close"/u);
  const spotlightResultClasses = [...spotlight.matchAll(/className="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((className) => className.split(/\s+/u).includes("spotlight-result"));
  assert.ok(spotlightResultClasses.length > 0);
  assert.ok(spotlightResultClasses.every((className) => className.split(/\s+/u).includes("quiet-button")));
  assert.match(spotlight, /className="paper-card spotlight-question-result"/u);
  assert.match(spotlight, /className="quiet-button spotlight-practice-one"/u);
  assert.doesNotMatch(
    spotlightCss,
    /\.spotlight-(?:result|question-result|practice-one)(?![-\w])[^,{]*\{[^}]*(?:background(?:-color)?|border(?:-[\w-]+)?|box-shadow|color)\s*:/su,
  );
  assert.match(boardView, /className="course-panel-header paper-card"/u);
  assert.match(remoc, /className="course-panel-header remoc-summary-header"/u);
  for (const source of [boardView, remoc]) {
    assert.match(source, /className="course-panel-heading"/u);
    assert.match(source, /className="eyebrow"/u);
    assert.match(source, /className="course-panel-actions"/u);
  }
  assert.match(remoc, /className="remoc-summary-panel paper-card"/u);
  assert.doesNotMatch(remoc, /className="paper-card remoc-progress-panel"/u);
  assert.doesNotMatch(remoc, /remoc-region-tabs/u);
  assert.match(remoc, /className=\{`remoc-course-card paper-card/u);
  assert.match(recognizedArea, /recognized-metric paper-card/u);
  assert.match(recognizedArea, /className="recognized-tools-panel paper-card"/u);
  assert.doesNotMatch(recognizedArea, /className="(?:recognized-transfer-row|recognized-filters) paper-card"/u);
  assert.doesNotMatch(`${boardCss}\n${recognizedCss}\n${spotlightCss}`, /box-shadow:\s*0\s+\d+px\s+\d+px\s+rgba/u);
  assert.doesNotMatch(`${boardCss}\n${recognizedCss}\n${spotlightCss}`, /(?:background|color):\s*(?:#[0-9a-f]{3,8}|white)\b/iu);
  assert.doesNotMatch(legacyCss, /\.raw-draft-preference\s*>\s*label\s*\{[^}]*(?:linear-gradient|translateY)/su);
  assert.deepEqual(
    [...layout.matchAll(/^import "([^"]+\.css)";$/gmu)].map((match) => match[1]),
    ["./site.css"],
  );
  for (const stylesheet of ["analytics-map", "board-prep", "recognized-courses", "practice-tools", "spotlight"]) {
    assert.match(siteCss, new RegExp(`@import "\\./${stylesheet}\\.css" layer\\(legacy\\);`, "u"));
  }
  assert.doesNotMatch(siteCss, /@import "\.\/globals\.css"/u);
  assert.match(
    siteCss,
    /^@layer a11y, vendor, legacy, site-tokens, site-base, site-components, site-layout, site-features, site-utilities;/mu,
  );
  assert.match(siteCss, /Unified site visual system/u);
  assert.match(siteCss, /only runtime stylesheet entry and the only place where visual[\s\S]*tokens or component appearance may be changed/u);
  assert.doesNotMatch(`${layout}\n${siteCss}`, /(?:museum|instrument|redesign|override|v\d+)\.css/iu);
  assert.match(siteCss, /:root\s*\{[\s\S]*?--site-canvas:\s*#f1ede4;[\s\S]*?--site-paper:\s*#fbf8f1;[\s\S]*?--site-primary:\s*#792f32;[\s\S]*?--site-success:\s*#839483;/u);
  assert.match(siteCss, /html\[data-theme="dark"\]\s*\{[\s\S]*?--site-canvas:\s*#121714;[\s\S]*?--site-paper:\s*#1b221e;[\s\S]*?--site-primary:\s*#e19a9f;/u);
  assert.match(siteCss, /html\[data-theme-mode="black"\]\s*\{[\s\S]*?--site-canvas:\s*#000000;[\s\S]*?--site-paper:\s*#050505;[\s\S]*?--site-primary:\s*#e7a0a5;/u);
  assert.doesNotMatch(siteCss, /!important/u);
});

test("REMOC uses one unified filter bar and leaves its visual state to site.css", () => {
  assert.match(remoc, /className="remoc-filter-bar"/u);
  assert.match(remoc, /className="field-shell remoc-filter-search"/u);
  assert.match(remoc, /className="remoc-filter-strip" aria-label="課程篩選"/u);
  assert.match(remoc, /className="remoc-filter-group" role="group" aria-label="課程類別"/u);
  assert.match(remoc, /className="remoc-filter-divider" aria-hidden="true"/u);
  assert.match(remoc, /className="remoc-filter-group remoc-filter-status" role="group" aria-label="課程狀態"/u);
  assert.match(remoc, /className="text-action remoc-filter-clear"/u);
  assert.match(remoc, /<output aria-live="polite">\{visibleCourses\.length\} 場<\/output>/u);
  assert.match(boardCss, /\.remoc-filter-bar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/su);
  assert.match(boardCss, /\.remoc-filter-strip\s*\{[^}]*overflow-x:\s*auto;/su);
  assert.match(siteCss, /\.remoc-filter-group\s*>\s*button\[aria-pressed="true"\]\s*\{[^}]*background:\s*color-mix\([^}]*var\(--site-success-soft\)[^}]*border-color:\s*var\(--site-success\);[^}]*color:\s*var\(--site-primary\);/su);
  assert.match(siteCss, /\.remoc-filter-group\s*>\s*\.quiet-button\s*\{[^}]*flex:\s*0 0 auto;[^}]*max-width:\s*none;[^}]*min-width:\s*max-content;[^}]*width:\s*auto;/su);
  assert.doesNotMatch(legacyCss, /^\s*\.primary-button,\s*\.quiet-button\s*\{\s*width:\s*100%;\s*\}/mu);
  assert.match(legacyCss, /\.hero-actions\s*>\s*:is\(\.primary-button,\s*\.quiet-button\)\s*\{\s*width:\s*100%;\s*\}/u);
});

test("handoff keeps official links dynamic and cross-year safe", () => {
  assert.match(handoff, /官方連結、新聞與公告應盡量由官方列表／索引頁動態解析/u);
  assert.match(handoff, /不得把目前年度的 detail URL 或檔名當成永久入口/u);
  assert.match(handoff, /畫面年度文字必須來自同一筆來源/u);
  assert.match(handoff, /不得只比對一條完整標題/u);
  assert.match(handoff, /有人開啟網站且快取到期時應自動刷新官方索引/u);
  assert.match(handoff, /不得要求每年人工改碼或替換 URL/u);
  assert.match(handoff, /來源失敗與跨年度測試/u);
});

test("forms reuse the shared input primitive instead of restyling fields per page", () => {
  assert.match(siteCss, /\.field-control,\s*\.field-shell\s*\{[^}]*background:\s*var\(--site-surface-input\);[^}]*border:\s*1px solid var\(--site-line\);[^}]*border-radius:\s*var\(--site-radius\);/su);
  assert.ok((boardView.match(/className="field-control"/gu) ?? []).length >= 5);
  assert.ok((recognizedArea.match(/className="field-control"/gu) ?? []).length >= 7);
  assert.match(practice, /<textarea\s+className="field-control"/u);
  assert.match(learningData, /<select className="field-control"/u);
  assert.match(remoc, /<label className="field-shell remoc-filter-search">/u);

  assert.doesNotMatch(boardCss, /\.board-prep-rule-picker select,\s*\.board-prep-rule-picker input\s*\{[^}]*(?:background|border(?:-[\w-]+)?|border-radius|color)\s*:/su);
  assert.doesNotMatch(boardCss, /\.remoc-filter-search\s*\{[^}]*(?:background|border(?:-[\w-]+)?|border-radius|box-shadow|color)\s*:/su);
  assert.doesNotMatch(recognizedCss, /\.(?:checklist-evidence-fields|recognized-filters|recognized-evidence form|recognized-dialog-card)[^,{]*(?:input|textarea|select)[^,{]*\{[^}]*(?:background|border(?:-[\w-]+)?|border-radius|box-shadow|color)\s*:/su);
  assert.doesNotMatch(practiceCss, /\.practice-scratchpad-editor textarea\s*\{[^}]*(?:background|border(?:-[\w-]+)?|border-radius|box-shadow|color)\s*:/su);
});

test("dense study lists use editorial rows and compound searches expose one frame", () => {
  const allCss = `${legacyCss}\n${boardCss}\n${recognizedCss}\n${spotlightCss}\n${siteCss}`;

  assert.match(siteCss, /Compound search controls expose one surface/u);
  assert.match(
    siteCss,
    /:is\([\s\S]*?\.main-search,[\s\S]*?\.guide-search,[\s\S]*?\.remoc-filter-search,[\s\S]*?\.spotlight-search-header[\s\S]*?\) input\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/u,
  );
  assert.match(siteCss, /Dense study collections read as one editorial ledger/u);
  assert.match(
    siteCss,
    /:is\(\.question-results, \.review-list, \.notebook-list\)\s*\{[^}]*border-bottom:\s*1px solid var\(--site-line\);[^}]*border-top:\s*1px solid var\(--site-line\);[^}]*gap:\s*0;/u,
  );
  assert.match(
    siteCss,
    /:is\(\.question-result-card, \.review-card, \.notebook-card\)\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--site-line\);[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/u,
  );
  assert.match(siteCss, /\.guide-chapter-list > button\.active\s*\{[^}]*border-left:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/u);
  assert.match(siteCss, /Practice choices and empty states follow the same editorial rhythm/u);
  assert.match(
    siteCss,
    /\.practice-setup-page > \.daily-plan-board::before,[\s\S]*?\.practice-quick-grid > \.practice-quick-card::before\s*\{\s*content:\s*none;/u,
  );
  assert.match(
    siteCss,
    /\.practice-quick-grid > \.practice-quick-card\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;[^}]*transform:\s*none;/u,
  );
  assert.match(
    siteCss,
    /:is\(\.empty-state, \.empty-state\.paper-card\)\s*\{[^}]*border-bottom:\s*1px solid var\(--site-line\);[^}]*border-radius:\s*0;[^}]*border-top:\s*1px solid var\(--site-line\);[^}]*box-shadow:\s*none;/u,
  );
  assert.match(
    siteCss,
    /\.guide-read-state select\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/u,
  );
  assert.match(
    siteCss,
    /\.board-prep-workspace-tabs > button::before,[\s\S]*?\.board-prep-upcoming-selector \.reading-variant-selector__option::after\s*\{\s*content:\s*none;/u,
  );
  assert.match(siteCss, /\.question-sheet::before,[\s\S]*?\.board-trace-node[^\{]+::before\s*\{\s*content:\s*none;/u);
  assert.doesNotMatch(allCss, /border-(?:left|right):\s*[2-9]px\s+solid/u);
  assert.doesNotMatch(allCss, /box-shadow:\s*[^;{}]*inset\s+[2-9]px\s+0/u);
  assert.match(handoff, /禁止單側彩色邊線或單側 inset shadow/u);
  assert.match(handoff, /複合搜尋欄只能有一個可見外框/u);
  assert.match(handoff, /空白、載入與錯誤狀態應延續頁面的編輯式框架/u);
});
