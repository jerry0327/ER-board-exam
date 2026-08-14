import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ordinary search caches normalized queries and per-question text", async () => {
  const source = await readFile(new URL("../app/lib/question-data.ts", import.meta.url), "utf8");
  const browse = await readFile(new URL("../app/views/browse-view.tsx", import.meta.url), "utf8");
  const reader = await readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8");
  assert.match(source, /new WeakMap<QuestionIndex/);
  assert.match(source, /catalogVersion: number/);
  assert.match(source, /value !== lastSearchInput/);
  assert.match(source, /cached\?\.catalogVersion === catalogVersion/);
  assert.match(browse, /setSearchVersion\(1\)/);
  assert.match(reader, /setSearchVersion\(1\)/);
  assert.doesNotMatch(`${browse}\n${reader}`, /setSearchVersion\(\(value\)[^\n]+\+ 1\)/);
});
