import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadRuntimeSemanticAudioChapters,
  validateRuntimeSemanticSubtitleManifest,
} from "../app/lib/audio-runtime-semantic-package.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const builder = path.join(workspaceRoot, "scripts", "build_subtitle_runtime_semantic_pack.py");

function timestamp(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-semantic-package-"));
  const sourceRoot = path.join(root, "source");
  const chapterRoot = path.join(root, "chapters");
  const sourceDirectory = path.join(sourceRoot, "goldfrank");
  const chapterDirectory = path.join(chapterRoot, "goldfrank");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(chapterDirectory, { recursive: true });
  const starts = [0, 1000, 2030, 3030];
  const ends = [1000, 2000, 3030, 4030];
  const source = `${[
    JSON.stringify({
      schema: "precision-src-v2", source: "fixture.m4a", collection: "goldfrank", chapter: "fixture", title: "fixture",
      timebase: "source-content-1.0x",
      speaker_map: { A: "lower-pitched canonical voice", B: "higher-pitched canonical voice" },
    }),
    ...starts.map((start, index) => JSON.stringify({
      start: timestamp(start), end: timestamp(ends[index]), speaker: index < 2 ? "A" : "B", text: `cue ${index + 1}`,
    })),
  ].join("\n")}\n`;
  const chapters = {
    schema: "subtitle-chapters-v1",
    source: "fixture.src",
    source_sha256: crypto.createHash("sha256").update(source).digest("hex"),
    profile: "textbook-study",
    chapters: [
      { id: "l1-01", level: 1, title: "導論", start: timestamp(0), end: timestamp(2030), start_cue: 1, end_cue: 2, children: [] },
      { id: "l1-02", level: 1, title: "總結", start: timestamp(2030), end: timestamp(4030), start_cue: 3, end_cue: 4, children: [] },
    ],
  };
  fs.writeFileSync(path.join(sourceDirectory, "fixture.src"), source);
  fs.writeFileSync(path.join(chapterDirectory, "fixture.chapters.json"), `${JSON.stringify(chapters, null, 2)}\n`);
  const output = path.join(root, "runtime");
  const built = spawnSync("python", [
    builder, "--source-root", sourceRoot, "--chapters-root", chapterRoot, "--output", output,
    "--collections", "goldfrank", "--bundle-size", "20", "--generated-at", "2026-08-13T00:00:00Z",
  ], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const files = new Map();
  for (const file of fs.readdirSync(output, { recursive: true })) {
    const absolute = path.join(output, file);
    if (fs.statSync(absolute).isFile()) files.set(`/subtitles-runtime/${file.split(path.sep).join("/")}`, fs.readFileSync(absolute));
  }
  return { root, files, manifest: JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8")) };
}

function fetchFrom(files, requests) {
  return async (input) => {
    const url = new URL(String(input), "https://example.test");
    requests.push(url.pathname);
    const bytes = files.get(url.pathname);
    return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
  };
}

test("semantic runtime loader fetches only HXT bundle/HXM and rebuilds the standard player pair", async () => {
  const data = fixture();
  try {
    const requests = [];
    const loaded = await loadRuntimeSemanticAudioChapters({
      id: "goldfrank-fixture", collectionId: "goldfrank", file: "releases/hash/fixture",
    }, { fetch: fetchFrom(data.files, requests) });
    assert.equal(loaded.subtitle.cues.length, 4);
    assert.equal(loaded.metadata.chapters[0].end, "00:00:02.030");
    assert.equal(loaded.runtime.checkpointStride, 64);
    assert.equal(requests.length, 3);
    assert.ok(requests.includes("/subtitles-runtime/manifest.json"));
    assert.ok(requests.some((value) => value.includes("/bundles/") && value.endsWith(".hxtb")));
    assert.ok(requests.some((value) => value.includes("/timing/") && value.endsWith(".hxm")));
    assert.equal(requests.some((value) => value.endsWith(".src") || value.endsWith(".chapters.json")), false);
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

test("semantic runtime loader fails closed for a changed HXM sidecar or an extra manifest field", async () => {
  const data = fixture();
  try {
    const mutated = new Map(data.files);
    const hxmPath = [...mutated.keys()].find((value) => value.endsWith(".hxm"));
    const hxm = new Uint8Array(mutated.get(hxmPath));
    hxm[12] ^= 1;
    mutated.set(hxmPath, hxm);
    await assert.rejects(loadRuntimeSemanticAudioChapters({
      id: "goldfrank-fixture", collectionId: "goldfrank", file: "releases/hash/fixture",
    }, { fetch: fetchFrom(mutated, []) }), /HXM sidecar SHA-256/u);
    assert.throws(() => validateRuntimeSemanticSubtitleManifest({
      ...data.manifest,
      debug: true,
    }), /unsupported|noncanonical/u);
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

test("runtime manifest rejects terminal-unavailable placeholders", async () => {
  const data = fixture();
  try {
    const registry = {
      schema: "subtitle-terminal-unavailable-registry-v1",
      generated_at: "2026-08-14T00:00:00Z",
      expected_audio_count: 1433,
      counts: {
        unavailable_count: 1,
        available_pair_target: 1432,
        by_collection: {
          "board-guides": 0, ems: 0, goldfrank: 1, "question-bank": 0, rosens: 0, tintinalli: 0,
        },
      },
      entries: [{
        collection: "goldfrank",
        source: "goldfrank/blocked.src",
        chapter_key: "goldfrank/blocked",
        status: "terminal-unavailable",
        decision_id: "terminal-block-fixture",
        authority: "manager-terminal-adjudication",
        raw_sha256: "0".repeat(64),
        evidence_sha256: "1".repeat(64),
        evidence_path: "outputs/evidence.json",
      }],
    };
    const files = new Map(data.files);
    const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`);
    const boundManifest = {
      ...data.manifest,
      terminal_unavailable_sha256: crypto.createHash("sha256").update(registryBytes).digest("hex"),
    };
    files.set("/subtitles-runtime/manifest.json", Buffer.from(`${JSON.stringify(boundManifest, null, 2)}\n`));
    files.set("/subtitles-runtime/terminal-unavailable.json", registryBytes);
    assert.throws(
      () => validateRuntimeSemanticSubtitleManifest(boundManifest),
      /may not bind unavailable placeholders/u,
    );
  } finally {
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});
