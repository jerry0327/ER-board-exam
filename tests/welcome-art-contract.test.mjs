import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../app/views/dashboard-view.tsx", import.meta.url), "utf8");

test("instrument dashboard removes rotating decorative welcome art", () => {
  assert.doesNotMatch(dashboard, /welcomeArts|welcomeArt|em-board-welcome-art-index-v1/u);
  assert.doesNotMatch(dashboard, /<picture|<img/u);
  assert.match(dashboard, /className="instrument-progress-plate"/u);
  assert.match(dashboard, /className="instrument-progress-ring"/u);
  assert.doesNotMatch(dashboard, /museum-/u);
});

test("dashboard first viewport stays data-led at every size", () => {
  assert.match(dashboard, /aria-label="題庫索引摘要"/u);
  assert.match(dashboard, /aria-label="今日學習狀態"/u);
  assert.match(dashboard, /STUDY STATUS/u);
});
