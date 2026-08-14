import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeRuntimeSemanticSubtitle,
  runtimeSemanticCueAt,
} from "../app/lib/subtitle-runtime-semantic-codec.ts";

const rootProject = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const codec = path.join(rootProject, "scripts", "subtitle_semantic_runtime_codec.py");
const externalCodecAvailable = fs.existsSync(codec);

function timestamp(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-semantic-codec-"));
  const lines = [JSON.stringify({
    schema: "precision-src-v2",
    source: "fixture.m4a",
    collection: "goldfrank",
    chapter: "fixture",
    title: "fixture",
    timebase: "source-content-1.0x",
    speaker_map: { A: "lower-pitched canonical voice", B: "higher-pitched canonical voice" },
  })];
  const cueTimes = [];
  let start = 0;
  for (let index = 0; index < 71; index += 1) {
    const end = start + 850 + (index * 91) % 3000;
    cueTimes.push([start, end]);
    lines.push(JSON.stringify({
      start: timestamp(start), end: timestamp(end), speaker: index < 30 ? "A" : "B",
      text: `第 ${index + 1} 句，保留精確時間與文字。`,
    }));
    start = end + (index === 12 ? 30 : 0);
  }
  const source = Buffer.from(`${lines.join("\n")}\n`, "utf8");
  const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  const chapters = {
    schema: "subtitle-chapters-v1",
    source: "fixture.src",
    source_sha256: sourceHash,
    profile: "textbook-study",
    chapters: [
      {
        id: "l1-01", level: 1, title: "導論",
        // The source has a 30 ms silence gap before cue 14. Section end is
        // intentionally the next cue's start (exclusive), not cue 13's end.
        start: timestamp(cueTimes[0][0]), end: timestamp(cueTimes[13][0]),
        start_cue: 1, end_cue: 13, children: [],
      },
      {
        id: "l1-02", level: 1, title: "核心主題",
        start: timestamp(cueTimes[13][0]), end: timestamp(cueTimes[30][0]),
        start_cue: 14, end_cue: 30, children: [
          {
            id: "l1-02-l2-01", level: 2, type: "subsection", title: "第一項細節",
            start: timestamp(cueTimes[13][0]), end: timestamp(cueTimes[21][0]),
            start_cue: 14, end_cue: 21,
          },
          {
            id: "l1-02-l2-02", level: 2, type: "subsection", title: "第二項細節",
            start: timestamp(cueTimes[21][0]), end: timestamp(cueTimes[30][0]),
            start_cue: 22, end_cue: 30,
          },
        ],
      },
      {
        id: "l1-03", level: 1, title: "總結",
        start: timestamp(cueTimes[30][0]), end: timestamp(cueTimes[70][1]),
        start_cue: 31, end_cue: 71, children: [],
      },
    ],
  };
  const chaptersBytes = Buffer.from(`${JSON.stringify(chapters, null, 2)}\n`, "utf8");
  const sourcePath = path.join(temporary, "fixture.src");
  const chaptersPath = path.join(temporary, "fixture.chapters.json");
  const hxtPath = path.join(temporary, "fixture.hxt");
  const hxmPath = path.join(temporary, "fixture.hxm");
  fs.writeFileSync(sourcePath, source);
  fs.writeFileSync(chaptersPath, chaptersBytes);
  const result = spawnSync("python", [codec, "encode", sourcePath, chaptersPath, hxtPath, hxmPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return {
    temporary, source, chaptersBytes, cueTimes,
    hxt: new Uint8Array(fs.readFileSync(hxtPath)),
    hxm: new Uint8Array(fs.readFileSync(hxmPath)),
  };
}

test("browser HXT2/HXM2 decoder restores exact SRC, sections, 1 ms timing and speaker identity", async (t) => {
  if (!externalCodecAvailable) { t.skip("external Python codec fixture is not present in this standalone checkout"); return; }
  const data = fixture();
  try {
    const sourceSha = crypto.createHash("sha256").update(data.source).digest("hex");
    const chaptersSha = crypto.createHash("sha256").update(data.chaptersBytes).digest("hex");
    const decoded = await decodeRuntimeSemanticSubtitle(data.hxt, data.hxm, {
      sourceSha256: sourceSha,
      chaptersSha256: chaptersSha,
    });
    assert.deepEqual(Buffer.from(decoded.sourceBytes), data.source);
    assert.deepEqual(Buffer.from(decoded.chaptersBytes), data.chaptersBytes);
    assert.equal(decoded.subtitle.cues[30].start, timestamp(data.cueTimes[30][0]));
    assert.equal(decoded.subtitle.cues[30].speaker, "B");
    assert.equal(decoded.metadata.chapters[2].title, "總結");
    assert.equal(decoded.metadata.chapters[2].start_cue, 31);
    assert.equal(decoded.metadata.chapters[0].end, timestamp(data.cueTimes[13][0]));
    assert.equal(decoded.metadata.chapters[1].children[1].start_cue, 22);
    assert.equal(decoded.metadata.chapters[1].children[0].end, timestamp(data.cueTimes[21][0]));
  } finally {
    fs.rmSync(data.temporary, { recursive: true, force: true });
  }
});

test("deployed Section boundaries contain cue deltas, not duplicated timestamp metadata", (t) => {
  if (!externalCodecAvailable) { t.skip("external Python codec fixture is not present in this standalone checkout"); return; }
  const data = fixture();
  try {
    const hxmTextProbe = Buffer.from(data.hxm).toString("latin1");
    const hxtText = Buffer.from(data.hxt).toString("utf8");
    for (const forbidden of ["00:", "start_cue", "end_cue", "\"start\"", "\"end\""]) {
      assert.equal(hxmTextProbe.includes(forbidden), false, `HXM2 leaked ${forbidden}`);
    }
    assert.equal(hxtText.includes("00:"), false);
    assert.equal(hxtText.includes("start_cue"), false);
    assert.match(hxtText, /L\t"第一項細節"/u);
    assert.match(hxtText, /L\t"第二項細節"/u);
  } finally {
    fs.rmSync(data.temporary, { recursive: true, force: true });
  }
});

test("HXT2/HXM2 decoder rejects corrupt sidecars and section/source binding mismatch", async (t) => {
  if (!externalCodecAvailable) { t.skip("external Python codec fixture is not present in this standalone checkout"); return; }
  const data = fixture();
  try {
    const corrupt = new Uint8Array(data.hxm);
    corrupt[corrupt.length - 8] ^= 1;
    await assert.rejects(decodeRuntimeSemanticSubtitle(data.hxt, corrupt), /CRC-32/u);
    await assert.rejects(decodeRuntimeSemanticSubtitle(data.hxt, data.hxm, {
      chaptersSha256: "f".repeat(64),
    }), /chapters SHA-256/u);
    await assert.rejects(decodeRuntimeSemanticSubtitle(data.hxt, data.hxm, {
      hxmSha256: "e".repeat(64),
    }), /HXM2 SHA-256/u);
  } finally {
    fs.rmSync(data.temporary, { recursive: true, force: true });
  }
});

test("HXT2 checkpoints provide bounded exact A/B and millisecond cue lookup", (t) => {
  if (!externalCodecAvailable) { t.skip("external Python codec fixture is not present in this standalone checkout"); return; }
  const data = fixture();
  try {
    for (const index of [0, 29, 30, 63, 64, 70]) {
      assert.deepEqual(runtimeSemanticCueAt(data.hxm, index), {
        startMilliseconds: data.cueTimes[index][0],
        endMilliseconds: data.cueTimes[index][1],
        speaker: index < 30 ? "A" : "B",
      });
    }
  } finally {
    fs.rmSync(data.temporary, { recursive: true, force: true });
  }
});
