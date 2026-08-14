import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../app/lib/theme.ts", import.meta.url), "utf8");
const toggle = await readFile(new URL("../app/components/theme-toggle.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const siteCss = await readFile(new URL("../app/site.css", import.meta.url), "utf8");
const mediaQuery = await readFile(new URL("../app/lib/media-query.ts", import.meta.url), "utf8");

const storageKey = themeSource.match(/THEME_STORAGE_KEY = "([^"]+)"/)?.[1];
const initScript = themeSource.match(/THEME_INIT_SCRIPT = String\.raw`([\s\S]*?)`;/)?.[1]
  ?.replace("${THEME_STORAGE_KEY}", storageKey ?? "");

test("theme is initialized before the page paints", () => {
  assert.equal(storageKey, "emergency-board-theme-v1");
  assert.ok(initScript, "找不到主題初始化程式");
  assert.match(layout, /<html lang="zh-Hant" suppressHydrationWarning>/);
  assert.match(layout, /<meta id="app-theme-color" name="theme-color" content="#f1ede4" \/>/);
  assert.match(layout, /<script id="theme-init" dangerouslySetInnerHTML=\{\{ __html: THEME_INIT_SCRIPT \}\} \/>/);
});

test("saved and legacy preferences resolve to light, dark, or OLED before paint", () => {
  const cases = [
    { saved: "light", systemDark: true, expectedMode: "light", expectedTheme: "light", expectedScheme: "light", expectedColor: "#f1ede4", migrated: null },
    { saved: "dark", systemDark: false, expectedMode: "dark", expectedTheme: "dark", expectedScheme: "dark", expectedColor: "#121714", migrated: null },
    { saved: "black", systemDark: false, expectedMode: "black", expectedTheme: "dark", expectedScheme: "dark", expectedColor: "#000000", migrated: null },
    { saved: "editorial", systemDark: true, expectedMode: "light", expectedTheme: "light", expectedScheme: "light", expectedColor: "#f1ede4", migrated: "light" },
    { saved: "instrument", systemDark: false, expectedMode: "dark", expectedTheme: "dark", expectedScheme: "dark", expectedColor: "#121714", migrated: "dark" },
    { saved: null, systemDark: true, expectedMode: "dark", expectedTheme: "dark", expectedScheme: "dark", expectedColor: "#121714", migrated: null },
    { saved: null, systemDark: false, expectedMode: "light", expectedTheme: "light", expectedScheme: "light", expectedColor: "#f1ede4", migrated: null },
    { saved: "invalid", systemDark: true, expectedMode: "dark", expectedTheme: "dark", expectedScheme: "dark", expectedColor: "#121714", migrated: null },
  ];

  for (const scenario of cases) {
    const root = { dataset: {}, style: {} };
    let migrated = null;
    const themeMeta = {
      content: "",
      setAttribute(name, value) {
        if (name === "content") this.content = value;
      },
    };
    const context = {
      window: {
        localStorage: {
          getItem: () => scenario.saved,
          setItem: (key, value) => {
            if (key === storageKey) migrated = value;
          },
        },
        matchMedia: () => ({ matches: scenario.systemDark }),
      },
      document: {
        documentElement: root,
        getElementById: (id) => id === "app-theme-color" ? themeMeta : null,
      },
    };
    vm.runInNewContext(initScript, context);
    assert.equal(root.dataset.themeMode, scenario.expectedMode);
    assert.equal(root.dataset.theme, scenario.expectedTheme);
    assert.equal(root.style.colorScheme, scenario.expectedScheme);
    assert.equal(themeMeta.content, scenario.expectedColor);
    assert.equal(migrated, scenario.migrated);
  }
});

test("theme toggle exposes exactly light, dark, and OLED modes", () => {
  assert.match(app, /<ThemeToggle \/>/);
  assert.match(themeSource, /export type ThemeMode = "light" \| "dark" \| "black"/u);
  assert.match(toggle, /className="theme-picker"/);
  assert.match(toggle, /className="icon-button theme-toggle"/);
  assert.match(toggle, /type="button"/);
  assert.match(toggle, /aria-haspopup="menu"/);
  assert.match(toggle, /role="menuitemradio"/);
  assert.match(toggle, /value: "light", label: "淺色", description: "明亮紙張配色"/u);
  assert.match(toggle, /value: "dark", label: "深色", description: "柔和深綠黑底"/u);
  assert.match(toggle, /value: "black", label: "純黑", description: "OLED 真黑背景"/u);
  assert.equal((toggle.match(/value: "(?:light|dark|black)"/gu) ?? []).length, 3);
  assert.doesNotMatch(toggle, /value: "(?:editorial|instrument)"/u);
  assert.match(toggle, /dataset\.themeMode = mode/);
  assert.match(toggle, /dataset\.theme = colorScheme/u);
  assert.match(toggle, /localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/);
  assert.match(toggle, /return subscribeToMediaQuery\(media, followSystemTheme\)/u);
  assert.match(mediaQuery, /compatible\.addEventListener\("change", listener\)/u);
  assert.match(mediaQuery, /compatible\.addListener\(listener\)/u);
  assert.match(mediaQuery, /Fall through to the legacy MediaQueryList API/u);
  assert.match(toggle, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/u);
  assert.match(toggle, /event\.key === "Home"/u);
  assert.match(toggle, /event\.key === "End"/u);
  assert.match(siteCss, /:root\s*\{[\s\S]*?color-scheme:\s*light;/u);
  assert.match(siteCss, /html\[data-theme="dark"\]\s*\{[\s\S]*?color-scheme:\s*dark;/u);
  assert.match(siteCss, /html\[data-theme-mode="black"\]\s*\{/u);
  assert.doesNotMatch(siteCss, /data-theme-mode="(?:editorial|instrument)"/u);
});
