import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const practice = await readFile(new URL("../app/views/practice-view.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../app/components/session-evaluation-panel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("freezes completion time and renders an actionable post-session evaluation", () => {
  assert.match(practice, /completedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(practice, /<SessionEvaluationPanel/);
  assert.match(panel, /本輪作答結果/);
  assert.match(panel, /整理本輪正確率、答題信心與各領域表現/);
  assert.doesNotMatch(panel, /不是專科考試通過率預測|不直接視為固定弱點/u);
  assert.match(panel, /只練本輪錯題/);
  assert.match(panel, /建議搭配學習指引/);
});

test("evaluation bars expose numeric meaning and remain responsive", () => {
  assert.match(panel, /role="progressbar"/);
  assert.match(panel, /aria-valuenow=\{topic\.accuracy\}/);
  assert.match(css, /\.session-evaluation \{[^}]*grid-column: 1 \/ -1/);
  assert.match(css, /\.evaluation-layout \{[^}]*grid-template-columns:/);
  assert.match(css, /\.evaluation-metrics \{ grid-template-columns: 1fr; \}/);
});
