import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/site.css", import.meta.url), "utf8");

test("arrow-based medical algorithms render as responsive reading content, not code", () => {
  assert.match(renderer, /parseMedicalFlow\(content\)/u);
  assert.match(renderer, /<MedicalFlow value=\{content\} label=\{contentLabel\} \/>/u);
  assert.match(renderer, /className="medical-flow"/u);
  assert.match(renderer, /aria-label=\{`\$\{label\}醫學處置流程`\}/u);
  assert.match(renderer, /className="medical-flow-connector"[\s\S]*?<ArrowDown \/>/u);
  assert.match(renderer, /className="medical-flow-branch"/u);
  assert.match(renderer, /className="medical-flow-branch-label"/u);
  assert.match(renderer, /: <pre role="region"/u);

  assert.match(css, /\.medical-flow \{[^}]*font-family: var\(--site-reading\);[^}]*max-inline-size: 100%;[^}]*overflow: hidden;/su);
  assert.match(css, /\.medical-flow-connector svg \{[^}]*height: 16px;[^}]*stroke-width: 1\.45;/su);
  assert.match(css, /\.medical-flow-branch \{[^}]*overflow-wrap: anywhere;/su);
  assert.doesNotMatch(css, /\.medical-flow-connector[^}]*border-radius: 50%/su);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.medical-flow \{[^}]*padding: 16px 14px;/su);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.medical-flow-branches\.is-flat \{[^}]*grid-template-columns: minmax\(0, 1fr\);/su);
  assert.doesNotMatch(css, /\.medical-flow \{[^}]*#[0-9a-f]{3,8}/iu);
});
