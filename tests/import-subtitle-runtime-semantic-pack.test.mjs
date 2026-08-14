import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  installSemanticRuntimePackage,
  validateSemanticRuntimePackage,
} from "../scripts/import-subtitle-runtime-semantic-pack.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const builder = path.join(workspaceRoot, "scripts", "build_subtitle_runtime_semantic_pack.py");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-runtime-import-"));
  const sourceRoot = path.join(root, "source");
  const chapterRoot = path.join(root, "chapters");
  fs.mkdirSync(path.join(sourceRoot, "goldfrank"), { recursive: true });
  fs.mkdirSync(path.join(chapterRoot, "goldfrank"), { recursive: true });
  const source = `${[
    JSON.stringify({
      schema: "precision-src-v2", source: "fixture.m4a", collection: "goldfrank", chapter: "fixture", title: "fixture",
      timebase: "source-content-1.0x",
      speaker_map: { A: "lower-pitched canonical voice", B: "higher-pitched canonical voice" },
    }),
    JSON.stringify({ start: "00:00:00.000", end: "00:00:01.000", speaker: "A", text: "Introduction cue" }),
    JSON.stringify({ start: "00:00:01.000", end: "00:00:02.000", speaker: "B", text: "Conclusion cue" }),
  ].join("\n")}\n`;
  const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex");
  const chapters = {
    schema: "subtitle-chapters-v1", source: "fixture.src", source_sha256: sourceSha256, profile: "textbook-study",
    chapters: [
      { id: "l1-01", level: 1, title: "導論", start: "00:00:00.000", end: "00:00:01.000", start_cue: 1, end_cue: 1, children: [] },
      { id: "l1-02", level: 1, title: "總結", start: "00:00:01.000", end: "00:00:02.000", start_cue: 2, end_cue: 2, children: [] },
    ],
  };
  fs.writeFileSync(path.join(sourceRoot, "goldfrank", "fixture.src"), source);
  fs.writeFileSync(path.join(chapterRoot, "goldfrank", "fixture.chapters.json"), `${JSON.stringify(chapters, null, 2)}\n`);
  const packageRoot = path.join(root, "runtime-pack");
  const built = spawnSync("python", [
    builder, "--source-root", sourceRoot, "--chapters-root", chapterRoot, "--output", packageRoot,
    "--collections", "goldfrank", "--generated-at", "2026-08-13T00:00:00Z",
  ], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  return { root, packageRoot };
}

function formalTerminalRegistry() {
  const counts = {
    "board-guides": 39,
    ems: 24,
    goldfrank: 139,
    "question-bank": 664,
    rosens: 236,
    tintinalli: 330,
  };
  const entries = [];
  for (const [collection, count] of Object.entries(counts)) {
    for (let index = 1; index <= count; index += 1) {
      const stem = `terminal-${String(index).padStart(4, "0")}`;
      entries.push({
        collection,
        source: `${collection}/${stem}.src`,
        chapter_key: `${collection}/${stem}`,
        status: "terminal-unavailable",
        decision_id: `terminal-${collection}-${index}`,
        authority: "manager-terminal-adjudication",
        raw_sha256: "0".repeat(64),
        evidence_sha256: "1".repeat(64),
        evidence_path: `outputs/${collection}/${stem}.json`,
      });
    }
  }
  entries.sort((left, right) => left.source.localeCompare(right.source, "en"));
  return {
    schema: "subtitle-terminal-unavailable-registry-v1",
    generated_at: "2026-08-14T00:00:00Z",
    expected_audio_count: 1433,
    counts: {
      unavailable_count: 1432,
      available_pair_target: 1,
      by_collection: counts,
    },
    entries,
  };
}

test("semantic runtime importer validates each reversible pair and atomically installs only its namespace", async () => {
  const data = fixture();
  try {
    const validated = await validateSemanticRuntimePackage(data.packageRoot);
    assert.equal(validated.pairs, 1);
    assert.equal(validated.bundles, 1);
    await assert.rejects(
      validateSemanticRuntimePackage(data.packageRoot, undefined, { requireFormalCorpus: true }),
      /1,433-file deployment gate/u,
    );
    const target = path.join(data.root, "public", "subtitles-runtime");
    assert.equal(validated.formalReady, false);
    assert.throws(
      () => installSemanticRuntimePackage(validated, target),
      /formal 1,433-(?:file|audio) gate/u,
    );
    installSemanticRuntimePackage(validated, target, { allowPartial: true });
    assert.deepEqual(
      fs.readdirSync(target, { recursive: true }).sort(),
      fs.readdirSync(data.packageRoot, { recursive: true }).sort(),
    );
    assert.equal(fs.existsSync(path.join(data.root, "public", "subtitles")), false);
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

test("semantic runtime importer rejects an orphan runtime file before it can install", async () => {
  const data = fixture();
  try {
    fs.writeFileSync(path.join(data.packageRoot, "timing", "orphan.hxm"), "not in manifest");
    await assert.rejects(validateSemanticRuntimePackage(data.packageRoot), /orphan/u);
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

test("semantic runtime importer rejects terminal-unavailable partitions", async () => {
  const data = fixture();
  try {
    const registryBytes = Buffer.from(`${JSON.stringify(formalTerminalRegistry(), null, 2)}\n`);
    fs.writeFileSync(path.join(data.packageRoot, "terminal-unavailable.json"), registryBytes);
    const manifestPath = path.join(data.packageRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.terminal_unavailable_sha256 = crypto.createHash("sha256").update(registryBytes).digest("hex");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      validateSemanticRuntimePackage(data.packageRoot, undefined, { requireFormalCorpus: true }),
      /may not bind terminal-unavailable placeholders/u,
    );
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});
