import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the forbidden static full-text engine out of source and artifacts", () => {
  const output = execFileSync(process.execPath, ["scripts/guard-static-index.mjs"], { encoding: "utf8" });
  assert.match(output, /policy passed/i);
});

test("checks application, worker, database, build configuration, and generated artifacts", async () => {
  const source = await readFile(new URL("../scripts/guard-static-index.mjs", import.meta.url), "utf8");
  assert.match(source, /"build", "db", "drizzle"/);
  assert.match(source, /"worker"/);
  assert.match(source, /for \(const relative of generatedRoots\) \{/);
  assert.match(source, /logicalContentEntries\(absolute\)/);
});
