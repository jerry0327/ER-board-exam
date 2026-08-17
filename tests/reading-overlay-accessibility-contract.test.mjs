import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const [focusHook, catalogLayer, reader, guide, rosens, ails, supplemental, boardTextbook, ems, guideReaderTools, css, siteCss, handoff] = await Promise.all([
  readFile(new URL("../app/hooks/use-overlay-focus-management.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/reading-catalog-layer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ails-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/board-textbook-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ems-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8"),
  readLegacyCss(),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
]);

function cssRuleContaining(source, selector, startAt = 0) {
  const selectorIndex = source.indexOf(selector, startAt);
  assert.notEqual(selectorIndex, -1, `missing CSS selector ${selector}`);
  const openingBrace = source.indexOf("{", selectorIndex);
  const closingBrace = source.indexOf("}", openingBrace);
  assert.notEqual(openingBrace, -1, `missing opening brace for ${selector}`);
  assert.notEqual(closingBrace, -1, `missing closing brace for ${selector}`);
  return source.slice(source.lastIndexOf("}", selectorIndex) + 1, closingBrace + 1);
}

function cssRuleMatching(source, selector, declarations) {
  let startAt = 0;
  while (startAt < source.length) {
    const selectorIndex = source.indexOf(selector, startAt);
    if (selectorIndex === -1) break;
    const openingBrace = source.indexOf("{", selectorIndex);
    const closingBrace = source.indexOf("}", openingBrace);
    if (openingBrace === -1 || closingBrace === -1) break;
    const rule = source.slice(source.lastIndexOf("}", selectorIndex) + 1, closingBrace + 1);
    if (declarations.every((pattern) => pattern.test(rule))) return rule;
    startAt = closingBrace + 1;
  }
  assert.fail(`missing CSS rule for ${selector} with required declarations`);
}

test("long-form readers share one complete overlay focus lifecycle", () => {
  assert.match(focusHook, /export function useOverlayFocusManagement/u);
  assert.match(focusHook, /event\.key === "Escape"/u);
  assert.match(focusHook, /event\.key !== "Tab"/u);
  assert.match(focusHook, /document\.activeElement === first/u);
  assert.match(focusHook, /document\.activeElement === last/u);
  assert.match(focusHook, /window\.matchMedia\(dismissWhenMediaQueryStopsMatching\)/u);
  assert.match(focusHook, /const fallbackTrigger = triggerRef\?\.current \?\? null/u);
  assert.match(focusHook, /const restoreTarget = activeElement \?\? fallbackTrigger/u);
  assert.match(focusHook, /const visibleRestoreTarget = restoreTarget\?\.isConnected[\s\S]{0,180}fallbackTrigger/u);
  assert.match(focusHook, /visibleRestoreTarget\?\.focus\(\{ preventScroll: true \}\)/u);

  for (const view of [reader, guide, rosens, ails, supplemental, boardTextbook, ems]) {
    assert.match(view, /import \{ useMediaQueryMatch, useOverlayFocusManagement \} from "\.\.\/hooks\/use-overlay-focus-management"/u);
    assert.doesNotMatch(view, /querySelectorAll<HTMLElement>\("button:not\(:disabled\)/u);
  }
  assert.equal((reader.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 4);
  assert.equal((guide.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
  assert.equal((rosens.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
  assert.equal((ails.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
  assert.equal((supplemental.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
  assert.equal((boardTextbook.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
  assert.equal((ems.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
});

test("reader jump and reader/guide article outlines use the shared modal focus lifecycle", () => {
  for (const [view, triggerRef, panelRef, panelId, openState, closeSetter] of [
    [reader, "jumpTriggerRef", "jumpPanelRef", "reader-jump-sheet", "jumpOpen", "setJumpOpen"],
    [reader, "tocTriggerRef", "tocPanelRef", "reader-toc-sheet", "tocOpen", "setTocOpen"],
  ]) {
    assert.match(view, new RegExp(`ref=\\{${triggerRef}\\}[\\s\\S]{0,260}aria-controls="${panelId}"[\\s\\S]{0,120}aria-expanded=\\{${openState}\\}`, "u"));
    assert.match(view, new RegExp(`ref=\\{${panelRef}\\}[\\s\\S]{0,120}id="${panelId}"[\\s\\S]{0,120}tabIndex=\\{-1\\}[\\s\\S]{0,180}role="dialog"[\\s\\S]{0,100}aria-modal="true"`, "u"));
    assert.match(view, new RegExp(`open: ${openState},[\\s\\S]{0,120}panelRef: ${panelRef},[\\s\\S]{0,120}triggerRef: ${triggerRef},[\\s\\S]{0,120}${closeSetter}\\(false\\)[\\s\\S]{0,120}initialFocusSelector: "\\[data-overlay-close\\]"`, "u"));
  }
  for (const [view, panelId] of [[guide, "guide-toc-sheet"], [rosens, "rosens-guide-toc"]]) {
    assert.match(view, new RegExp(`outlineTriggerRef=\\{outlineTriggerRef\\}[\\s\\S]{0,180}outlineControlsId="${panelId}"[\\s\\S]{0,120}outlineOpen=\\{outlineOpen\\}`, "u"));
    assert.match(view, new RegExp(`ref=\\{outlinePanelRef\\}[\\s\\S]{0,120}id="${panelId}"[\\s\\S]{0,120}tabIndex=\\{-1\\}[\\s\\S]{0,180}role="dialog"[\\s\\S]{0,100}aria-modal="true"`, "u"));
    assert.match(view, /open: outlineOpen,[\s\S]{0,120}panelRef: outlinePanelRef,[\s\S]{0,120}triggerRef: outlineTriggerRef,[\s\S]{0,120}setOutlineOpen\(false\)[\s\S]{0,180}dismissWhenMediaQueryStopsMatching: "\(max-width: 1440px\)"[\s\S]{0,120}initialFocusSelector: "\[data-overlay-close\]"/u);
  }
  assert.match(guideReaderTools, /ref=\{outlineTriggerRef\}[\s\S]{0,220}aria-controls=\{outlineControlsId\}[\s\S]{0,120}aria-expanded=\{outlineOpen\}/u);
  assert.match(reader, /className="reader-rail-jump"[\s\S]{0,220}aria-controls="reader-jump-sheet"[\s\S]{0,120}aria-expanded=\{jumpOpen\}/u);
});

test("Tintinalli and Rosen mobile chapter drawers leave the accessibility tree while closed", () => {
  for (const [view, id] of [[guide, "tintinalli-guide-library"], [rosens, "rosens-guide-library"]]) {
    assert.match(view, new RegExp(`id="${id}"[\\s\\S]{0,260}ref=\\{libraryRef\\}[\\s\\S]{0,360}aria-hidden=\\{narrow && !libraryOpen\\}`, "u"));
    assert.ok(view.includes("inert={narrow && !libraryOpen ? true : undefined}"));
    assert.match(view, new RegExp(`libraryTriggerRef=\\{libraryTriggerRef\\}[\\s\\S]{0,180}libraryControlsId="${id}"[\\s\\S]{0,120}libraryOpen=\\{libraryOpen\\}`, "u"));
    assert.match(view, /open: narrow && libraryOpen,[\s\S]{0,180}triggerRef: libraryTriggerRef,[\s\S]{0,120}setLibraryOpen\(false\)/u);
  }
  assert.match(guideReaderTools, /ref=\{libraryTriggerRef\}[\s\S]{0,220}aria-controls=\{libraryControlsId\}[\s\S]{0,120}aria-expanded=\{libraryOpen\}/u);
});

test("every Reader and learning-guide catalog drawer uses the shared responsive overlay hook", () => {
  for (const [name, view, openState, closeSetter, backdrop] of [
    ["Reader", reader, "listOpen", "setListOpen", "reader-drawer-backdrop"],
    ["Tintinalli", guide, "libraryOpen", "setLibraryOpen", "guide-drawer-backdrop"],
    ["Rosen", rosens, "libraryOpen", "setLibraryOpen", "guide-drawer-backdrop"],
    ["AILS", ails, "libraryOpen", "setLibraryOpen", "guide-drawer-backdrop"],
    ["supplemental", supplemental, "libraryOpen", "setLibraryOpen", "guide-drawer-backdrop"],
    ["board textbook", boardTextbook, "libraryOpen", "setLibraryOpen", "guide-drawer-backdrop"],
    ["EMS", ems, "libraryOpen", "setLibraryOpen", "guide-drawer-backdrop"],
  ]) {
    assert.match(
      view,
      new RegExp(
        `open: narrow && ${openState},[\\s\\S]{0,120}panelRef: libraryRef,[\\s\\S]{0,120}triggerRef: libraryTriggerRef,[\\s\\S]{0,120}onClose: \\(\\) => ${closeSetter}\\(false\\),[\\s\\S]{0,160}dismissWhenMediaQueryStopsMatching: "\\(max-width: 1140px\\)"`,
        "u",
      ),
      `${name} catalog must use the shared mobile drawer focus lifecycle`,
    );
    assert.match(view, new RegExp(`className="${backdrop}"`, "u"), `${name} catalog must render the shared drawer backdrop`);
  }
});

test("narrow reading catalogs portal above persistent site chrome and keep a full-height scroller", () => {
  assert.match(catalogLayer, /createPortal\(children, document\.body\)/u);
  for (const view of [reader, guide, rosens, ails, supplemental, boardTextbook, ems]) {
    assert.match(view, /import ReadingCatalogLayer from "\.\.\/components\/reading-catalog-layer"/u);
    assert.match(view, /<ReadingCatalogLayer portal=\{narrow\}>/u);
  }
  assert.match(siteCss, /@media \(max-width: 1140px\)[\s\S]*?\.reader-library,\s*\.guide-library \{[^}]*height: 100dvh;[^}]*max-height: 100dvh;[^}]*z-index: var\(--site-z-overlay-panel\);/u);
  assert.match(siteCss, /@media \(max-width: 1140px\)[\s\S]*?\.reader-library \.reader-question-list,\s*\.guide-library \.guide-chapter-list \{[^}]*flex: 1 1 auto;[^}]*height: auto;[^}]*min-height: 0;[^}]*overflow-y: auto;/u);
});

test("Tintinalli and Rosen adaptive reading tools share the same dialog and responsive close behavior", () => {
  for (const [view, panelId] of [[guide, "guide-mobile-tools"], [rosens, "rosens-mobile-tools"]]) {
    assert.match(view, new RegExp(`mobileToolsTriggerRef=\\{mobileToolsTriggerRef\\}[\\s\\S]{0,180}mobileToolsControlsId="${panelId}"[\\s\\S]{0,120}mobileToolsOpen=\\{mobileToolsOpen\\}`, "u"));
    assert.match(view, new RegExp(`<GuideReaderToolsPanel[\\s\\S]{0,180}panelRef=\\{mobileToolsRef\\}[\\s\\S]{0,120}id="${panelId}"[\\s\\S]{0,120}open=\\{compactTools && mobileToolsOpen\\}[\\s\\S]{0,120}hidden=\\{compactTools && !mobileToolsOpen\\}`, "u"));
    assert.match(view, /open: compactTools && mobileToolsOpen,[\s\S]{0,180}triggerRef: mobileToolsTriggerRef,[\s\S]{0,220}dismissWhenMediaQueryStopsMatching: "\(max-width: 1440px\)"/u);
  }
  assert.match(guideReaderTools, /ref=\{mobileToolsTriggerRef\}[\s\S]{0,220}aria-expanded=\{mobileToolsOpen\}[\s\S]{0,120}aria-controls=\{mobileToolsControlsId\}/u);
  assert.match(guideReaderTools, /aria-hidden=\{hidden \|\| undefined\}[\s\S]{0,120}inert=\{hidden \? true : undefined\}[\s\S]{0,120}role=\{open \? "dialog" : undefined\}[\s\S]{0,120}aria-modal=\{open \? true : undefined\}/u);
  assert.match(css, /\.mobile-reading-tools-close \{[^}]*grid-column: 3;[^}]*height: 40px;[^}]*width: 40px;/u);
});

test("mobile reading-tool sheets let their scrim receive dismissal taps without blocking the sheet", () => {
  for (const [name, view, condition] of [
    ["Reader", reader, "mobileToolsOpen && question"],
    ["Tintinalli", guide, "mobileToolsOpen"],
    ["Rosen", rosens, "mobileToolsOpen"],
    ["AILS", ails, "mobileToolsOpen"],
    ["supplemental", supplemental, "mobileToolsOpen"],
  ]) {
    assert.match(
      view,
      new RegExp(`\\{${condition} && <button className="mobile-reading-tools-backdrop"[\\s\\S]{0,160}aria-label="關閉閱讀工具"[\\s\\S]{0,120}onClick=\\{\\(\\) => setMobileToolsOpen\\(false\\)\\}`, "u"),
      `${name} mobile reading-tool scrim must close on a direct tap`,
    );
  }

  const outerRule = cssRuleMatching(siteCss, ".reader-utility-panel.mobile-open", [
    /\.guide-utility-panel\.mobile-open/u,
    /pointer-events:\s*none;/u,
    /position:\s*fixed;/u,
  ]);
  assert.ok(outerRule.includes(".guide-utility-panel.mobile-open"));
  assert.match(outerRule, /pointer-events:\s*none;/u);

  const innerRule = cssRuleMatching(siteCss, ".reader-utility-inner", [
    /\.guide-utility-inner/u,
    /pointer-events:\s*auto;/u,
  ]);
  assert.ok(innerRule.includes(".guide-utility-inner"));
  assert.match(innerRule, /pointer-events:\s*auto;/u);

  const adaptiveBreakpoint = siteCss.indexOf("@media (max-width: 1440px)");
  assert.notEqual(adaptiveBreakpoint, -1);
  const scrimRule = cssRuleContaining(siteCss, ".mobile-reading-tools-backdrop", adaptiveBreakpoint);
  assert.match(scrimRule, /position:\s*fixed;/u);
  assert.match(scrimRule, /z-index:\s*var\(--site-z-overlay\);/u);
  assert.doesNotMatch(scrimRule, /pointer-events:\s*none;/u);
});

test("reader, guide, and mobile panels always stack above their backdrops", () => {
  for (const [token, value] of [
    ["site-z-overlay", 100],
    ["site-z-overlay-panel", 101],
    ["site-z-spotlight", 160],
    ["site-z-spotlight-panel", 161],
  ]) {
    assert.match(siteCss, new RegExp(`--${token}: ${value};`, "u"));
  }

  const backdropRule = cssRuleContaining(siteCss, ".reader-drawer-backdrop");
  for (const selector of [
    ".drawer-backdrop",
    ".reader-modal-backdrop",
    ".reader-drawer-backdrop",
    ".guide-drawer-backdrop",
    ".mobile-reading-tools-backdrop",
    ".practice-dialog-backdrop",
    ".learning-data-backdrop",
    ".annotation-panel-backdrop",
  ]) {
    assert.ok(backdropRule.includes(selector), `${selector} must share the overlay backdrop rule`);
  }
  assert.match(backdropRule, /z-index:\s*var\(--site-z-overlay\);/u);
  assert.doesNotMatch(backdropRule, /\.spotlight-overlay/u);

  assert.match(
    siteCss,
    /@media \(max-width: 600px\)[\s\S]*?\.reader-utility-panel\.mobile-open,\s*\.guide-utility-panel\.mobile-open \{[^}]*bottom: 0;[^}]*height: 100dvh;[^}]*left: 0;[^}]*max-height: 100dvh;[^}]*right: 0;[^}]*top: 0;[^}]*z-index: var\(--site-z-overlay-panel\);/u,
    "mobile reading tools need a full-viewport containing block so their bottom sheet cannot render off-screen",
  );

  const openPanelRule = cssRuleContaining(siteCss, ".reader-library.open");
  for (const selector of [
    ".mobile-drawer",
    ".reader-library.open",
    ".guide-library.open",
    ".reader-toc-sheet",
    ".guide-toc-sheet",
    ".reader-jump-sheet",
    ".learning-data-dialog",
    ".annotation-panel",
    ".practice-decision-dialog",
  ]) {
    assert.ok(openPanelRule.includes(selector), `${selector} must share the overlay panel rule`);
  }
  assert.match(openPanelRule, /z-index:\s*var\(--site-z-overlay-panel\);/u);

  assert.match(siteCss, /@media \(max-width: 1140px\)[\s\S]*?\.reader-library,\s*\.guide-library \{[^}]*z-index:\s*var\(--site-z-overlay-panel\);/u);
  assert.match(siteCss, /@media \(max-width: 1140px\)[\s\S]*?\.reader-drawer-backdrop,\s*\.guide-drawer-backdrop \{[^}]*z-index:\s*var\(--site-z-overlay\);/u);
  assert.doesNotMatch(siteCss, /@media \(max-width: 1140px\)[\s\S]*?z-index:\s*(?:65|70);/u);

  const mobilePanelRule = cssRuleMatching(siteCss, ".reader-utility-panel.mobile-open", [
    /\.guide-utility-panel\.mobile-open/u,
    /position:\s*fixed;/u,
    /z-index:\s*var\(--site-z-overlay-panel\);/u,
  ]);
  assert.ok(mobilePanelRule.includes(".guide-utility-panel.mobile-open"));
  assert.match(mobilePanelRule, /position:\s*fixed;/u);
  assert.match(mobilePanelRule, /z-index:\s*var\(--site-z-overlay-panel\);/u);

  assert.match(cssRuleContaining(siteCss, ".spotlight-overlay"), /z-index:\s*var\(--site-z-spotlight\);/u);
  assert.match(cssRuleContaining(siteCss, ".spotlight-dialog"), /z-index:\s*var\(--site-z-spotlight-panel\);/u);
});

test("the shared note drawer locks page scrolling through the existing overlay selector", () => {
  assert.match(css, /html:has\([^)]*\.reader-modal-backdrop[^)]*\.annotation-panel-backdrop[^)]*\)\s*\{\s*overflow:\s*hidden;/u);
});

test("handoff keeps the shared overlay accessibility rule durable", () => {
  assert.match(handoff, /手機 drawer／sheet 關閉時必須 `inert` 且 `aria-hidden`/u);
  assert.match(handoff, /關閉時必須 `inert` 且 `aria-hidden`/u);
  assert.match(handoff, /`aria-haspopup`、`aria-controls`、`aria-expanded`/u);
  assert.match(handoff, /Escape 關閉並將焦點還給 trigger/u);
});
