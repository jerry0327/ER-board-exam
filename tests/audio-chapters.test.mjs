import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AudioChapterError,
  chapterMetadataUrlFor,
  currentAudioChapterAt,
  currentSubtitleCueAt,
  level1AudioChapterMarkers,
  loadAudioChapters,
  parseSubtitleSource,
  playerSecondsForChapter,
  validateAudioChapterMetadata,
} from "../app/lib/audio-chapters.ts";
import { QUESTION_BANK_CONTENT_ID_OVERRIDES } from "../app/lib/question-bank-content-id-overrides.ts";
import {
  siteSecondsFromSourceSeconds,
  sourceSecondsFromSiteSeconds,
} from "../app/lib/audio-playback.ts";

const SOURCE_SHA256 = "a".repeat(64);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function timestamp(seconds) {
  return `00:00:${String(seconds).padStart(2, "0")}.000`;
}

function sourceText(cueCount = 7) {
  const lines = [JSON.stringify({
    schema: "precision-src-v2",
    source: "105-Q006-Q010.m4a",
    collection: "question-bank",
    chapter: "105-Q006-Q010",
    title: "105-Q006-Q010",
    timebase: "source-content-1.0x",
    speaker_map: { A: "lower", B: "higher" },
  })];
  for (let index = 0; index < cueCount; index += 1) {
    lines.push(JSON.stringify({
      start: timestamp(index),
      end: timestamp(index + 1),
      speaker: "A",
      text: `cue ${index + 1}`,
    }));
  }
  return `${lines.join("\n")}\n`;
}

function l1(index, title, startCue, endCue, children = []) {
  return {
    id: `l1-${String(index).padStart(2, "0")}`,
    level: 1,
    title,
    start: timestamp(startCue - 1),
    end: timestamp(endCue),
    start_cue: startCue,
    end_cue: endCue,
    children,
  };
}

function questionBankMetadata() {
  const titles = [
    "導論",
    "105-Q006",
    "105-Q008",
    "105-Q009",
    "105-Q007",
    "105-Q010",
    "總結",
  ];
  return {
    schema: "subtitle-chapters-v1",
    source: "105-Q006-Q010.src",
    source_sha256: SOURCE_SHA256,
    profile: "question-bank-five",
    chapters: titles.map((title, index) => {
      const cue = index + 1;
      return l1(index + 1, title, cue, cue, index > 0 && index < 6 ? [{
        id: `l1-${String(index + 1).padStart(2, "0")}-l2-01`,
        level: 2,
        type: "topic_label",
        title: `${title} 主題重點`,
        start: timestamp(index),
        end: timestamp(index + 1),
        start_cue: cue,
        end_cue: cue,
      }] : []);
    }),
  };
}

function studyMetadata() {
  return {
    schema: "subtitle-chapters-v1",
    source: "study-CH001.src",
    source_sha256: SOURCE_SHA256,
    profile: "textbook-study",
    chapters: [
      l1(1, "導論", 1, 1),
      l1(2, "臨床毒性", 2, 4, [{
        id: "l1-02-l2-01",
        level: 2,
        type: "subsection",
        title: "急性毒性",
        start: timestamp(1),
        end: timestamp(3),
        start_cue: 2,
        end_cue: 3,
      }, {
        id: "l1-02-l2-02",
        level: 2,
        type: "subsection",
        title: "血清素毒性",
        start: timestamp(3),
        end: timestamp(4),
        start_cue: 4,
        end_cue: 4,
      }]),
      l1(3, "急診處置", 5, 6),
      l1(4, "總結", 7, 7),
    ],
  };
}

test("same-stem chapter URL preserves query and fragment", () => {
  assert.equal(
    chapterMetadataUrlFor("/audio/105-Q006-Q010.src?v=4#player"),
    "/audio/105-Q006-Q010.chapters.json?v=4#player",
  );
  assert.throws(() => chapterMetadataUrlFor("/audio/file.json"), AudioChapterError);
});

test("player and canonical source timelines round-trip at the 1.2x site baseline", () => {
  assert.equal(siteSecondsFromSourceSeconds(120), 100);
  assert.equal(sourceSecondsFromSiteSeconds(100), 120);
});

test("Question Bank validator preserves verified nonnumeric audio order", () => {
  const metadata = validateAudioChapterMetadata(
    questionBankMetadata(),
    parseSubtitleSource(sourceText()),
    "105-Q006-Q010.src",
  );
  assert.deepEqual(
    metadata.chapters.slice(1, 6).map((chapter) => chapter.title),
    ["105-Q006", "105-Q008", "105-Q009", "105-Q007", "105-Q010"],
  );
});

test("Question Bank content-ID overrides require the exact immutable SRC hash", () => {
  const metadata = questionBankMetadata();
  metadata.source = "115A-Q131-Q135.src";
  metadata.source_sha256 = "63e2f8d1bb7a9f45647d113acd26b5aab88a6ff64098c535196d0b23310438f4";
  ["115A-Q136", "115A-Q137", "115A-Q138", "115A-Q139", "115A-Q140"].forEach((title, index) => {
    metadata.chapters[index + 1].title = title;
  });
  const subtitle = parseSubtitleSource(sourceText().replaceAll("105-Q006-Q010", "115A-Q131-Q135"));
  assert.deepEqual(
    validateAudioChapterMetadata(metadata, subtitle, metadata.source).chapters.slice(1, 6).map((chapter) => chapter.title),
    ["115A-Q136", "115A-Q137", "115A-Q138", "115A-Q139", "115A-Q140"],
  );
  metadata.source_sha256 = "0".repeat(64);
  assert.throws(
    () => validateAudioChapterMetadata(metadata, subtitle, metadata.source),
    /override source hash/u,
  );
});

