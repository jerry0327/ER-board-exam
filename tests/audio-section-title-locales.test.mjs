import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  bindSectionTitleLocales,
  loadSectionTitleLocales,
  localizedSectionTitle,
} from "../app/lib/audio-section-title-locales.ts";

function canonical(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const sourceSha256 = "1".repeat(64);
  const chaptersSha256 = "2".repeat(64);
  const source = {
    id: "fixture",
    collectionId: "goldfrank",
    collectionTitle: "Goldfrank",
    kind: "chapter",
    sequence: 1,
    textbook: "Goldfrank",
    chapterId: "fixture",
    chapterLabel: "Fixture",
    title: "Fixture",
    file: "fixture",
    durationSeconds: 10,
    encodedSpeed: 1,
    revision: "fixture",
    dataBytes: 1,
    dataSha256: "3".repeat(64),
    metadataBytes: 1,
    metadataSha256: "4".repeat(64),
  };
  const titles = {
    "l1-01": { "zh-TW": "導論", en: "Introduction" },
    "l1-02": { "zh-TW": "毒物處置", en: "Toxicology Management" },
    "l1-02-l2-01": { "zh-TW": "初始評估", en: "Initial Assessment" },
    "l1-03": { "zh-TW": "總結", en: "Summary" },
  };
  const bundle = canonical({
    schema: "section-title-locale-bundle-v1",
    collection: "goldfrank",
    entries: {
      "goldfrank/fixture.src": { source_sha256: sourceSha256, chapters_sha256: chaptersSha256, titles },
    },
  });
  const manifest = canonical({
    schema: "section-title-locale-pack-v1",
    generated_at: "2026-08-14T00:00:00Z",
    counts: { collection_count: 1, pair_count: 1, title_count: 4 },
    bundles: [{
      collection: "goldfrank",
      path: "bundles/goldfrank.titles.json",
      sha256: sha256(bundle),
      bytes: bundle.length,
      entry_count: 1,
      title_count: 4,
    }],
    entries: [{
      source: "goldfrank/fixture.src",
      source_sha256: sourceSha256,
      chapters_sha256: chaptersSha256,
      bundle: "bundles/goldfrank.titles.json",
      title_count: 4,
    }],
  });
  const files = new Map([
    ["/subtitles-title-locales/manifest.json", manifest],
    ["/subtitles-title-locales/bundles/goldfrank.titles.json", bundle],
  ]);
  const fetch = async (input) => {
    const pathname = new URL(String(input), "https://example.test").pathname;
    return files.has(pathname) ? new Response(files.get(pathname)) : new Response("missing", { status: 404 });
  };
  const metadata = {
    schema: "subtitle-chapters-v1",
    source: "fixture.src",
    source_sha256: sourceSha256,
    profile: "textbook-study",
    chapters: [
      { id: "l1-01", level: 1, title: "導論", start: "00:00:00.000", end: "00:00:01.000", start_cue: 1, end_cue: 1, children: [] },
      { id: "l1-02", level: 1, title: "毒物處置", start: "00:00:01.000", end: "00:00:09.000", start_cue: 2, end_cue: 9, children: [
        { id: "l1-02-l2-01", level: 2, type: "subsection", title: "初始評估", start: "00:00:01.000", end: "00:00:09.000", start_cue: 2, end_cue: 9 },
      ] },
      { id: "l1-03", level: 1, title: "總結", start: "00:00:09.000", end: "00:00:10.000", start_cue: 10, end_cue: 10, children: [] },
    ],
  };
  return { fetch, source, sourceSha256, chaptersSha256, metadata };
}

test("Section title locale loader is hash-bound, pure-English, and timestamp-free", async () => {
  const value = fixture();
  const locales = await loadSectionTitleLocales(value.source, {
    fetch: value.fetch,
    expectedSourceSha256: value.sourceSha256,
    expectedChaptersSha256: value.chaptersSha256,
  });
  bindSectionTitleLocales(locales, value.metadata);
  assert.equal(localizedSectionTitle(locales, "l1-02", "毒物處置", "en"), "Toxicology Management");
  assert.equal(localizedSectionTitle(locales, "l1-02", "毒物處置", "zh-TW"), "毒物處置");
  assert.equal(JSON.stringify(locales).includes("00:00"), false);
});

test("Section title locale loader rejects a hash drift before display", async () => {
  const value = fixture();
  await assert.rejects(
    loadSectionTitleLocales(value.source, {
      fetch: value.fetch,
      expectedSourceSha256: "f".repeat(64),
      expectedChaptersSha256: value.chaptersSha256,
    }),
    /source hash/u,
  );
});
