import assert from "node:assert/strict";
import test from "node:test";
import { annotationBlockAnchor, annotationBlockKey, firstMarkdownH1Excerpt } from "../app/lib/annotation-block-anchor.ts";
import { markdownHeadingRanges, markdownHeadingSection } from "../app/lib/markdown-section-excerpt.ts";
import { ANNOTATION_EXCERPT_QUOTE_LIMIT } from "../app/lib/annotation-limits.ts";

function section(markdown, headingText) {
  const headings = markdownHeadingRanges(markdown);
  const start = markdown.indexOf(headingText);
  const heading = headings.find((item) => item.start === start);
  assert.ok(heading, `missing heading: ${headingText}`);
  return markdownHeadingSection(markdown, heading.start, heading.end, heading.level, headings);
}

test("a heading excerpt includes prose, tables, and child headings until the next peer", () => {
  const markdown = [
    "## 評估",
    "",
    "先處理 ABC。",
    "",
    "### 檢查",
    "",
    "| 項目 | 判讀 |",
    "| --- | --- |",
    "| ECG | 心律 |",
    "",
    "#### 注意",
    "",
    "需要重複評估。",
    "",
    "## 治療",
    "",
    "下一節內容。",
  ].join("\n");

  const excerpt = section(markdown, "## 評估");
  assert.match(excerpt, /^## 評估/u);
  assert.match(excerpt, /先處理 ABC。/u);
  assert.match(excerpt, /### 檢查/u);
  assert.match(excerpt, /\| ECG \| 心律 \|/u);
  assert.match(excerpt, /#### 注意/u);
  assert.doesNotMatch(excerpt, /## 治療/u);
});

test("a child heading stops at its next peer while fenced pseudo-headings remain content", () => {
  const markdown = [
    "## 選項分析",
    "### A. 第一項",
    "理由 A。",
    "```text",
    "### 這不是標題",
    "```",
    "#### A 的補充",
    "補充內容。",
    "### B. 第二項",
    "理由 B。",
  ].join("\n");

  const excerpt = section(markdown, "### A. 第一項");
  assert.match(excerpt, /理由 A。/u);
  assert.match(excerpt, /### 這不是標題/u);
  assert.match(excerpt, /#### A 的補充/u);
  assert.doesNotMatch(excerpt, /### B\. 第二項/u);
});

test("setext sections and the final section preserve their complete source", () => {
  const markdown = "第一節\n---\n本文。\n\n第二節\n---\n最後本文。";
  assert.equal(section(markdown, "第一節"), "第一節\n---\n本文。");
  assert.equal(section(markdown, "第二節"), "第二節\n---\n最後本文。");
});

test("multiline setext headings keep every heading line and their section", () => {
  const markdown = "第一行\n第二行\n===\n本文。\n\n# 下一節";
  assert.equal(section(markdown, "第一行"), "第一行\n第二行\n===\n本文。");
});

test("blockquote headings form real boundaries while fenced headings remain inert", () => {
  const markdown = [
    "## 外層章節",
    "",
    "> ## 引言內章節",
    ">",
    "> 引言內容。",
    ">",
    "> ### 引言子節",
    ">",
    "> 子節內容。",
    ">",
    "> ## 下一個引言章節",
    ">",
    "> 不應包含。",
    "",
    "## 下一個外層章節",
  ].join("\n");

  const excerpt = section(markdown, "## 引言內章節");
  assert.match(excerpt, /^## 引言內章節/u);
  assert.match(excerpt, /> 引言內容。/u);
  assert.match(excerpt, /> ### 引言子節/u);
  assert.doesNotMatch(excerpt, /下一個引言章節/u);
  assert.doesNotMatch(excerpt, /下一個外層章節/u);
});

test("nested headings stay within their container and do not truncate an outer section", () => {
  const markdown = [
    "## 外層",
    "",
    "外層前文。",
    "",
    "> ## 引言警語",
    ">",
    "> 引言內容。",
    "",
    "外層後文。",
    "",
    "### 外層子節",
    "",
    "子節內容。",
    "",
    "## 下一節",
  ].join("\n");

  const outer = section(markdown, "## 外層");
  assert.match(outer, /> ## 引言警語/u);
  assert.match(outer, /外層後文。/u);
  assert.match(outer, /### 外層子節/u);
  assert.doesNotMatch(outer, /## 下一節/u);

  const quoted = section(markdown, "## 引言警語");
  assert.match(quoted, /> 引言內容。/u);
  assert.doesNotMatch(quoted, /外層後文。/u);
  assert.doesNotMatch(quoted, /### 外層子節/u);
});

test("full-section excerpts retain the same heading identity as legacy title-only notes", () => {
  const legacy = "## 核心理由";
  const full = "## 核心理由\n\n完整段落。\n\n### 子標題\n\n子內容。";
  assert.equal(annotationBlockAnchor("heading", legacy, 120), annotationBlockAnchor("heading", full, 120));
  assert.equal(annotationBlockKey("heading", legacy), annotationBlockKey("heading", full));

  const legacySetext = "核心\n理由\n---";
  const fullSetext = "核心\n理由\n---\n\n完整段落。";
  assert.equal(annotationBlockAnchor("heading", legacySetext, 240), annotationBlockAnchor("heading", fullSetext, 240));
  assert.equal(annotationBlockKey("heading", legacySetext), annotationBlockKey("heading", fullSetext));
});

test("the visible Guide H1 captures the complete chapter section", () => {
  const markdown = "# 急性處置\n\n章節導言。\n\n## 評估\n\n評估內容。\n\n## 治療\n\n治療內容。";
  const excerpt = firstMarkdownH1Excerpt(markdown, "目錄章名");
  assert.equal(excerpt.markdown, markdown);
  assert.equal(excerpt.sourceAnchor, annotationBlockAnchor("heading", markdown, 0));

  const fallback = firstMarkdownH1Excerpt("## 評估\n\n評估內容。", "目錄章名");
  assert.equal(fallback.markdown, "# 目錄章名\n\n## 評估\n\n評估內容。");

  const quotedH1 = firstMarkdownH1Excerpt("> # 引言範例\n> 只屬於引言。\n\n## 正文", "目錄章名");
  assert.equal(quotedH1.markdown, "# 目錄章名\n\n> # 引言範例\n> 只屬於引言。\n\n## 正文");

  const nestedH1 = firstMarkdownH1Excerpt("# 正文章名\n\n> # 引言中的標題\n> 引言。\n\n正文結尾。", "目錄章名");
  assert.equal(nestedH1.markdown, "# 正文章名\n\n> # 引言中的標題\n> 引言。\n\n正文結尾。");
});

test("the shared excerpt limit leaves room for a complete long chapter", () => {
  assert.equal(ANNOTATION_EXCERPT_QUOTE_LIMIT, 100_000);
});
