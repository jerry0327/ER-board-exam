import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isProductionMetadataNode,
  parseGuideMarkdown,
} from "../scripts/lib/study-guide-reading-modes.mjs";

const catalog = JSON.parse(await readFile(new URL("../public/guides/manifest.json", import.meta.url), "utf8"));
const linksText = await readFile(new URL("../public/guides/links.json", import.meta.url), "utf8");
const links = JSON.parse(linksText);
const questionIndex = JSON.parse(await readFile(new URL("../public/data/index.json", import.meta.url), "utf8"));
const questionManifest = JSON.parse(await readFile(new URL("../public/data/manifest.json", import.meta.url), "utf8"));
const authoredTierImporter = await readFile(
  new URL("../scripts/import-authored-guide-tiers.mjs", import.meta.url),
  "utf8",
);
const questionIds = new Set(questionIndex.questions.map((question) => question.id));

test("publishes a complete, unique 303-chapter catalog", () => {
  assert.equal(catalog.schemaVersion, 3);
  assert.equal(catalog.totalChapters, 303);
  assert.equal(catalog.chapters.length, 303);
  assert.equal(catalog.sections.length, 26);
  assert.deepEqual(catalog.chapters.map((chapter) => chapter.id), Array.from({ length: 303 }, (_, index) => index + 1));
  assert.equal(catalog.chapters[28].parts.length, 2, "Chapter 29 的 A/B 正文應合併在同一章入口");
});

