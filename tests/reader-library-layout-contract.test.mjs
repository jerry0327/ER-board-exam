import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("reader filters cannot consume or overflow the question list", () => {
  assert.match(css, /\.reader-library\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*calc\(100dvh - 108px\);[^}]*min-height:\s*0;[^}]*min-width:\s*0;/su);
  assert.match(css, /\.reader-selects\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/su);
  assert.match(css, /\.reader-selects select\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/su);
  assert.match(css, /\.reader-selects select:nth-child\(n \+ 3\)\s*\{[^}]*grid-column:\s*1 \/ -1;/su);
  assert.match(css, /\.reader-question-list\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/su);
  assert.doesNotMatch(css, /\.reader-question-list\s*\{[^}]*height:\s*calc\(100vh - 270px\)/su);
});
