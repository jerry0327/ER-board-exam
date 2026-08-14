import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, learningGuide] = await Promise.all([
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8"),
]);

const learningReaders = await Promise.all([
  "guide-view.tsx",
  "rosens-guide-view.tsx",
  "ails-guide-view.tsx",
  "board-textbook-view.tsx",
  "ems-guide-view.tsx",
  "supplemental-guide-view.tsx",
].map((name) => readFile(new URL(`../app/views/${name}`, import.meta.url), "utf8")));

test("the dashboard stays eager while mutually exclusive routes load on demand", () => {
  assert.match(app, /import DashboardView from "\.\/views\/dashboard-view"/u);
  assert.match(app, /const loadPracticeView = \(\) => loadDeferredModule\("practice", \(\) => import\("\.\/views\/practice-view"\)\)/u);
  assert.match(app, /const loadReaderView = \(\) => loadDeferredModule\("reader", \(\) => import\("\.\/views\/reader-view"\)\)/u);
  assert.match(app, /const loadLearningGuideView = \(\) => loadDeferredModule\("learning-guide", \(\) => import\("\.\/views\/learning-guide-view"\)\)/u);
  assert.match(app, /const routeViewLoaders: Partial<Record<NavView/u);
  assert.match(app, /function routeMayOfferLearningAudio[\s\S]*?view === "學習指引"[\s\S]*?view === "學習音檔"[\s\S]*?view === "詳解閱讀" && Boolean\(questionId\)/u);
  assert.match(app, /const prepareAudioForRoute = useCallback\([\s\S]*?preloadRouteView\(view\);[\s\S]*?routeMayOfferLearningAudio\(view, questionId\)[\s\S]*?prepareAudioShell\(\);[\s\S]*?if \(decoderIntent\) prewarmAudioDecoder\(\);/u);
  const routePreloadStart = app.indexOf("const prepareAudioForRoute");
  const routePreload = app.slice(routePreloadStart, app.indexOf("useEffect(() =>", routePreloadStart));
  assert.match(routePreload, /prepareAudioShell\(\)/u);
  assert.doesNotMatch(routePreload, /prepareAudioPlayer\(\)|loadAudioSummaryCatalog\(/u);
  assert.match(app, /window\.setTimeout\(\(\) => \{[\s\S]*?requestIdleCallback\(run, \{ timeout: 2_400 \}\)[\s\S]*?\}, 900\)/u);
  assert.match(app, /onPointerEnter=\{\(\) => prepareAudioForRoute\(item\.name, null, true\)\}[\s\S]*?onFocus=\{\(\) => prepareAudioForRoute\(item\.name, null, true\)\}[\s\S]*?onPointerDown=\{\(\) => prepareAudioForRoute\(item\.name, null, true\)\}/u);
  assert.doesNotMatch(app, /targetSurfaceHasPainted|prepareAudioPlayer/u);
  assert.match(app, /prepareAudioForRoute\("詳解閱讀", id\)/u);
  assert.match(app, /const relatedRouteViews: Partial<Record<NavView[\s\S]*?"學習指引": \["學習音檔", "學習文件"\]/u);
  assert.match(app, /"總覽": \["開始作答"\]/u);
  assert.match(app, /requestIdleCallback\(run, \{ timeout: 1_200 \}\)/u);
  assert.match(app, /document\.querySelector\("#site-main > main:not\(\.route-loading-shell\)"\)/u);
  assert.match(app, /function RouteLoadingShell\([\s\S]*?route-loading-shell[\s\S]*?route-loading-grid/u);
  assert.match(app, /<Suspense fallback=\{<RouteLoadingShell view=\{activeNav\} \/>\}>/u);
  assert.match(app, /<DashboardView[\s\S]*?<LearningGuideView/u);
  assert.match(app, /recoverableDynamicImportFailure[\s\S]*?window\.location\.reload\(\)/u);
  assert.doesNotMatch(app, /import PracticeView from "\.\/views\/practice-view"/u);
  assert.doesNotMatch(app, /import ReaderView from "\.\/views\/reader-view"/u);
});

test("the learning hub renders first and then warms textbook readers sequentially while idle", () => {
  assert.match(learningGuide, /import GuideHubView from "\.\/guide-hub-view"/u);
  assert.match(learningGuide, /const loadGuideView = \(\) => import\("\.\/guide-view"\)/u);
  assert.match(learningGuide, /const loadRosensGuideView = \(\) => import\("\.\/rosens-guide-view"\)/u);
  assert.match(learningGuide, /const GuideView = lazy\(loadGuideView\)/u);
  assert.match(learningGuide, /const RosensGuideView = lazy\(loadRosensGuideView\)/u);
  assert.match(learningGuide, /const showingHub = !requestedGuideModuleId && !requestedTextbookId && !requestedResourceId/u);
  assert.match(learningGuide, /connection\?\.saveData \|\| \["slow-2g", "2g"\]\.includes/u);
  assert.match(learningGuide, /timerId = window\.setTimeout\(schedule, 650\)/u);
  assert.match(learningGuide, /requestIdleCallback\(run, \{ timeout: 1_400 \}\)/u);
  assert.match(learningGuide, /void load\(\)\.catch\(\(\) => undefined\)\.finally/u);
});

test("learning readers keep a useful first-paint shell while their content packs open", () => {
  for (const reader of learningReaders) {
    assert.match(reader, /import LearningReaderLoadingShell from "\.\.\/components\/learning-reader-loading-shell"/u);
    assert.match(reader, /return <LearningReaderLoadingShell/u);
  }
});
