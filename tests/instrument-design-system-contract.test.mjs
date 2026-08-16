import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appDirectory = fileURLToPath(new URL("../app/", import.meta.url));

async function collectSources(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSources(path, extensions);
      if (!entry.isFile() || !extensions.some((extension) => entry.name.endsWith(extension))) return [];
      return [{ path, source: await readFile(path, "utf8") }];
    }),
  );
  return sources.flat();
}

function ruleFor(source, selector) {
  const match = source.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`, "su"));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[0];
}

const [site, layout, app, dashboard, spotlight, motion, theme, themeToggle, cssSources, moduleSources] = await Promise.all([
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/dashboard-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/global-spotlight.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/motion.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/theme.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/theme-toggle.tsx", import.meta.url), "utf8"),
  collectSources(appDirectory, [".css"]),
  collectSources(appDirectory, [".ts", ".tsx"]),
]);

test("site.css is the only runtime stylesheet entry and owns the final cascade", () => {
  const moduleCssImports = moduleSources.flatMap(({ path, source }) => (
    [...source.matchAll(/^\s*import\s+(?:[^"'\n]+?\s+from\s+)?["']([^"']+\.css)["'];?/gmu)]
      .map((match) => `${relative(appDirectory, path)}:${match[1]}`)
  ));
  assert.deepEqual(moduleCssImports, ["layout.tsx:./site.css"]);

  const legacyCssFiles = cssSources
    .map(({ path }) => basename(path))
    .filter((name) => !["site.css", "katex-woff2.css"].includes(name))
    .sort();
  const legacyImports = [...site.matchAll(/^@import\s+"\.\/([^"]+\.css)"\s+layer\(legacy\);$/gmu)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(legacyImports, legacyCssFiles);
  assert.match(site, /^@import "\.\/katex-woff2\.css" layer\(vendor\);$/mu);
  assert.match(
    site,
    /^@layer a11y, vendor, legacy, site-tokens, site-base, site-components, site-layout, site-features, site-utilities;$/mu,
  );
  assert.match(site, /This is the only runtime stylesheet entry/u);
  for (const layer of ["tokens", "base", "components", "layout", "features", "utilities"]) {
    assert.match(site, new RegExp(`@layer site-${layer}\\s*\\{`, "u"));
  }
  assert.doesNotMatch(site, /@import\s+"\.\/(?!katex-woff2\.css")[^"]+\.css"(?!\s+layer\(legacy\))/u);
  assert.doesNotMatch(site, /!important/u);
  assert.doesNotMatch(layout, /instrument\.css|museum\.css/u);
});

test("v50 light, dark, and OLED-black modes keep their fixed semantic palettes", () => {
  const light = ruleFor(site, ":root");
  const dark = ruleFor(site, 'html\\[data-theme="dark"\\]');
  const black = ruleFor(site, 'html\\[data-theme-mode="black"\\]');

  for (const [token, value] of [
    ["canvas", "#f1ede4"],
    ["paper", "#fbf8f1"],
    ["paper-soft", "#e8e1d4"],
    ["ink", "#28312d"],
    ["muted", "#6f746c"],
    ["success", "#839483"],
    ["primary", "#792f32"],
    ["primary-fill", "#792f32"],
  ]) {
    assert.match(light, new RegExp(`--site-${token}:\\s*${value};`, "u"));
  }

  for (const [token, value] of [
    ["canvas", "#121714"],
    ["paper", "#1b221e"],
    ["paper-soft", "#111713"],
    ["ink", "#edf2ed"],
    ["success", "#9db3a0"],
    ["primary", "#e19a9f"],
    ["primary-fill", "#913d45"],
  ]) {
    assert.match(dark, new RegExp(`--site-${token}:\\s*${value};`, "u"));
  }

  for (const [token, value] of [
    ["canvas", "#000000"],
    ["paper", "#050505"],
    ["ink", "#f4f4f4"],
    ["success", "#a5b7a8"],
    ["primary", "#e7a0a5"],
    ["primary-fill", "#963f47"],
  ]) {
    assert.match(black, new RegExp(`--site-${token}:\\s*${value};`, "u"));
  }

  assert.match(theme, /export type ThemeMode = "light" \| "dark" \| "black"/u);
  assert.match(theme, /savedTheme === "light" \|\| savedTheme === "dark" \|\| savedTheme === "black"/u);
  assert.match(theme, /mode === "black" \? "#000000" : "#121714"/u);
  assert.match(themeToggle, /\{ value: "light", label: "淺色"/u);
  assert.match(themeToggle, /\{ value: "dark", label: "深色"/u);
  assert.match(themeToggle, /\{ value: "black", label: "純黑"/u);
  assert.doesNotMatch(site, /data-theme-mode="instrument"|--instrument-/u);
});

test("the dashboard progress value is centered as a baseline-aligned grid row", () => {
  const overlay = ruleFor(site, "\\.instrument-progress-ring > span");
  const number = ruleFor(site, "\\.instrument-progress-ring strong");
  const goal = ruleFor(site, "\\.instrument-progress-ring small");

  assert.match(overlay, /display:\s*grid;/u);
  assert.match(overlay, /grid-auto-flow:\s*column;/u);
  assert.match(overlay, /grid-template-columns:\s*max-content max-content;/u);
  assert.match(overlay, /align-content:\s*center;/u);
  assert.match(overlay, /align-items:\s*baseline;/u);
  assert.match(overlay, /justify-content:\s*center;/u);
  assert.doesNotMatch(overlay, /display:\s*flex;/u);
  assert.match(number, /line-height:\s*1;/u);
  assert.match(goal, /line-height:\s*1;/u);
  assert.match(dashboard, /<span><strong>\{progressValue\}<\/strong><small>\/ \{goal\}<\/small><\/span>/u);
});

test("global overflow containment protects narrow viewports while content scrollers remain local", () => {
  const simpleRules = [...site.matchAll(/([^{}]+)\{([^{}]*)\}/gsu)]
    .map((match) => ({ selectors: match[1], declarations: match[2] }));
  const hasGuard = (element) => simpleRules.some(({ selectors, declarations }) => (
    selectors
      .split(",")
      .map((selector) => selector.trim())
      .some((selector) => selector === element || selector === `:where(${element})`)
    && /overflow-x:\s*(?:clip|hidden);/u.test(declarations)
  ));

  assert.ok(hasGuard("html"), "html must prevent document-level horizontal overflow");
  assert.ok(hasGuard("body"), "body must prevent document-level horizontal overflow");
  assert.match(
    site,
    /:where\(\.table-scroll, \.katex-display, pre\)\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;/su,
  );
  assert.match(site, /:where\(img, picture, video, canvas, iframe\)\s*\{[^}]*max-inline-size:\s*100%;/su);
  assert.match(site, /:where\(main, section, article, aside, nav, header, footer\)\s*\{[^}]*min-inline-size:\s*0;/su);
});

test("semantic z-index tokens preserve the shared overlay hierarchy", () => {
  const root = ruleFor(site, ":root");
  const zIndexTokens = new Map([
    ["header", 80],
    ["bottom-nav", 90],
    ["floating", 95],
    ["overlay", 100],
    ["overlay-panel", 101],
    ["theme-menu", 110],
    ["spotlight", 160],
    ["spotlight-panel", 161],
  ]);

  for (const [token, value] of zIndexTokens) {
    assert.match(root, new RegExp(`--site-z-${token}:\\s*${value};`, "u"));
  }
  assert.ok(zIndexTokens.get("overlay-panel") > zIndexTokens.get("overlay"));
  assert.ok(zIndexTokens.get("spotlight-panel") > zIndexTokens.get("spotlight"));
  assert.match(site, /\.topbar\s*\{[^}]*z-index:\s*var\(--site-z-header\);/su);
  assert.match(site, /\.mobile-bottom-nav\s*\{[^}]*z-index:\s*var\(--site-z-bottom-nav\);/su);
  assert.match(site, /\.drawer-backdrop,[\s\S]*?z-index:\s*var\(--site-z-overlay\);/u);
  assert.match(site, /\.mobile-drawer,[\s\S]*?z-index:\s*var\(--site-z-overlay-panel\);/u);
  assert.match(site, /\.theme-menu\s*\{[^}]*z-index:\s*var\(--site-z-theme-menu\);/su);
  assert.match(site, /\.spotlight-overlay\s*\{[^}]*z-index:\s*var\(--site-z-spotlight\);/su);
  assert.match(site, /\.spotlight-dialog\s*\{[^}]*z-index:\s*var\(--site-z-spotlight-panel\);/su);
});

test("responsive contract covers 4K, 840px navigation, 600px mobile UI, and 380px player reflow", () => {
  const maxWidthBreakpoints = [...site.matchAll(/@media \(max-width:\s*(\d+)px\)/gu)]
    .map((match) => Number(match[1]));

  assert.deepEqual([...new Set(maxWidthBreakpoints)].sort((left, right) => right - left), [1440, 1140, 840, 600, 380]);
  assert.match(site, /@media \(min-width: 2200px\)/u);
  assert.match(site, /--site-wide-max:\s*2160px;/u);
  assert.match(site, /@media \(max-width: 840px\)[\s\S]*?--site-header-height:\s*68px;/u);
  assert.match(
    site,
    /@media \(max-width: 600px\)[\s\S]*?--site-bottom-nav-height:\s*calc\(66px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?--site-header-height:\s*64px;/u,
  );
  assert.match(
    site,
    /@media \(max-width: 380px\)[\s\S]*?\.audio-player-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/u,
  );
  assert.match(site, /env\(safe-area-inset-top\)/u);
  assert.match(site, /env\(safe-area-inset-bottom\)/u);
  assert.match(layout, /width: "device-width"/u);
  assert.match(layout, /viewportFit: "cover"/u);
});

test("final utilities retain native hidden semantics and reduced motion", () => {
  const utilitiesStart = site.indexOf("@layer site-utilities");
  const hiddenRule = site.indexOf('.site-shell [hidden]:not([hidden="until-found"])');
  assert.notEqual(utilitiesStart, -1);
  assert.ok(hiddenRule > utilitiesStart);
  assert.match(site, /\.site-shell \[hidden\]:not\(\[hidden="until-found"\]\)\s*\{\s*display:\s*none;\s*\}/u);
  assert.match(site, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(motion, /prefers-reduced-motion: reduce/u);
  assert.match(motion, /return window\.matchMedia[\s\S]*\? "auto" : "smooth"/u);
});

test("navigation and global search keep their accessible overlay topology", () => {
  assert.match(app, /className="skip-link" href="#site-main"/u);
  assert.match(app, /id="site-main" className="route-stage" tabIndex=\{-1\}/u);
  assert.match(app, /className="icon-button site-menu-trigger"[^>]*aria-label="開啟功能總覽"[^>]*aria-haspopup="dialog"/u);
  assert.match(app, /className=\{`mobile-drawer site-drawer drawer-panel \$\{menuDragging \? "is-swipe-dragging" : ""\}`\.trim\(\)\}[\s\S]*?role="dialog"/u);
  assert.match(app, /onPointerDown=\{handleMenuPointerDown\}/u);
  assert.match(app, /onPointerMove=\{handleMenuPointerMove\}/u);
  assert.match(app, /Math\.abs\(deltaX\) > Math\.abs\(deltaY\) \* 1\.15/u);
  assert.match(app, /setMenuDragX\(Math\.max\(0, deltaX\)\)/u, "the right-anchored drawer must only follow a rightward close gesture");
  assert.match(app, /deltaX >= threshold[\s\S]*?deltaX >= 30 && velocity >= \.45/u);
  assert.match(app, /function handleMenuLostPointerCapture[\s\S]*?event\.target !== event\.currentTarget[\s\S]*?handleMenuPointerCancel/u, "implicit capture changes from child controls must not abort the drawer gesture");
  assert.match(app, /\{menuOpen && <div className="drawer-backdrop" onClick=\{\(\) => setMenuOpen\(false\)\}/u);
  assert.match(site, /\.site-drawer\s*\{[^}]*touch-action: pan-y;[^}]*transform: translate3d\(var\(--site-drawer-drag-x, 0px\), 0, 0\);/u);
  assert.match(app, /<nav className="mobile-bottom-nav"/u);
  assert.match(spotlight, /className="quiet-button spotlight-trigger"[\s\S]*?aria-label=\{triggerLabel\}/u);
  assert.match(spotlight, /createPortal/u);
  assert.match(spotlight, /\), document\.body\)\}/u);
});

test("route transitions animate content without crossfading persistent mobile chrome", () => {
  assert.match(site, /\.route-stage\s*\{[^}]*view-transition-name: route-stage;/su);
  assert.match(site, /\.topbar\s*\{\s*view-transition-name: site-topbar;/u);
  assert.match(site, /\.mobile-bottom-nav\s*\{\s*view-transition-name: site-bottom-nav;/u);
  assert.match(site, /::view-transition-group\(root\),[\s\S]*?::view-transition-new\(site-bottom-nav\)\s*\{\s*animation: none;/u);
  assert.match(site, /::view-transition-old\(route-stage\)\s*\{[^}]*animation: site-route-leave 110ms/u);
  assert.match(site, /::view-transition-new\(route-stage\)\s*\{[^}]*animation: site-route-enter 140ms/u);
});
