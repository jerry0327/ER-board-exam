import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeStudyGuideDocumentTitle, sanitizeStudyGuideMarkdown } from "../app/lib/study-guide-markdown.ts";
import { logicalContentEntries } from "../scripts/lib/static-content-codec.mjs";

const [tintinalliCatalog, rosensCatalog, tintinalliView, rosensView] = await Promise.all([
  readFile(new URL("../app/data/tintinalli-chapters.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../app/data/rosens-chapters.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
]);
const packedContent = new Map(logicalContentEntries());
const tintinalliManifest = JSON.parse(packedContent.get("guides/manifest.json"));
const rosensManifest = JSON.parse(packedContent.get("guides/rosens/manifest.json"));

function normalizedMarkdown(value) {
  return value.replace(/\r\n?/gu, "\n");
}

function rootH1Ranges(markdown) {
  return [...markdown.matchAll(/^#(?:[\t ]+|$)(.*)$/gmu)].map((match) => ({
    end: match.index + match[0].length,
    label: match[1].trim(),
    start: match.index,
  }));
}

function headingLabel(markdown, heading) {
  return heading.label ?? markdown.slice(heading.start, heading.end).match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? "";
}

function maskFirstRootH1(markdown) {
  const normalized = normalizedMarkdown(markdown);
  const [first] = rootH1Ranges(normalized);
  assert(first, "guide must contain a root H1");
  return `${normalized.slice(0, first.start)}# [DOCUMENT TITLE]${normalized.slice(first.end)}`;
}

function assertCanonicalDocumentTitle(raw, canonicalTitle, sourceLabel) {
  const normalizedRaw = normalizedMarkdown(raw);
  const before = rootH1Ranges(normalizedRaw);
  assert.ok(before.length > 0, `${sourceLabel} must contain a source H1`);

  const learner = normalizeStudyGuideDocumentTitle(normalizedRaw, canonicalTitle);
  const after = rootH1Ranges(learner);
  assert.equal(after.length, before.length, `${sourceLabel} must not gain a duplicate H1`);
  assert.equal(headingLabel(learner, after[0]), canonicalTitle, `${sourceLabel} must use its canonical English H1`);
  assert.equal(maskFirstRootH1(learner), maskFirstRootH1(normalizedRaw), `${sourceLabel} body content must remain byte-for-byte intact`);
}

test("document-title normalization replaces one H1 without losing learner content", () => {
  const source = "# 第 1 章｜休克（速讀版）\n\n## 1. Core physiology\n\n正文與 **clinical content** 保留。\n";
  const sanitized = sanitizeStudyGuideMarkdown(source);
  const learner = normalizeStudyGuideDocumentTitle(sanitized, "Shock");
  const headings = rootH1Ranges(learner);
  assert.equal(headings.length, 1);
  assert.equal(headingLabel(learner, headings[0]), "Shock");
  assert.match(learner, /## 1\. Core physiology/u);
  assert.match(learner, /正文與 \*\*clinical content\*\* 保留。/u);

  const titleless = "## Assessment\n\nBody remains available.\n";
  const repaired = normalizeStudyGuideDocumentTitle(titleless, "Airway");
  assert.equal(rootH1Ranges(repaired).length, 1);
  assert.equal(headingLabel(repaired, rootH1Ranges(repaired)[0]), "Airway");
  assert.ok(repaired.endsWith(titleless));
});

test("all 2,442 Tintinalli and Rosen learner variants normalize to canonical English H1 titles", () => {
  let audited = 0;
  for (const chapter of tintinalliManifest.chapters) {
    const canonical = tintinalliCatalog.chapters[chapter.id - 1];
    assert.equal(canonical.id, String(chapter.id).padStart(3, "0"));
    assert.doesNotMatch(canonical.title, /\p{Script=Han}/u);
    for (const [packId, pack] of Object.entries(chapter.contents)) {
      for (const [mode, content] of Object.entries(pack.modes)) {
        const logicalPath = content.markdownPath.slice(1);
        const bytes = packedContent.get(logicalPath);
        assert(bytes, logicalPath);
        assertCanonicalDocumentTitle(Buffer.from(bytes).toString("utf8"), canonical.title, `Tintinalli ${canonical.id} ${packId}/${mode}`);
        audited += 1;
      }
    }
  }

  for (const [index, chapter] of rosensManifest.chapters.entries()) {
    const canonical = rosensCatalog.chapters[index];
    assert.equal(chapter.sourceSequence, canonical.number);
    assert.doesNotMatch(canonical.title, /\p{Script=Han}/u);
    for (const [mode, content] of Object.entries(chapter.modes)) {
      const logicalPath = content.markdownPath.slice(1);
      const bytes = packedContent.get(logicalPath);
      assert(bytes, logicalPath);
      assertCanonicalDocumentTitle(Buffer.from(bytes).toString("utf8"), canonical.title, `Rosen ${canonical.id} ${mode}`);
      audited += 1;
    }
  }

  assert.equal(audited, (303 * 2 * 3) + (208 * 3));
});

test("Tintinalli and Rosen readers normalize then suppress the repeated document H1", () => {
  assert.match(tintinalliView, /normalizeStudyGuideDocumentTitle\(\s*sanitizeStudyGuideMarkdown\(loadedMarkdown\),\s*selectedChapter\?\.title \?\? ""/u);
  assert.match(rosensView, /normalizeStudyGuideDocumentTitle\(\s*sanitizeStudyGuideMarkdown\(visibleGuide\.markdown\),\s*selectedChapter\.title/u);
  for (const view of [tintinalliView, rosensView]) {
    assert.match(view, /<MarkdownContent markdown=\{markdown\} variant="guide" documentTitle=\{selectedChapter\.title\}/u);
  }
});
