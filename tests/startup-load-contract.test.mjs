import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/lib/question-data.ts", import.meta.url), "utf8");
const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/site.css", import.meta.url), "utf8");

test("cold startup gates only on the manifest and compact planning index", () => {
  assert.match(
    source,
    /export async function loadQuestionBankStartup\(\)[\s\S]*?loadQuestionManifest\(\)[\s\S]*?fetchCompressedStatic\("\/data\/startup-index\.json"/u,
  );
  const startup = source.slice(source.indexOf("export async function loadQuestionBankStartup"), source.indexOf("export async function loadQuestionBank()"));
  assert.doesNotMatch(startup, /loadStudyGuideLinks\(\)/u);
  assert.doesNotMatch(startup, /"\/data\/index\.json"/u);
  assert.match(source, /export async function loadQuestionBank\(\)[\s\S]*?fetchCompressedStatic\("\/data\/index\.json"/u);
  assert.match(source, /export async function enrichQuestionBankGuideLinks[\s\S]*?const guideLinks = await loadStudyGuideLinks\(\)/u);
  assert.match(source, /cache: version \? "force-cache" : "no-cache"/u);
});

test("startup renders the actual homepage shell while the question index hydrates", () => {
  for (const candidate of [app, page, css]) {
    assert.doesNotMatch(candidate, /BootstrapHome|bootstrap-home|緊急公告/u);
  }
  assert.match(page, /<QuestionBankApp\s*\/>/u);
  assert.match(app, /function RouteLoadingShell\(/u);
  assert.match(app, /className="workspace-page route-loading-shell"/u);
  assert.doesNotMatch(app, /正在載入急專補給站…/u);
  assert.match(app, /function StartupHome\(\)/u);
  assert.match(app, /首頁已經可以閱讀；今日進度會接著顯示/u);
  assert.doesNotMatch(app, /背景接上|背景同步|LOADING 02/u);
  assert.match(app, /if \(!manifest \|\| !questions\.length\) return <StartupHome \/>/u);
  assert.match(css, /\.startup-progress-mark/u);
});

test("route loading shells keep the destination's settled page title", () => {
  assert.match(app, /type NavItem = \{[\s\S]*?pageTitle: string;/u);
  assert.match(app, /name: "學習音檔", label: "音檔", pageTitle: "學習音檔"/u);
  assert.match(app, /name: "學習指引", label: "指引", pageTitle: "選擇學習指引"/u);
  assert.match(app, /<h1 id="route-loading-title">\{item\.pageTitle\}<\/h1>/u);
  const shell = app.slice(app.indexOf("function RouteLoadingShell"), app.indexOf("function StartupHome"));
  assert.doesNotMatch(shell, /<h1[^>]*>\{item\.label\}<\/h1>/u);
});

test("startup data begins before hydration without forcing request-time metadata", () => {
  assert.match(layout, /export const metadata: Metadata/u);
  assert.doesNotMatch(layout, /next\/headers|generateMetadata|headers\(\)/u);
  assert.match(layout, /<link rel="preload" href="\/data\/manifest\.json" as="fetch" crossOrigin="anonymous" \/>/u);
  assert.match(layout, /<link rel="preload" href="\/data\/startup-index\.json" as="fetch" crossOrigin="anonymous" \/>/u);
  assert.doesNotMatch(layout, /<link rel="preload" href="\/data\/index\.json"/u);
});

test("the full question index waits until after the dashboard can paint", () => {
  assert.match(app, /loadQuestionBankStartup\(\)/u);
  assert.match(app, /timerId = window\.setTimeout\([\s\S]*?requestIdleCallback\(warm, \{ timeout: 2_500 \}\)[\s\S]*?1_200\);/u);
  assert.match(app, /fullQuestionIndexViews\.has\(activeNav\) && !fullQuestionIndexReady/u);
});
