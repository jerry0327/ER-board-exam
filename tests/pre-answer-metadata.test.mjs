import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("does not reveal study metadata before an answer is submitted", async () => {
  const outfile = path.resolve("node_modules/.cache/question-sheet-ssr-test.mjs");
  await build({
    entryPoints: [path.resolve("app/components/question-sheet.tsx")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    jsx: "automatic",
    logLevel: "silent",
  });
  const { default: QuestionSheet } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  const ailsAdapterOutfile = path.resolve("node_modules/.cache/ails-question-adapter-test.mjs");
  await build({
    entryPoints: [path.resolve("app/lib/ails-questions.ts")],
    outfile: ailsAdapterOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    logLevel: "silent",
  });
  const { ailsQuestionToFull } = await import(`${pathToFileURL(ailsAdapterOutfile).href}?v=${Date.now()}`);
  const question = {
    id: "TEST-Q001",
    canonicalId: "TEST-Q001",
    exam: "TEST",
    year: 115,
    number: 1,
    category: "不可預告的主要領域",
    sourceSections: ["Section 99"],
    tags: [],
    questionType: "不可預告的否定排除題",
    title: "不可預告的考試考點",
    stem: "下列何者最適當？",
    options: [
      { key: "A", text: "選項 A" },
      { key: "B", text: "選項 B" },
    ],
    answerKeys: ["A"],
    answerText: "A",
    allCredit: false,
    images: [],
    explanation: "## 3. 官方答案\n\n### 官方答案\n\nA\n\n### 題型\n\n測試\n\n### 核心理由\n\n理由",
    qualityStatus: "ok",
    excludedFromPractice: false,
  };

  const hidden = renderToStaticMarkup(React.createElement(QuestionSheet, { question }));
  assert.match(hidden, /TEST-Q001/);
  assert.match(hidden, /下列何者最適當/);
  assert.doesNotMatch(hidden, /不可預告/);
  assert.doesNotMatch(hidden, /官方答案|正解/);

  const ailsReview = JSON.parse(await readFile(new URL("../public/data/ails/review.json", import.meta.url), "utf8"));
  const ailsSource = ailsReview.questions[0];
  const ailsQuestion = ailsQuestionToFull(ailsSource);
  const ailsHidden = renderToStaticMarkup(React.createElement(QuestionSheet, { question: ailsQuestion }));
  assert.match(ailsHidden, new RegExp(ailsSource.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(ailsHidden, /官方答案|正解/);
  assert.doesNotMatch(ailsHidden, new RegExp(ailsSource.rationale.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const multiQuestion = { ...question, id: "TEST-Q002", answerKeys: ["A", "B"] };
  const multiHidden = renderToStaticMarkup(React.createElement(QuestionSheet, { question: multiQuestion }));
  assert.doesNotMatch(multiHidden, /複數答案/, "作答前不應提示答案數量");
  const multiRevealed = renderToStaticMarkup(React.createElement(QuestionSheet, { question: multiQuestion, selectedKeys: ["A"], submitted: true }));
  assert.match(multiRevealed, /複數答案/, "交卷後可恢復顯示題型資訊");

  const revealed = renderToStaticMarkup(React.createElement(QuestionSheet, {
    question,
    selectedKeys: ["B"],
    submitted: true,
  }));
  assert.match(revealed, /不可預告的主要領域/);
  assert.match(revealed, /不可預告的否定排除題/);
  assert.match(revealed, /不可預告的考試考點/);
  assert.match(revealed, /官方答案：A/);

  const expanded = renderToStaticMarkup(React.createElement(QuestionSheet, {
    question,
    selectedKeys: ["B"],
    submitted: true,
    showFullExplanation: true,
  }));
  assert.equal(expanded.match(/官方答案/g)?.length, 1, "完整詳解不應再次顯示來源中的官方答案模板");
  assert.doesNotMatch(expanded, /class="core-reason"/, "展開完整詳解時不應重複顯示核心理由摘要卡");
  assert.equal(expanded.match(/<h2[^>]*>核心理由<\/h2>/g)?.length, 1, "完整詳解應只保留一個核心理由章節");

  const alternateExplanation = "## 核心理由\n\n精要包核心理由\n\n## 選項分析\n\n### A. 選項\n\n精要包選項分析";
  const alternateSummary = renderToStaticMarkup(React.createElement(QuestionSheet, {
    question,
    selectedKeys: ["B"],
    submitted: true,
    explanationMarkdown: alternateExplanation,
  }));
  assert.match(alternateSummary, /精要包核心理由/, "作答後摘要應使用所選詳解包");

  const alternateExpanded = renderToStaticMarkup(React.createElement(QuestionSheet, {
    question,
    selectedKeys: ["B"],
    submitted: true,
    showFullExplanation: true,
    explanationMarkdown: alternateExplanation,
  }));
  assert.match(alternateExpanded, /精要包選項分析/, "展開解析應使用所選詳解包");
});
