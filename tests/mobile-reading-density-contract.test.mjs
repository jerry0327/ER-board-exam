import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [siteCss, reader, questionSheet, guideTools, ...guideViews] = await Promise.all([
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/question-sheet.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ails-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8"),
]);

const mobileStart = siteCss.indexOf("@media (max-width: 600px)");
assert.notEqual(mobileStart, -1, "site.css must retain the shared 600px mobile breakpoint");
const mobileEnd = siteCss.indexOf("@media (prefers-reduced-motion: reduce)", mobileStart);
const mobile = siteCss.slice(mobileStart, mobileEnd);

test("question explanations and every learning guide use the same toolbar anatomy", () => {
  assert.match(reader, /className="reader-toolbar reading-toolbar"/u);
  assert.match(reader, /className="reader-list-trigger reading-toolbar-library"/u);
  assert.match(reader, /className="reader-paper-jump-trigger reading-toolbar-position"/u);
  assert.match(reader, /className="reader-step-controls reading-toolbar-steps"/u);
  assert.match(reader, /className="reader-toc-trigger reading-toolbar-outline"/u);
  assert.match(reader, /className="font-controls reading-toolbar-font"/u);
  assert.match(reader, /className="reader-mobile-tools-trigger reading-toolbar-tools"/u);

  assert.match(guideTools, /\["guide-toolbar", "reading-toolbar", className\]/u);
  assert.match(guideTools, /className="guide-list-trigger reading-toolbar-library"/u);
  assert.match(guideTools, /className="guide-toolbar-position reading-toolbar-position"/u);
  assert.match(guideTools, /className="guide-toolbar-step-controls reading-toolbar-steps"/u);
  assert.match(guideTools, /className="guide-toc-trigger reading-toolbar-outline"/u);
  assert.match(guideTools, /className="guide-font-controls reading-toolbar-font"/u);
  assert.match(guideTools, /className="guide-mobile-tools-trigger reading-toolbar-tools"/u);

  assert.match(siteCss, /\.reading-toolbar \{[^}]*gap: 7px;[^}]*padding-inline: clamp\(20px, 3vw, 44px\);/u);
  assert.match(mobile, /\.reading-toolbar \{[^}]*gap: 4px;[^}]*min-height: 54px;[^}]*padding-inline: 6px;/u);
  assert.match(mobile, /\.reading-toolbar-steps button \{[^}]*height: 44px;[^}]*width: 40px;/u);
  assert.match(mobile, /\.reading-toolbar \.reading-toolbar-font \{\s*display: none;/u);
});

