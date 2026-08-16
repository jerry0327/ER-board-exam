import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadAudioChapterPackage,
  subtitlePairForAudioSource,
  validateSubtitleSectionManifest,
} from "../app/lib/audio-chapter-package.ts";

const SOURCE_HASH = "a".repeat(64);
const CHAPTER_HASH = "b".repeat(64);

function timestamp(seconds) {
  return `00:00:${String(seconds).padStart(2, "0")}.000`;
}

function sourceText() {
  const lines = [JSON.stringify({
    schema: "precision-src-v2",
    source: "105-Q006-Q010.m4a",
    collection: "question-bank",
    chapter: "105-Q006-Q010",
    title: "105-Q006-Q010",
    timebase: "source-content-1.0x",
    speaker_map: { A: "lower", B: "higher" },
  })];
  for (let index = 0; index < 7; index += 1) {
    lines.push(JSON.stringify({
      start: timestamp(index),
      end: timestamp(index + 1),
      speaker: "A",
      text: `cue ${index + 1}`,
    }));
  }
  return `${lines.join("\n")}\n`;
}

function l1(index, title, children = []) {
  return {
    id: `l1-${String(index).padStart(2, "0")}`,
    level: 1,
    title,
    start: timestamp(index - 1),
    end: timestamp(index),
    start_cue: index,
    end_cue: index,
    children,
  };
}

function chapters() {
  const titles = ["導論", "105-Q006", "105-Q008", "105-Q009", "105-Q007", "105-Q010", "總結"];
  return {
    schema: "subtitle-chapters-v1",
    source: "105-Q006-Q010.src",
    source_sha256: SOURCE_HASH,
    profile: "question-bank-five",
    chapters: titles.map((title, offset) => l1(offset + 1, title, offset > 0 && offset < 6 ? [{
      id: `l1-${String(offset + 1).padStart(2, "0")}-l2-01`,
      level: 2,
      type: "topic_label",
      title: `${title} 主題重點`,
      start: timestamp(offset),
      end: timestamp(offset + 1),
      start_cue: offset + 1,
      end_cue: offset + 1,
    }] : [])),
  };
}

function manifest() {
  return {
    schema: "subtitle-player-section-manifest-v1",
    generated_at: "2026-08-13T00:00:00Z",
    counts: {
      collection_count: 1,
      pair_count: 1,
      cue_count: 7,
      chapter_count: 7,
      by_collection: { "question-bank": 1 },
    },
    pairs: [{
      collection: "question-bank",
      source: "question-bank/105/105-Q006-Q010.src",
      chapters: "question-bank/105/105-Q006-Q010.chapters.json",
      source_sha256: SOURCE_HASH,
      chapters_sha256: CHAPTER_HASH,
      profile: "question-bank-five",
      cue_count: 7,
      chapter_count: 7,
      duration: "00:00:07.000",
    }],
  };
}

const audioSource = {
  id: "questions-105_q006-q010",
  collectionId: "questions",
  file: "releases/0123456789abcdefabcd/105-Q006-Q010",
};

test("manifest maps an audio catalog item to a nested same-stem subtitle pair", () => {
  const parsed = validateSubtitleSectionManifest(manifest());
  assert.equal(subtitlePairForAudioSource(parsed, audioSource).source, "question-bank/105/105-Q006-Q010.src");
});

test("package loader fetches hash-versioned SRC and compact chapters independently", async () => {
  const requests = [];
  const fetcher = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === "/subtitles/manifest.json") return Response.json(manifest());
    if (url.includes(".chapters.json")) return Response.json(chapters());
    if (url.includes(".src")) return new Response(sourceText());
    return new Response("missing", { status: 404 });
  };
  const loaded = await loadAudioChapterPackage(audioSource, {
    fetch: fetcher,
    sha256: async () => SOURCE_HASH,
    chaptersSha256: async () => CHAPTER_HASH,
  });
  assert.equal(loaded.metadata.chapters.length, 7);
  assert.deepEqual(requests, [
    "/subtitles/manifest.json",
    `/subtitles/question-bank/105/105-Q006-Q010.src?v=${SOURCE_HASH}`,
    `/subtitles/question-bank/105/105-Q006-Q010.chapters.json?v=${CHAPTER_HASH}`,
  ]);
});

test("package loader rejects chapters whose bytes do not match the manifest hash", async () => {
  const fetcher = async (input) => String(input).includes(".chapters.json")
    ? Response.json(chapters())
    : new Response(sourceText());
  await assert.rejects(loadAudioChapterPackage(audioSource, {
    manifest: validateSubtitleSectionManifest(manifest()),
    fetch: fetcher,
    sha256: async () => SOURCE_HASH,
    chaptersSha256: async () => "c".repeat(64),
  }), /do not match the package manifest/u);
});

test("manifest rejects traversal, duplicate runtime fields, and inconsistent counts", () => {
  const traversal = manifest();
  traversal.pairs[0].source = "question-bank/../105-Q006-Q010.src";
  assert.throws(() => validateSubtitleSectionManifest(traversal), /unsafe|invalid/u);

  const extra = manifest();
  extra.pairs[0].confidence = 0.99;
  assert.throws(() => validateSubtitleSectionManifest(extra), /unsupported/u);

  const badCount = manifest();
  badCount.counts.cue_count = 8;
  assert.throws(() => validateSubtitleSectionManifest(badCount), /counts/u);
});

test("the audio player lazily loads subtitle navigation without blocking SNAC", async () => {
  const [provider, companion] = await Promise.all([
    readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/audio-section-companion.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(companion, /await import\("\.\.\/lib\/audio-runtime-semantic-package"\)/u);
  assert.match(companion, /loadRuntimeSemanticAudioChapters\(source\)/u);
  assert.doesNotMatch(companion, /import \{[\s\S]*?loadRuntimeSemanticAudioChapters[\s\S]*?\} from "\.\.\/lib\/audio-runtime-semantic-package"/u);
  assert.doesNotMatch(provider, /audio-runtime-semantic-package/u);
  assert.doesNotMatch(companion, /audio-chapter-package/u);
});
