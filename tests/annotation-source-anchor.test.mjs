import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  annotationBlockAnchor,
  annotationBlockAnchorFrom,
  annotationBlockKey,
  annotationBlockMetadata,
  annotationBlockScopeFrom,
  annotationBlockSourceOffset,
  annotationCanonicalHeadingKey,
  excerptBlockKind,
  firstMarkdownH1Excerpt,
  nearestAnnotationSourceOffset,
} from "../app/lib/annotation-block-anchor.ts";

test("source block anchors are deterministic, bounded, and disambiguate repeated blocks", () => {
  const markdown = "## 核心理由";
  const first = annotationBlockAnchor("heading", markdown, 120);
  const again = annotationBlockAnchor("heading", markdown, 120);
  const repeated = annotationBlockAnchor("heading", markdown, 420);
  assert.equal(first, again);
  assert.notEqual(first, repeated);
  assert.match(first, /^annotation-heading-[a-z0-9]+-[a-z0-9]+$/u);
  assert.equal(annotationBlockKey("heading", markdown), annotationBlockKey("heading", `${markdown}\r\n`));
});

test("excerpt anchor and reading scope round-trip through the existing prefix field", () => {
  const anchor = annotationBlockAnchor("table", "| A | B |\n| - | - |", 640);
  const prefix = annotationBlockMetadata(anchor, "quick");
  assert.ok(prefix.length <= 80, "server prefix limit remains intact");
  assert.equal(annotationBlockAnchorFrom({ kind: "excerpt", prefix }), anchor);
  assert.equal(annotationBlockScopeFrom({ kind: "excerpt", prefix }), "quick");
  assert.equal(annotationBlockAnchorFrom({ kind: "highlight", prefix }), null);
  assert.equal(annotationBlockMetadata("unsafe anchor", "quick"), "");
  assert.ok(annotationBlockMetadata(anchor, "x".repeat(24)).length <= 80);
});

test("old Markdown excerpts retain a content-key fallback", () => {
  assert.equal(excerptBlockKind("## 診斷"), "heading");
  assert.equal(excerptBlockKind("診斷\n---"), "heading");
  assert.equal(excerptBlockKind("| 疾病 | 線索 |\n| --- | --- |"), "table");
  assert.equal(excerptBlockKind("一般段落"), null);
});

test("canonical heading identity survives structural outline rewrites", () => {
  const equivalent = [
    ["## 一、急救流程", "## 1. 急救流程"],
    ["### 2. 鑑別診斷", "### 1.1 鑑別診斷"],
    ["#### A. 呼吸道", "#### 呼吸道"],
    ["#### **B. bCAM**", "#### **bCAM**"],
    ["### B. bronchoscopy", "### 1.1 bronchoscopy"],
    ["急救流程\n---", "## 1. 急救流程"],
    ["## Step 2：再評估", "## 3. 再評估"],
    ["## 第 2 步：再評估", "## 3. 再評估"],
    ["## Part IV　特殊族群", "## 4. 特殊族群"],
    ["### Part B. 處置", "### 4.2 處置"],
    ["### 三、2. 重複編號", "### 4.2 重複編號"],
  ];
  for (const [before, after] of equivalent) {
    assert.equal(
      annotationCanonicalHeadingKey(before),
      annotationCanonicalHeadingKey(after),
      `${before} should remain addressable as ${after}`,
    );
  }
});

test("canonical heading identity protects medical values and abbreviated taxa", () => {
  const semanticHeadings = [
    ["## H. pylori", "## pylori"],
    ["## C. difficile", "## difficile"],
    ["## S. aureus", "## aureus"],
    ["#### K. kingae：關節感染", "#### kingae：關節感染"],
    ["#### `P. vivax`／`P. ovale`", "#### `vivax`／`ovale`"],
    ["## 0.9% saline", "## saline"],
    ["## 1.5 mg atropine", "## atropine"],
    ["## 2:1 block", "## block"],
    ["## 9-1-1 system", "## system"],
    ["## 2025 AHA 目標", "## AHA 目標"],
  ];
  for (const [semantic, stripped] of semanticHeadings) {
    assert.notEqual(
      annotationCanonicalHeadingKey(semantic),
      annotationCanonicalHeadingKey(stripped),
      `${semantic} must retain its semantic prefix`,
    );
  }
});