test("publishes complete concise and detailed packs with independently authored reading modes", async () => {
  assert.equal(catalog.defaultPackId, "concise");
  assert.deepEqual(catalog.packs.map((pack) => pack.id), ["concise", "detailed"]);
  assert.deepEqual(catalog.packs.map((pack) => pack.status), ["available", "available"]);
  assert.deepEqual(catalog.packs.map((pack) => pack.importedChapters), [303, 303]);
  assert.deepEqual(catalog.packs.map((pack) => pack.sourceVersion), ["2026-07-17", "2026-07-18"]);
  assert.equal(catalog.importedChapters, 303);

  const expectedSourceVersions = { concise: "2026-07-17", detailed: "2026-07-18" };
  for (const packId of ["concise", "detailed"]) {
    for (const chapter of catalog.chapters) {
      const content = chapter.contents[packId];
      assert.equal(content.available, true, `Chapter ${chapter.id} ${packId} pack should be available`);
      assert.equal(content.sourceVersion, expectedSourceVersions[packId]);
      const markdownByMode = {};
      const hashes = new Set();
      for (const mode of ["quick", "focus", "full"]) {
        const entry = content.modes[mode];
        const directory = { quick: "quick", focus: "key-points", full: "full" }[mode];
        assert.match(entry.markdownPath, new RegExp(`^/guides/packs/${packId}/${directory}/chapter-${String(chapter.id).padStart(3, "0")}\\.md$`, "u"));
        const buffer = await readFile(new URL(`../public${entry.markdownPath}`, import.meta.url));
        markdownByMode[mode] = buffer.toString("utf8");
        const hash = createHash("sha256").update(buffer).digest("hex");
        assert.equal(buffer.length, entry.bytes, `Chapter ${chapter.id} ${packId}/${mode} byte count changed`);
        assert.equal(hash, entry.sourceSha256, `Chapter ${chapter.id} ${packId}/${mode} SHA-256 changed`);
        assert.equal(hash.slice(0, 16), entry.contentHash);
        hashes.add(hash);
        if (mode !== "full") {
          const parsed = parseGuideMarkdown(markdownByMode[mode]);
          assert.equal(parsed.nodes.some((item) => isProductionMetadataNode(item.node)), false, `Chapter ${chapter.id} ${packId}/${mode} retained production metadata`);
          assert.equal((markdownByMode[mode].match(/^#\s+\S+/gmu) ?? []).length, 1, `Chapter ${chapter.id} ${packId}/${mode} should have one H1`);
          assert.ok(buffer.length >= (mode === "quick" ? 1_000 : 4_000), `Chapter ${chapter.id} ${packId}/${mode} is too short`);
        }
      }
      assert.equal(hashes.size, 3, `Chapter ${chapter.id} ${packId} reading modes must be distinct`);
      assert.ok(content.modes.quick.bytes < content.modes.focus.bytes, `Chapter ${chapter.id} ${packId}/quick should be shorter than focus`);
      assert.ok(
        content.modes.focus.bytes <= content.modes.full.bytes + 64,
        `Chapter ${chapter.id} ${packId}/focus should not be materially longer than full`,
      );
      if (packId === catalog.defaultPackId) {
        assert.equal(chapter.markdownPath, content.modes.full.markdownPath, "legacy path should point to default pack full mode");
        assert.equal(chapter.contentHash, content.modes.full.contentHash);
      }
    }
  }
});

test("imports authored reading tiers without deriving them from the full guide", () => {
  for (const directory of [
    "02_learning_guides",
    "tintinalli-concise",
    "tintinalli-detailed",
    "rosens",
  ]) {
    assert.match(authoredTierImporter, new RegExp(directory, "u"));
  }
  for (const canonicalName of [
    "tintinalli-CH${padded}-${packDefinition.id}-standard.md",
    "tintinalli-CH${padded}-${packDefinition.id}-quick.md",
    "rosens-CH${padded}-standard.md",
    "rosens-CH${padded}-quick.md",
  ]) {
    assert.ok(authoredTierImporter.includes(canonicalName));
  }
  assert.doesNotMatch(authoredTierImporter, /buildFocusMarkdown|buildQuickMarkdown/u);
});

test("keeps every standard and quick guide as a complete authored article", async () => {
  const generatedScaffoldPattern = /^(?:> \*\*5 分鐘速讀\*\*|## (?:本章地圖|高產重點|注意事項與考題陷阱))$/mu;
  const internalVoicePattern = /(?:Target chapter|question_id|source_year|normalized\.final|題庫|考古題|考題|題號|原章|原文|教科書|教材|版本差異|依.*整理|整理如下)/iu;

  for (const packId of ["concise", "detailed"]) {
    for (const chapter of catalog.chapters) {
      const content = chapter.contents[packId];
      for (const mode of ["quick", "focus"]) {
        const markdown = await readFile(new URL(`../public${content.modes[mode].markdownPath}`, import.meta.url), "utf8");
        const parsed = parseGuideMarkdown(markdown);
        assert.equal(parsed.nodes.some((item) => isProductionMetadataNode(item.node)), false);
        assert.ok(parsed.nodes.filter((item) => item.heading).length >= 1, `Chapter ${chapter.id} ${packId}/${mode} lacks an article title`);
        assert.doesNotMatch(markdown, generatedScaffoldPattern, `Chapter ${chapter.id} ${packId}/${mode} still uses generated scaffold`);
        assert.doesNotMatch(markdown, internalVoicePattern, `Chapter ${chapter.id} ${packId}/${mode} retained internal/source voice`);
      }
    }
  }
});

test("renders the Chapter 223 H4 sequence without structural numbers or wording changes", async () => {
  const markdown = await readFile(new URL("../public/guides/packs/concise/full/chapter-223.md", import.meta.url), "utf8");
  const parsed = parseGuideMarkdown(markdown);
  const labels = parsed.nodes.filter((item) => item.heading?.depth === 4).map((item) => item.heading.label);
  assert.deepEqual(labels, [
    "單純hyperglycemia，尚無DKA",
    "Confirmed DKA或高度懷疑delivery failure",
    "Hypoglycemia",
    "NPO／procedure／MRI",
  ]);
  assert.equal(labels.every((label) => !/^\d+[.)]\s+/u.test(label)), true);
  assert.doesNotMatch(markdown, /^\*\*[1-4]\. .+\*\*$/mu);
});

test("exposes only confirmed chapter links and no private locator evidence", () => {
  assert.equal(links.sourceHash, questionManifest.sourceHash);
  assert.doesNotMatch(linksText, /pageStart|pageEnd|bookId|evidence|candidateChapters/u);
  for (const [questionId, chapters] of Object.entries(links.questionToChapters)) {
    assert.equal(questionIds.has(questionId), true, `unknown question ${questionId}`);
    assert.deepEqual(chapters, [...new Set(chapters)].sort((left, right) => left - right));
    assert.equal(chapters.every((chapter) => Number.isInteger(chapter) && chapter >= 1 && chapter <= 303), true);
  }
  assert.equal(Object.keys(links.questionToChapters).length, 2087);
  assert.equal(links.validation.ambiguousQuestionsExcluded, 191);
  assert.equal(links.validation.questionChapterLinks, 3604);
  assert.equal(links.validation.linkedChapters, 300);
});

test("keeps question-to-chapter and chapter-to-question directions consistent", () => {
  for (const [questionId, chapters] of Object.entries(links.questionToChapters)) {
    for (const chapter of chapters) assert.equal(links.chapterToQuestions[String(chapter)].includes(questionId), true);
  }
  for (const chapter of catalog.chapters) {
    assert.equal(chapter.linkedQuestionCount, links.chapterToQuestions[String(chapter.id)].length);
  }
});
