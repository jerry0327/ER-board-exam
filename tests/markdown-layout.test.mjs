import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const css = await readLegacyCss();
const renderer = fs.readFileSync(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `找不到 CSS 規則：${selector}`);
  return match[1];
}

test("keeps wide markdown regions bounded and keyboard-scrollable", () => {
  assert.match(rule(".table-scroll"), /overflow-x:\s*auto/);
  assert.match(rule(".table-scroll"), /max-inline-size:\s*100%/);
  assert.match(rule(".markdown-body pre"), /overflow-x:\s*auto/);
  assert.match(rule(".markdown-body pre"), /max-inline-size:\s*100%/);
  assert.match(renderer, /className="table-scroll"[\s\S]*?tabIndex=\{0\}/);
  assert.match(renderer, /<pre role="region"[\s\S]*?tabIndex=\{0\}/);
});

test("contains formulas, images, flows, and deeply nested prose", () => {
  assert.match(rule(".markdown-body .katex-display"), /overflow-x:\s*auto/);
  assert.match(rule(".markdown-body img"), /max-inline-size:\s*100%/);
  assert.match(rule(".markdown-body li"), /min-width:\s*0/);
  assert.match(rule(".markdown-body .flow-sequence, .markdown-body .flow-tree"), /max-inline-size:\s*100%/);
  assert.match(rule(".decision-tree"), /contain:\s*inline-size/);
  assert.match(renderer, /loading="lazy" decoding="async"/);
});