test("legacy and current source offsets select only a uniquely nearest duplicate heading", () => {
  const anchor = annotationBlockAnchor("heading", "## 一、重複標題", 420);
  assert.equal(annotationBlockSourceOffset(anchor), 420);
  assert.equal(annotationBlockSourceOffset("unsafe"), null);
  assert.equal(nearestAnnotationSourceOffset(420, [80, 415, 900]), 1);
  assert.equal(nearestAnnotationSourceOffset(420, [410, 430]), null);
  assert.equal(nearestAnnotationSourceOffset(420, [null, 430]), 1);
});

test("the visible Guide title uses the first real H1 and its exact source offset", () => {
  const markdown = [
    "```text",
    "# fenced example",
    "```",
    "",
    "前言",
    "",
    "# 真正章節標題",
    "",
    "正文",
  ].join("\n");
  const excerpt = firstMarkdownH1Excerpt(markdown, "目錄章名");
  const sourceOffset = markdown.indexOf("# 真正章節標題");
  assert.deepEqual(excerpt, {
    markdown: "# 真正章節標題\n\n正文",
    block: "heading",
    label: "主標題",
    sourceAnchor: annotationBlockAnchor("heading", "# 真正章節標題\n\n正文", sourceOffset),
  });

  const fallback = firstMarkdownH1Excerpt("## 第一節", "目錄章名");
  assert.equal(fallback.markdown, "# 目錄章名\n\n## 第一節");
  assert.equal(fallback.sourceAnchor, annotationBlockAnchor("heading", "# 目錄章名\n\n## 第一節", 0));
});

test("Reader and Guide share exact source return metadata and focus behavior", async () => {
  const [types, markdown, tools, reader, guide, hook, api, handoff] = await Promise.all([
    readFile(new URL("../app/lib/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-annotations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
  ]);
  assert.match(types, /sourceAnchor: string/u);
  assert.match(markdown, /data-annotation-anchor/u);
  assert.match(markdown, /data-annotation-block-key/u);
  assert.match(markdown, /data-annotation-canonical-heading-key/u);
  assert.match(markdown, /data-annotation-source-offset/u);
  assert.match(markdown, /tabIndex=\{-1\}/u);
  assert.match(tools, /prefix: annotationBlockMetadata\(pendingExcerpt\.sourceAnchor, source\.contentScope\)/u);
  assert.match(tools, /locateExcerptBlock\(root, requestedAnnotation, source\.resourceId\)/u);
  assert.match(tools, /nearestAnnotationSourceOffset\(/u);
  assert.match(tools, /scrollElementIntoView\(target, \{ block: "center" \}\)/u);
  assert.match(tools, /import \{ scrollElementIntoView \} from "\.\.\/lib\/motion"/u);
  assert.match(tools, /excerptTarget\?\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(tools, /returnTargetRef\.current = root[\s\S]{0,180}pendingExcerpt\.sourceAnchor/u);
  assert.match(tools, /const target = returnTargetRef\.current;\s*returnTargetRef\.current = null;/u);
  assert.doesNotMatch(tools, /requestedRange\?\.startContainer\.parentElement \?\? root/u);
  assert.match(reader, /annotationBlockScopeFrom\(requestedAnnotation\)/u);
  assert.match(reader, /contentScope: displayedExplanationMode/u);
  assert.match(guide, /contentScope: annotationMode/u);
  assert.match(hook, /prefix: draft\.prefix \?\? existing\?\.prefix \?\? ""/u);
  assert.match(api, /prefix: body\.annotation\.prefix/u);
  assert.match(handoff, /穩定來源區塊 anchor 與閱讀深度/u);
});
