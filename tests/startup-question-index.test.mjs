import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { brotliCompressSync, constants } from "node:zlib";
import {
  STARTUP_QUESTION_FIELDS,
  startupQuestionIndex,
} from "../scripts/generate-startup-question-index.mjs";

const [full, committed] = await Promise.all([
  readFile(new URL("../public/data/index.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../public/data/startup-index.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("the committed startup question index is reproducible and omits display-heavy fields", () => {
  const expected = startupQuestionIndex(full);
  assert.deepEqual(committed, expected);
  assert.match(committed.questionDataRevision, /^[a-f0-9]{64}$/u);
  assert.equal(committed.questionDataRevision, full.questionDataRevision);
  assert.equal(committed.questions.length, full.questions.length);
  assert.deepEqual(
    [...new Set(committed.questions.flatMap((question) => Object.keys(question)))].sort(),
    STARTUP_QUESTION_FIELDS.filter((field) => full.questions.some((question) => Object.hasOwn(question, field))).sort(),
  );
  for (const forbidden of ["title", "stem", "answerKeys", "focus", "sourceSections", "images"]) {
    assert.equal(committed.questions.some((question) => Object.hasOwn(question, forbidden)), false);
  }
  assert.equal(committed.questions.some((question) => Object.hasOwn(question, "contentHash")), false);
});

test("the startup planning payload stays within its first-load budget", () => {
  const raw = Buffer.from(JSON.stringify(committed));
  const compressed = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  assert.ok(raw.length < 400_000, `startup index raw size is ${raw.length} bytes`);
  assert.ok(compressed.length < 25_000, `startup index Brotli size is ${compressed.length} bytes`);
});
