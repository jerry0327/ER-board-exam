import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditCompressedRoot,
  compressRawFiles,
  logicalContentEntries,
} from "../scripts/lib/static-content-codec.mjs";

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("semantic runtime packs Brotli-ready HXT bundles but leaves opaque HXM identity sidecars outside content packs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-runtime-static-"));
  try {
    const bundle = Buffer.from("HXT2\nH\t{\"schema\":\"precision-src-v2\"}\nP\t\"textbook-study\"\nT\t\"cue\"\nL\t\"導論\"\n", "utf8");
    const bundleHash = hash(bundle);
    const hxm = Buffer.from([0x48, 0x58, 0x4d, 0x32, 1, 0, 1, 64, ...new Array(100).fill(0)]);
    const hxmHash = hash(hxm);
    const runtimeRoot = path.join(root, "subtitles-runtime");
    fs.mkdirSync(path.join(runtimeRoot, "bundles"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "timing"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "manifest.json"), JSON.stringify({ schema: "subtitle-runtime-semantic-manifest-v2" }));
    fs.writeFileSync(path.join(runtimeRoot, "bundles", `${bundleHash}.hxtb`), bundle);
    fs.writeFileSync(path.join(runtimeRoot, "timing", `${hxmHash}.hxm`), hxm);

    const result = compressRawFiles({ contentRoot: root, targetBytes: 1024 * 1024 });
    assert.equal(result.files, 2);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "manifest.json")), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "bundles", `${bundleHash}.hxtb`)), false);
    assert.deepEqual(fs.readFileSync(path.join(runtimeRoot, "timing", `${hxmHash}.hxm`)), hxm);
    const entries = new Map(logicalContentEntries(root));
    assert.deepEqual(entries.get("subtitles-runtime/manifest.json"), Buffer.from(JSON.stringify({ schema: "subtitle-runtime-semantic-manifest-v2" })));
    assert.deepEqual(entries.get(`subtitles-runtime/bundles/${bundleHash}.hxtb`), bundle);
    assert.equal(auditCompressedRoot(root).files, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
