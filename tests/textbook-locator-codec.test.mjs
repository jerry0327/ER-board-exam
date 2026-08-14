import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compressTextbookLocator,
  readTextbookLocator,
} from "../scripts/lib/textbook-locator-codec.mjs";

test("textbook locator codec preserves JSON and removes the expanded source", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "textbook-locator-codec-"));
  const rawPath = path.join(directory, "locator.json");
  const compressedPath = `${rawPath}.br`;
  const payload = {
    schemaVersion: 1,
    questions: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `Q${String(index + 1).padStart(3, "0")}`,
        [{ chapter: (index % 20) + 1, pageStart: index + 10, pageEnd: index + 11 }],
      ]),
    ),
  };

  try {
    fs.writeFileSync(rawPath, JSON.stringify(payload, null, 2));
    const result = compressTextbookLocator({ rawPath, compressedPath });
    assert.equal(result.updated, true);
    assert.ok(result.compressedBytes < result.rawBytes);
    assert.equal(fs.existsSync(rawPath), false);
    assert.deepEqual(readTextbookLocator(compressedPath), payload);

    const reused = compressTextbookLocator({ rawPath, compressedPath });
    assert.equal(reused.updated, false);
    assert.deepEqual(readTextbookLocator(compressedPath), payload);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
