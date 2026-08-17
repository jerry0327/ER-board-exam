import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const practice = await readFile(new URL("../app/views/practice-view.impl.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/practice-tools.css", import.meta.url), "utf8");
const site = await readFile(new URL("../app/site.css", import.meta.url), "utf8");

test("practice tools keep elimination and scratchpad state inside the active session", () => {
  assert.match(practice, /import "\.\.\/practice-tools\.css";/u);
  assert.doesNotMatch(site, /@import "\.\/practice-tools\.css" layer\(legacy\);/u);
  assert.match(practice, /eliminatedOptions: \{ \.\.\.currentSession\.eliminatedOptions/u);
  assert.match(practice, /scratchpads: \{ \.\.\.currentSession\.scratchpads/u);
  assert.match(practice, /只留下判斷記號，不會取消已選答案，也不影響提交與計分/u);
  assert.match(practice, /這題的臨時草稿/u);
  assert.doesNotMatch(practice, /不會加入正式筆記，也不會送入答案/u);
});

test("elimination is operable by buttons, keyboard, and option context menu", () => {
  assert.match(practice, /aria-pressed=\{eliminated\}/u);
  assert.match(practice, /aria-keyshortcuts=\{`Shift\+\$\{option\.key\}`\}/u);
  assert.match(practice, /onContextMenuCapture=\{handleOptionContextMenu\}/u);
  assert.match(practice, /if \(event\.shiftKey\)/u);
  assert.match(practice, /toggleEliminatedOption\(key\)/u);
  assert.match(styles, /\.option-eliminated-1/u);
  assert.match(styles, /text-decoration: line-through/u);
});

test("the temporary scratchpad is labelled, collapsible, and capped", () => {
  assert.match(practice, /aria-expanded=\{scratchpadOpen\}/u);
  assert.match(practice, /role="region" aria-label=\{`\$\{current\.id\} 臨時草稿紙`\}/u);
  assert.match(practice, /maxLength=\{4000\}/u);
  assert.match(practice, /htmlFor=\{`\$\{scratchpadId\}-input`\}/u);
  assert.match(styles, /\.practice-scratchpad-editor\[hidden\]/u);
});