test("browser Question Bank override projection stays identical to the formal registry", (t) => {
  const registryPath = path.join(workspaceRoot, "specs", "question-bank-content-id-overrides.v1.json");
  if (!fs.existsSync(registryPath)) {
    t.skip("external workspace registry is not present in this standalone checkout");
    return;
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const expected = Object.fromEntries(Object.entries(registry.overrides).map(([source, value]) => [source, {
    sourceSha256: value.source_sha256,
    questionIds: value.question_ids,
  }]));
  assert.deepEqual(QUESTION_BANK_CONTENT_ID_OVERRIDES, expected);
});

test("validator rejects stale source names, review fields, and fabricated cue starts", () => {
  const subtitle = parseSubtitleSource(sourceText());
  assert.throws(
    () => validateAudioChapterMetadata(
      { ...questionBankMetadata(), source: "other.src" },
      subtitle,
      "105-Q006-Q010.src",
    ),
    /must equal/u,
  );
  assert.throws(
    () => validateAudioChapterMetadata(
      { ...questionBankMetadata(), confidence: 0.99 },
      subtitle,
      "105-Q006-Q010.src",
    ),
    /non-player fields/u,
  );
  const badTimeline = questionBankMetadata();
  badTimeline.chapters[2].start = "00:00:01.500";
  assert.throws(
    () => validateAudioChapterMetadata(badTimeline, subtitle, badTimeline.source),
    /align|gap or overlap/u,
  );
});

test("study L2 must partition its parent without gaps", () => {
  const metadata = studyMetadata();
  metadata.chapters[1].children[0].end = timestamp(2);
  assert.throws(
    () => validateAudioChapterMetadata(metadata, parseSubtitleSource(sourceText()), metadata.source),
    /L2 gap or overlap/u,
  );
});

test("current L1/L2 lookup accepts player time and converts to canonical source time", () => {
  const metadata = validateAudioChapterMetadata(
    studyMetadata(),
    parseSubtitleSource(sourceText()),
    "study-CH001.src",
  );
  assert.equal(currentAudioChapterAt(metadata, 0)?.l1.title, "導論");
  assert.equal(currentAudioChapterAt(metadata, 2.5)?.l2?.title, "血清素毒性");
  assert.equal(currentAudioChapterAt(metadata, 7 / 1.2)?.l1.title, "總結");
  assert.equal(currentAudioChapterAt(metadata, 7 / 1.2 + 0.001), null);
  assert.equal(playerSecondsForChapter(metadata.chapters[1].children[1]), 2.5);
});

test("current subtitle lookup converts player time and preserves real cue gaps", () => {
  const subtitle = parseSubtitleSource(sourceText());
  assert.equal(currentSubtitleCueAt(subtitle, 2.5 / 1.2)?.text, "cue 3");
  assert.equal(currentSubtitleCueAt(subtitle, 7 / 1.2), null);

  const withGap = parseSubtitleSource(sourceText().replace(
    '"start":"00:00:03.000","end":"00:00:04.000"',
    '"start":"00:00:03.250","end":"00:00:04.000"',
  ));
  assert.equal(currentSubtitleCueAt(withGap, 3.1 / 1.2), null);
  assert.equal(currentSubtitleCueAt(withGap, 3.25 / 1.2)?.text, "cue 4");
});

test("progress marker projection contains only L1 and player-ready seek seconds", () => {
  const markers = level1AudioChapterMarkers(studyMetadata());
  assert.equal(markers.length, 4);
  assert.ok(markers.every((marker) => marker.level === 1));
  assert.ok(!markers.some((marker) => marker.title === "血清素毒性"));
  assert.deepEqual(markers[1], {
    id: "l1-02",
    level: 1,
    title: "臨床毒性",
    sourceStartSeconds: 1,
    playerStartSeconds: 1 / 1.2,
  });
});

test("loader fetches same-stem SRC and chapters and verifies source hash", async () => {
  const requests = [];
  const fetcher = async (input) => {
    const url = String(input);
    requests.push(url);
    return url.endsWith(".src")
      ? new Response(sourceText())
      : Response.json(questionBankMetadata());
  };
  const loaded = await loadAudioChapters("/audio/105-Q006-Q010.src", {
    fetch: fetcher,
    sha256: async () => SOURCE_SHA256,
  });
  assert.deepEqual(requests, [
    "/audio/105-Q006-Q010.src",
    "/audio/105-Q006-Q010.chapters.json",
  ]);
  assert.equal(loaded.subtitle.cues.length, 7);
  assert.equal(loaded.metadata.profile, "question-bank-five");
  await assert.rejects(
    loadAudioChapters("/audio/105-Q006-Q010.src", {
      fetch: fetcher,
      sha256: async () => "b".repeat(64),
    }),
    /does not match/u,
  );
});
