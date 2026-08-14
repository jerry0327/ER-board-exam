import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { explanationForMode } from "../app/lib/explanation-mode.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packRoot = path.join(projectRoot, "public/data/explanation-packs");
const manifest = JSON.parse(fs.readFileSync(path.join(packRoot, "manifest.json"), "utf8"));
const concisePack = manifest.packs.find((pack) => pack.id === "concise");

function loadExplanation(exam, questionId) {
  const chunk = JSON.parse(fs.readFileSync(path.join(packRoot, "concise", `${exam}.json`), "utf8"));
  return chunk.explanations[questionId];
}

test("legacy explanations remain the default and the concise pack maps every current question", () => {
  assert.equal(manifest.defaultPackId, "original");
  assert.equal(manifest.totalQuestions, 3320);
  assert.equal(concisePack.questionCount, 3320);
  assert.equal(concisePack.chunks.length, 24);
  assert.equal(concisePack.chunks.reduce((sum, chunk) => sum + chunk.questionCount, 0), 3320);
  assert.equal(manifest.validation.sourceQuestions, 3520);
  assert.equal(manifest.validation.skippedParallelDuplicates, 200);
  assert.equal(manifest.validation.missingTargetIds, 0);
  assert.equal(manifest.validation.reviewIndexUsed, true);
});

test("ROC113-A maps to the site's 113 exam while ROC113-B is excluded as parallel duplicates", () => {
  const chunk = JSON.parse(fs.readFileSync(path.join(packRoot, "concise", "113.json"), "utf8"));
  assert.equal(chunk.questionCount, 200);
  assert.ok(chunk.explanations["113-Q001"]);
  assert.ok(chunk.explanations["113-Q200"]);
  assert.equal(Object.keys(chunk.explanations).some((id) => id.startsWith("113A-") || id.startsWith("113B-")), false);
});

test("both source Markdown schemas become canonical three-depth explanations without image blocks", () => {
  for (const explanation of [
    loadExplanation("094", "094-Q080"),
    loadExplanation("103", "103-Q063"),
  ]) {
    assert.match(explanation, /^## 核心理由/mu);
    assert.match(explanation, /^## 考場解題路徑/mu);
    assert.match(explanation, /^## 選項分析/mu);
    assert.match(explanation, /^## 核心知識整理/mu);
    assert.match(explanation, /^## 常見陷阱與變形/mu);
    assert.match(explanation, /^## 延伸學習/mu);
    assert.match(explanation, /^## 參考資料/mu);
    assert.doesNotMatch(explanation, /!\[[^\]]*\]\(|原題圖像|原題影像|題目圖片|圖片描述|影像描述/u);
    assert.doesNotMatch(explanation, /答案核對提醒|精要詳解包|人工複核|答案狀態|年代辨識|這不代表詳解未完成|年代與指引校正/u);

    const quick = explanationForMode(explanation, "quick");
    const standard = explanationForMode(explanation, "standard");
    const full = explanationForMode(explanation, "full");
    assert.match(quick, /^### 考試答案與現行觀點/mu);
    assert.match(quick, /^## 選項分析/mu);
    assert.doesNotMatch(quick, /^## 考場解題路徑/mu);
    assert.match(standard, /^## 考場解題路徑/mu);
    assert.doesNotMatch(standard, /^## 參考資料/mu);
    assert.match(full, /^## 參考資料/mu);
  }

  const snakebite = loadExplanation("094", "094-Q080");
  assert.match(snakebite, /\| 官方答案 \| \*\*C\*\*/u);
  assert.match(snakebite, /B 也是不明蛇咬常用的合理基線檢查/u);

  const tachycardia = loadExplanation("103", "103-Q063");
  assert.match(tachycardia, /官方答案 C 正確/u);
  assert.match(tachycardia, /規則窄QRS常50-100 J/u);
});

test("published explanations do not expose OCR, PDF reconstruction, or import-pipeline notes", () => {
  const pipelineNote = /(?:題庫專案|原始(?:選項)?\s*OCR|原始\s*\d[\d,]*\s*題\s*CSV|原\s*CSV\s*把|本批\s*依|題庫總數修正|(?:由|依|回查)\s*官方\s*PDF[^。\n|]*(?:重建|修復|補回|分離))/iu;
  for (const [exam, questionId] of [
    ["094", "094-Q080"],
    ["094", "094-Q099"],
    ["094", "094-Q100"],
    ["108", "108-Q095"],
    ["115A", "115A-Q053"],
    ["115B", "115B-Q153"],
  ]) {
    assert.doesNotMatch(loadExplanation(exam, questionId), pipelineNote, `${questionId} leaked a pipeline note`);
  }
});