test("mobile long-form reading spends its width on prose while keeping safe text gutters", () => {
  assert.match(questionSheet, /reader-sheet reading-paper-surface/u);
  for (const guideView of guideViews) assert.match(guideView, /guide-article paper-card reading-paper-surface/u);
  assert.match(
    siteCss,
    /\.reading-paper-surface \{[^}]*--reading-paper-inline: clamp\(28px, 4vw, 48px\);[^}]*border: 1px solid var\(--site-line\);[^}]*border-radius: var\(--site-panel-radius\);[^}]*box-shadow: none;/su,
  );
  assert.match(
    siteCss,
    /\.reader-reading-column > \.reader-gesture-surface,\s*\.reader-reading-column > \.reader-gesture-surface > \.reading-paper-surface \{[^}]*max-width: var\(--site-reading-max\);/su,
  );
  assert.match(siteCss, /\.reader-sheet\.reading-paper-surface::before \{[^}]*display: none;/u);
  assert.match(
    mobile,
    /\.reader-reading-column,\s*\.guide-reading-column \{[^}]*padding:\s*20px\s*0\s*24px;/su,
  );
  assert.match(
    mobile,
    /\.reader-page,\s*\.guide-page,\s*\.rosens-guide-page,\s*\.ails-guide-page,\s*\.supplemental-guide-page \{[^}]*margin:\s*0;/su,
  );
  assert.doesNotMatch(
    mobile,
    /\.(?:reader-reading-column|guide-reading-column|reader-page|guide-page)[^{]*\{[^}]*var\(--site-bottom-nav-height\)/u,
  );
  assert.match(
    mobile,
    /\.reader-page,\s*\.guide-page,\s*\.rosens-guide-page,\s*\.ails-guide-page,\s*\.supplemental-guide-page \{[^}]*border-left: 0;[^}]*border-radius: 0;[^}]*border-right: 0;[^}]*width: 100%;/su,
  );
  assert.match(
    mobile,
    /\.reading-paper-surface \{[^}]*--reading-paper-inline: 16px;[^}]*border-left: 0;[^}]*border-radius: 0;[^}]*border-right: 0;[^}]*box-shadow: none;/su,
  );
  assert.match(mobile, /\.reader-workspace \{[^}]*padding: 0;/u);
  assert.match(mobile, /\.reader-toolbar\.reading-toolbar \{[^}]*margin-inline: 0;/u);
  assert.match(mobile, /\.guide-chapter-header \{[^}]*padding-inline: 16px;/u);
  assert.match(mobile, /\.guide-article \{[^}]*margin-inline: 0;/u);
  assert.doesNotMatch(mobile, /\.(?:reader-reading-column|guide-reading-column)[^{]*\{[^}]*(?:100vw|translateX)/u);
});

test("mobile explanation and guide headings share a compact long-form rhythm", () => {
  assert.match(
    mobile,
    /\.reading-paper-surface \.markdown-body h2 \{[^}]*border-bottom: 0;[^}]*margin: 1\.6em 0 \.8em;[^}]*padding-block: \.68em \.28em;/su,
  );
  assert.match(
    mobile,
    /\.reading-paper-surface \.markdown-body :is\(h1, h2, h3, h4\)\s*\+ :is\(h1, h2, h3, h4\) \{[^}]*margin-top: \.65em;/su,
  );
});

test("mobile guide catalog keeps controls accessible but gives the chapter list most of the viewport", () => {
  assert.match(mobile, /\.guide-library \{[^}]*height: 100dvh;/u);
  assert.match(
    mobile,
    /\.guide-library > header \{[^}]*grid-template-columns: minmax\(0, 1fr\) 44px;[^}]*max\(12px, env\(safe-area-inset-top\)\)/su,
  );
  assert.match(mobile, /\.guide-list-close \{[^}]*height: 44px;[^}]*width: 44px;/u);
  assert.match(
    mobile,
    /\.guide-library > header \.guide-textbook-switcher \{[^}]*min-height: 44px;/u,
  );
  assert.match(mobile, /\.guide-search \{[^}]*min-height: 44px;/u);
  assert.match(
    mobile,
    /\.guide-filters,\s*\.rosens-guide-filters \{[^}]*display: flex;[^}]*overflow-x: auto;/su,
  );
  assert.match(
    mobile,
    /\.guide-filters select,\s*\.guide-filters select:first-child \{[^}]*min-height: 44px;[^}]*min-width: 132px;/su,
  );
  assert.match(
    mobile,
    /\.guide-library \.guide-chapter-list \{[^}]*height: auto;[^}]*min-height: 0;/su,
  );
  assert.match(
    mobile,
    /\.reader-library \.reader-question-list \{[^}]*padding-bottom: calc\(18px \+ env\(safe-area-inset-bottom\)\);[^}]*scroll-padding-bottom: calc\(18px \+ env\(safe-area-inset-bottom\)\);/su,
  );
  assert.match(
    mobile,
    /\.guide-library \.guide-chapter-list \{[^}]*padding-bottom: calc\(20px \+ env\(safe-area-inset-bottom\)\);[^}]*scroll-padding-bottom: calc\(20px \+ env\(safe-area-inset-bottom\)\);/su,
  );
});
