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
import {
  installSubtitlePackage,
  validateSubtitlePackage,
} from "../scripts/import-subtitle-section-pack.mjs";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixture(root, { extraChapterField = false } = {}) {
  const packageRoot = path.join(root, "package");
  const collection = path.join(packageRoot, "goldfrank");
  fs.mkdirSync(collection, { recursive: true });
  const source = Buffer.from([
    JSON.stringify({
      schema: "precision-src-v2",
      source: "goldfrank-CH999.m4a",
      collection: "goldfrank",
      chapter: "goldfrank-CH999",
      title: "Goldfrank CH999",
      timebase: "source-content-1.0x",
      speaker_map: { A: "lower", B: "higher" },
    }),
    JSON.stringify({ start: "00:00:00.000", end: "00:00:01.000", speaker: "A", text: "導論。" }),
    JSON.stringify({ start: "00:00:01.000", end: "00:00:02.000", speaker: "B", text: "結論。" }),
  ].join("\n") + "\n", "utf8");
  const sourceHash = sha256(source);
  const chapters = {
    schema: "subtitle-chapters-v1",
    source: "goldfrank-CH999.src",
    source_sha256: sourceHash,
    profile: "textbook-study",
    chapters: [{
      id: "l1-01",
      level: 1,
      title: "導論",
      start: "00:00:00.000",
      end: "00:00:01.000",
      start_cue: 1,
      end_cue: 1,
      children: [],
    }, {
      id: "l1-02",
      level: 1,
      title: "總結",
      start: "00:00:01.000",
      end: "00:00:02.000",
      start_cue: 2,
      end_cue: 2,
      children: [],
    }],
  };
  if (extraChapterField) chapters.chapters[0].confidence = 0.98;
  const chapterBytes = Buffer.from(`${JSON.stringify(chapters, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(collection, "goldfrank-CH999.src"), source);
  fs.writeFileSync(path.join(collection, "goldfrank-CH999.chapters.json"), chapterBytes);
  const manifest = {
    schema: "subtitle-player-section-manifest-v1",
    generated_at: "2026-08-13T00:00:00Z",
    counts: {
      collection_count: 1,
      pair_count: 1,
      cue_count: 2,
      chapter_count: 2,
      by_collection: { goldfrank: 1 },
    },
    pairs: [{
      collection: "goldfrank",
      source: "goldfrank/goldfrank-CH999.src",
      chapters: "goldfrank/goldfrank-CH999.chapters.json",
      source_sha256: sourceHash,
      chapters_sha256: sha256(chapterBytes),
      profile: "textbook-study",
      cue_count: 2,
      chapter_count: 2,
      duration: "00:00:02.000",
    }],
  };
  fs.writeFileSync(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return packageRoot;
}

test("validated same-stem package installs and round-trips through indexed Brotli content packs", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "subtitle-sections-"));
  try {
    const packageRoot = fixture(temporary);
    const runtimeRoot = path.join(temporary, "runtime");
    const target = path.join(runtimeRoot, "subtitles");
    const validated = validateSubtitlePackage(packageRoot);
    installSubtitlePackage(validated, target);
    assert.equal(validated.records.length, 1);
    assert.ok(fs.existsSync(path.join(target, "goldfrank", "goldfrank-CH999.src")));

    const compressed = compressRawFiles({ contentRoot: runtimeRoot, targetBytes: 1024 * 1024 });
    assert.equal(compressed.files, 3);
    assert.equal(auditCompressedRoot(runtimeRoot).files, 3);
    const entries = new Map(logicalContentEntries(runtimeRoot));
    assert.ok(entries.has("subtitles/manifest.json"));
    assert.ok(entries.has("subtitles/goldfrank/goldfrank-CH999.src"));
    assert.ok(entries.has("subtitles/goldfrank/goldfrank-CH999.chapters.json"));
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.existsSync(path.join(target, "goldfrank", "goldfrank-CH999.src")), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("import rejects authoring-only fields in player chapters", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "subtitle-sections-invalid-"));
  try {
    const packageRoot = fixture(temporary, { extraChapterField: true });
    assert.throws(() => validateSubtitlePackage(packageRoot), /non-runtime fields/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
