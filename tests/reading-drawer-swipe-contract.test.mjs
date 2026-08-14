import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const viewsDirectory = new URL("../app/views/", import.meta.url);
const [viewNames, swipeHook, app, siteCss] = await Promise.all([
  readdir(viewsDirectory),
  readFile(new URL("../app/hooks/use-horizontal-swipe-dismiss.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
]);

const viewSources = await Promise.all(viewNames
  .filter((name) => name.endsWith(".tsx"))
  .map(async (name) => [name, await readFile(new URL(name, viewsDirectory), "utf8")]));

const catalogDrawerViews = viewSources.filter(([, source]) => (
  source.includes("open drawer-panel")
  && (source.includes("reader-library") || source.includes("guide-library"))
));

test("horizontal drawer dismissal locks its axis and ignores ordinary vertical scrolling", () => {
  assert.match(swipeHook, /event\.pointerType === "mouse"/u);
  assert.match(swipeHook, /target\.closest\("input, textarea, select, \[data-swipe-dismiss-ignore\]"\)/u);
  assert.match(swipeHook, /Math\.abs\(deltaX\) > Math\.abs\(deltaY\) \* 1\.15/u);
  assert.match(swipeHook, /Math\.abs\(deltaY\) > Math\.abs\(deltaX\) \* 1\.15/u);
  assert.match(swipeHook, /gesture\.axis === "vertical"/u);
  assert.match(swipeHook, /direction === "left" \? Math\.min\(0, deltaX\) : Math\.max\(0, deltaX\)/u);
  assert.match(swipeHook, /Math\.min\(96, event\.currentTarget\.clientWidth \* \.25\)/u);
  assert.match(swipeHook, /distance >= threshold \|\| \(distance >= 30 && velocity >= \.45\)/u);
  assert.match(swipeHook, /event\.target !== event\.currentTarget/u);
  assert.match(swipeHook, /event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/u);
  assert.match(swipeHook, /if \(enabled\) swipeTriggeredRef\.current = false/u);
});

test("every left-side Reader and learning catalog can swipe left to close", () => {
  assert.deepEqual(
    catalogDrawerViews.map(([name]) => name).sort(),
    [
      "ails-guide-view.tsx",
      "board-textbook-view.tsx",
      "ems-guide-view.tsx",
      "guide-view.tsx",
      "reader-view.tsx",
      "rosens-guide-view.tsx",
      "supplemental-guide-view.tsx",
    ],
  );

  for (const [name, source] of catalogDrawerViews) {
    const openState = name === "reader-view.tsx" ? "listOpen" : "libraryOpen";
    assert.match(source, /import \{ useHorizontalSwipeDismiss \} from "\.\.\/hooks\/use-horizontal-swipe-dismiss"/u, `${name} must use the shared swipe behavior`);
    assert.match(source, new RegExp(`direction: "left",[\\s\\S]{0,100}enabled: narrow && ${openState}`), `${name} must dismiss toward its left edge`);
    assert.match(source, /className=\{`[^`]*swipe-dismiss-panel[^`]*is-swipe-dragging/u, `${name} must expose drag state to CSS`);
    assert.match(source, /--reading-drawer-drag-x/u, `${name} must paint the live horizontal offset`);
    for (const handler of ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel", "onLostPointerCapture", "onClickCapture"]) {
      assert.match(source, new RegExp(`${handler}=\\{librarySwipe\\.${handler}\\}`, "u"), `${name} must wire ${handler}`);
    }
  }
});

test("the right-side site menu retains its outward right-swipe dismissal", () => {
  assert.match(app, /setMenuDragX\(Math\.max\(0, deltaX\)\)/u);
  assert.match(app, /deltaX >= threshold[\s\S]*?deltaX >= 30 && velocity >= \.45/u);
  assert.match(siteCss, /\.site-drawer\s*\{[^}]*touch-action: pan-y;[^}]*transform: translate3d\(var\(--site-drawer-drag-x, 0px\), 0, 0\);/u);
});

test("catalog drawers follow the finger without taking over filter controls", () => {
  assert.match(
    siteCss,
    /@media \(max-width: 1140px\)[\s\S]*?\.reader-library\.open,\s*\.guide-library\.open \{[^}]*transform: translate3d\(var\(--reading-drawer-drag-x, 0px\), 0, 0\);/u,
  );
  assert.match(
    siteCss,
    /\.reader-library\.is-swipe-dragging,\s*\.guide-library\.is-swipe-dragging \{[^}]*transition: none;[^}]*user-select: none;[^}]*will-change: transform;/u,
  );
  const touchRule = siteCss.match(/\.reader-library-heading,\s*\.reader-library \.reader-question-list,\s*\.guide-library > header,\s*\.guide-library \.guide-chapter-list \{[^}]*touch-action: pan-y;[^}]*\}/u)?.[0] ?? "";
  assert.ok(touchRule, "drawer headings and scrollable catalogs must own horizontal swipe detection");
  assert.doesNotMatch(touchRule, /guide-filters|guide-search|reader-selects|reader-search/u);
  for (const [name, source] of catalogDrawerViews) {
    if (name === "reader-view.tsx") {
      assert.match(source, /className="reader-search" data-swipe-dismiss-ignore=""/u);
      assert.match(source, /className="reader-selects" data-swipe-dismiss-ignore=""/u);
    }
    if (["guide-view.tsx", "rosens-guide-view.tsx", "ails-guide-view.tsx", "ems-guide-view.tsx"].includes(name)) {
      assert.match(source, /className="guide-search" data-swipe-dismiss-ignore=""/u);
    }
    if (["guide-view.tsx", "rosens-guide-view.tsx", "ems-guide-view.tsx"].includes(name)) {
      assert.match(source, /className="guide-filters[^"\n]*" data-swipe-dismiss-ignore=""/u);
    }
  }
});
