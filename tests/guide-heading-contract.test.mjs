import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { createHeadingSlugger, extractMarkdownOutline, plainMarkdownHeading } from "../app/lib/markdown-heading.ts";

const catalog = JSON.parse(await readFile(new URL("../public/guides/manifest.json", import.meta.url), "utf8"));
const availablePacks = catalog.packs.filter((pack) => pack.status === "available");

function sourceHeadings(markdown) {
  let fence = null;
  const headings = [];
  for (const line of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^(#{1,4})[\t ]+(.+?)(?:[\t ]+#+[\t ]*)?$/u);
    if (match) headings.push({ level: match[1].length, label: plainMarkdownHeading(match[2]) });
  }
  return headings;
}

test("all available 303-chapter packs expose every H1-H4 section after the document title", async () => {
  assert.deepEqual(availablePacks.map((pack) => pack.id), ["concise", "detailed"]);
  const categoryCoverage = { arabic: 0, chinese: 0, latin: 0, part: 0 };
  const h2Pattern = /^\d+\.\s+\S/u;
  const h3Pattern = /^\d+\.\d+\s+\S/u;
  const h4IntegerPrefix = /^(?:\(\d+\)|\d+[.)、：:])\s+\S/u;
  const h4HierarchyPrefix = /^\d+(?:\.\d+){1,3}\s+\S/u;
  const semanticDecimalValue = /^\d+(?:\.\d+)+(?:\s*%|\s+(?:mg|mcg|g|kg|mL|L|mEq|mmol|mol|mm|cm|m|°C|°F|Hz|kPa|mmHg|cells?|days?|hours?|minutes?)\b)/iu;
  const legacyChinesePrefix = /^[〇零一二三四五六七八九十百千壹貳參肆伍陸柒捌玖拾]+[、.)）：:]\s*/u;
  const legacyPartPrefix = /^Part\s+(?:\d+|[A-Z]|[IVXLCDM]+)\b/iu;
  const legacyStepPrefix = /^(?:Step\s+\d+|第\s*(?:\d+|[〇零一二三四五六七八九十百千]+)\s*步)\b/iu;

  for (const pack of availablePacks) {
    const fullRoot = new URL(`../public/guides/packs/${pack.id}/full/`, import.meta.url);
    const files = (await readdir(fullRoot)).filter((file) => /^chapter-\d{3}\.md$/u.test(file)).sort();
    assert.equal(files.length, 303, `${pack.id} should publish 303 full guides`);
    for (const file of files) {
      const sourceLabel = `${pack.id}/${file}`;
      const markdown = await readFile(new URL(file, fullRoot), "utf8");
      const headings = sourceHeadings(markdown);
      const outline = extractMarkdownOutline(markdown);
      assert.ok(headings.length > 1, `${sourceLabel} should contain a document title and sections`);
      assert.equal(outline.length, headings.length - 1, `${sourceLabel} outline dropped a source heading`);

      const slug = createHeadingSlugger();
      const expected = headings.map((heading) => ({ ...heading, id: slug(heading.label) })).slice(1);
      assert.deepEqual(outline, expected, `${sourceLabel} outline labels or anchors do not match rendered order`);
      assert.equal(new Set(outline.map((item) => item.id)).size, outline.length, `${sourceLabel} anchors must be unique`);

      for (const { level, label } of outline) {
        if (level === 2) {
          assert.match(label, h2Pattern, `${sourceLabel} H2 must use N. numbering: ${label}`);
        } else if (level === 3) {
          assert.match(label, h3Pattern, `${sourceLabel} H3 must use N.N numbering: ${label}`);
        } else if (level === 4) {
          assert.doesNotMatch(label, h4IntegerPrefix, `${sourceLabel} H4 must not use integer structural numbering: ${label}`);
          if (!semanticDecimalValue.test(label)) {
            assert.doesNotMatch(label, h4HierarchyPrefix, `${sourceLabel} H4 must not use hierarchical structural numbering: ${label}`);
          }
          assert.doesNotMatch(label, legacyChinesePrefix, `${sourceLabel} H4 must not use Chinese structural numbering: ${label}`);
          assert.doesNotMatch(label, legacyPartPrefix, `${sourceLabel} H4 must not use Part structural numbering: ${label}`);
          assert.doesNotMatch(label, legacyStepPrefix, `${sourceLabel} H4 must not use Step structural numbering: ${label}`);
        } else {
          assert.fail(`${sourceLabel} contains an unexpected H${level} after the document title: ${label}`);
        }
      }

      for (const { label } of outline) {
        if (/^\d+[.)、．:]\s*/u.test(label)) categoryCoverage.arabic += 1;
        if (/^[一二三四五六七八九十百]+[、.)．:]\s*/u.test(label)) categoryCoverage.chinese += 1;
        if (/^[A-Z][.)、．:]\s*/u.test(label)) categoryCoverage.latin += 1;
        if (/^Part\s+(?:[A-Z]|[IVXLC]+)\b/iu.test(label)) categoryCoverage.part += 1;
      }
    }
  }

  assert.ok(categoryCoverage.arabic > 1_000, "Arabic hierarchy should be represented");
  assert.equal(categoryCoverage.chinese, 0, "Chinese structural numbering should be normalized");
  assert.ok(categoryCoverage.latin <= 20, "Only a small number of semantic letter headings should remain");
  assert.equal(categoryCoverage.part, 0, "Part structural numbering should be normalized");
});

test("guide renderer and every outline surface share anchored H1-H4 behavior", async () => {
  const [renderer, guide] = await Promise.all([
    readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /h1: \(\{ children, node \}\)[\s\S]*?const headingId = headingSlug\(heading\);[\s\S]*?id=\{headingId\}/u);
  assert.match(guide, /extractMarkdownOutline\(markdown\)/u);
  assert.doesNotMatch(guide, /outline\.slice\(0,\s*10\)/u);
  assert.match(guide, /data-level=\{item\.level\}/u);
});

test("heading parser ignores fenced pseudo-headings and keeps duplicate anchors stable", () => {
  const markdown = "# 文件標題\n\n## 一、總覽\n\n```md\n# 不是標題\n```\n\n# Part A\n\n## 一、總覽\n\n#### A. 注意事項\n";
  assert.deepEqual(extractMarkdownOutline(markdown), [
    { level: 2, label: "一、總覽", id: "一-總覽" },
    { level: 1, label: "Part A", id: "part-a" },
    { level: 2, label: "一、總覽", id: "一-總覽-2" },
    { level: 4, label: "A. 注意事項", id: "a-注意事項" },
  ]);
});
