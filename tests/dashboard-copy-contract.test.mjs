import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../app/views/dashboard-view.tsx", import.meta.url), "utf8");
const analytics = await readFile(new URL("../app/views/analytics-view.tsx", import.meta.url), "utf8");

test("dashboard rotates a substantial set of restrained learning headlines", () => {
  assert.match(dashboard, /const DASHBOARD_HEADLINES = \[/u);
  assert.equal((dashboard.match(/\{ lead: /gu) ?? []).length, 24);
  assert.match(dashboard, /整理今日進度，/u);
  assert.match(dashboard, /安排下一輪複習/u);
  assert.match(dashboard, /題目、詳解與章節，/u);
  assert.match(dashboard, /讓今天的練習，/u);
  assert.match(dashboard, /window\.crypto\.getRandomValues\(entropy\)/u);
  assert.match(dashboard, /if \(next === previous\) next = \(next \+ 1\) % DASHBOARD_HEADLINES\.length/u);
  assert.match(dashboard, /<span>\{headline\.lead\}<\/span>[\s\S]*?<em>\{headline\.accent\}<\/em>/u);
  assert.match(dashboard, /依作答紀錄安排下一輪練習，也可以直接按年度閱讀詳解/u);
  assert.match(dashboard, /DAILY STUDY \/ 01/u);
  assert.doesNotMatch(dashboard, /EXH\.|instrument-exhibit-strip/u);
  assert.doesNotMatch(dashboard, /welcomeNotes|WelcomeNote|salutation|randomFraction/u);
});

test("dashboard keeps study information stable while varying only the headline between visits", () => {
  assert.doesNotMatch(dashboard, /sessionStorage|Math\.random/u);
  assert.match(dashboard, /DASHBOARD_HEADLINE_STORAGE_KEY/u);
  assert.match(dashboard, /className="instrument-archive-index"/u);
  assert.match(dashboard, /className="instrument-status-strip"/u);
  assert.doesNotMatch(dashboard, /museum-|instrument-exhibit-strip/u);
  assert.match(dashboard, /role="progressbar"/u);
});

test("dashboard groups the six destinations into three progressively disclosed workflows", () => {
  const workflowIds = [...dashboard.matchAll(/\bid: "(questions|review|preparation)"/gu)].map((match) => match[1]);
  assert.deepEqual(workflowIds, ["questions", "review", "preparation"]);
  assert.match(dashboard, /workflowGroups\.map\(\(group\) =>/u);
  assert.match(dashboard, /<article[\s\S]*?data-workflow=\{group\.id\}[\s\S]*?aria-labelledby=\{`dashboard-workflow-\$\{group\.id\}`\}/u);
  assert.match(dashboard, /const \[primaryAction, secondaryAction\] = group\.actions/u);
  assert.match(dashboard, /className="primary-button" onClick=\{\(\) => onNavigate\(primaryAction\.view\)\}/u);
  assert.match(dashboard, /className="text-action" onClick=\{\(\) => onNavigate\(secondaryAction\.view\)\}/u);
  assert.doesNotMatch(dashboard, /const routeIndex|routeIndex\.map/u);
});

test("analytics omits the internal metric-explanation card", () => {
  assert.doesNotMatch(analytics, /這些數字怎麼算/u);
  assert.doesNotMatch(analytics, /覆蓋率<\/strong>以不重複題幹計算/u);
  assert.doesNotMatch(analytics, /領域表現<\/strong>按重複題群合併/u);
  assert.doesNotMatch(analytics, /近期正確率<\/strong>採最近 50 次作答/u);
});
