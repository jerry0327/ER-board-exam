import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeSemanticSubtitle,
  semanticCueAt,
} from "../app/lib/subtitle-semantic-codec.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const codec = path.join(projectRoot, "scripts", "subtitle_hxt_hxm_codec.py");
const semanticCodecTestOptions = {
  skip: fs.existsSync(codec) ? false : "external Python semantic codec is not present in this standalone checkout",
};

function sourceText(cueCount = 71) {
  const lines = [JSON.stringify({
    schema: "precision-src-v2",
    source: "fixture.m4a",
    collection: "goldfrank",
    chapter: "fixture",
    title: "fixture",
    timebase: "source-content-1.0x",
    speaker_map: { A: "lower-pitched canonical voice", B: "higher-pitched canonical voice" },
  })];
  const expected = [];
  let start = 0;
  for (let index = 0; index < cueCount; index += 1) {
    const end = start + 903 + (index * 173) % 4871;
    const speaker = Math.floor(index / 6) % 2 === 0 ? "A" : "B";
    lines.push(JSON.stringify({
      start: time(start),
      end: time(end),
      speaker,
      text: `第 ${index + 1} 句：MAOI 與 1.25 mg；保留文字。`,
    }));
    expected.push({ start, end, speaker });
    start = end + (index % 17 === 0 ? 30 : 0);
  }
  return { bytes: Buffer.from(`${lines.join("\n")}\n`, "utf8"), expected };
}

function time(milliseconds) {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function encodedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-subtitle-codec-"));
  const source = sourceText();
  const sourcePath = path.join(root, "fixture.src");
  const hxtPath = path.join(root, "fixture.hxt");
  const hxmPath = path.join(root, "fixture.hxm");
  fs.writeFileSync(sourcePath, source.bytes);
  const result = spawnSync("python", [codec, "encode", sourcePath, hxtPath, hxmPath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return {
    root,
    source,
    hxt: new Uint8Array(fs.readFileSync(hxtPath)),
    hxm: new Uint8Array(fs.readFileSync(hxmPath)),
  };
}

test("browser semantic decoder round-trips the Python reference bytes exactly", semanticCodecTestOptions, async () => {
  const fixture = encodedFixture();
  try {
    const expectedHash = crypto.createHash("sha256").update(fixture.source.bytes).digest("hex");
    const decoded = await decodeSemanticSubtitle(fixture.hxt, fixture.hxm, expectedHash);
    assert.deepEqual(Buffer.from(decoded.sourceBytes), fixture.source.bytes);
    assert.equal(decoded.sourceSha256, expectedHash);
    assert.equal(decoded.subtitle.cues.length, fixture.source.expected.length);
    assert.equal(decoded.subtitle.cues[0].text, "第 1 句：MAOI 與 1.25 mg；保留文字。");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("semantic cue lookup starts from a bounded checkpoint and preserves 1 ms A/B", semanticCodecTestOptions, () => {
  const fixture = encodedFixture();
  try {
    // Cue 66 is in an odd-numbered speaker run after the 64-cue checkpoint;
    // this guards the checkpoint's A/B parity rather than only its timing.
    for (const index of [0, 63, 64, 66, fixture.source.expected.length - 1]) {
      const actual = semanticCueAt(fixture.hxm, index);
      const expected = fixture.source.expected[index];
      assert.deepEqual(actual, {
        startMilliseconds: expected.start,
        endMilliseconds: expected.end,
        speaker: expected.speaker,
      });
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("semantic decoder fails closed for corruption or a mixed HXT/HXM generation", semanticCodecTestOptions, async () => {
  const fixture = encodedFixture();
  try {
    const corrupt = new Uint8Array(fixture.hxm);
    corrupt[Math.floor(corrupt.length / 2)] ^= 1;
    await assert.rejects(decodeSemanticSubtitle(fixture.hxt, corrupt), /CRC-32/u);
    const mixed = new Uint8Array(fixture.hxt);
    mixed[mixed.length - 3] ^= 1;
    await assert.rejects(decodeSemanticSubtitle(mixed, fixture.hxm), /HXT SHA-256/u);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
