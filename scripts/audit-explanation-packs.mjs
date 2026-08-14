import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { explanationForMode } from "../app/lib/explanation-mode.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packRoot = path.join(projectRoot, "public/data/explanation-packs");
const manifest = JSON.parse(fs.readFileSync(path.join(packRoot, "manifest.json"), "utf8"));
const baseIndex = JSON.parse(fs.readFileSync(path.join(projectRoot, "public/data/index.json"), "utf8"));
const expectedIds = new Set(baseIndex.questions.map((question) => question.id));
const expectedExams = [...new Set(baseIndex.questions.map((question) => question.exam))].sort();
const concisePack = manifest.packs.find((pack) => pack.id === "concise");
const canonicalHeadings = [
  "核心理由",
  "考場解題路徑",
  "選項分析",
  "核心知識整理",
  "常見陷阱與變形",
  "延伸學習",
  "參考資料",
];
const forbiddenPatterns = [
  { pattern: /^---(?:\n|$)/u, label: "YAML frontmatter" },
  { pattern: /!\[[^\]]*\]\([^\n)]*\)/u, label: "Markdown 圖片" },
  { pattern: /<img\b/iu, label: "HTML 圖片" },
  { pattern: /(?:^|\n)#{1,6}\s+(?:原題圖像|原題影像|題目圖片|圖片描述|影像描述)(?:\s|$)/u, label: "原題圖像區塊" },
  { pattern: /(?:^|\n)##\s+(?:題目|選項|官方答案|原題)(?:\s|$)/u, label: "重複題幹包裝" },
  { pattern: /(?:^|\n)##\s+(?:來源追溯|版本資訊|版本紀錄)(?:\s|$)/u, label: "來源或版本區塊" },
  { pattern: /\bsource_(?:page|pdf|sha256)\b/iu, label: "來源欄位" },
  { pattern: /(?:PDF\s*頁碼|官方題本\s*SHA-256|原始題庫\s*exam_id)\s*[：:]/iu, label: "來源定位資訊" },
  { pattern: /題庫專案/u, label: "題庫製作註記" },
  { pattern: /原始(?:選項)?\s*OCR/iu, label: "OCR 修復註記" },
  { pattern: /(?:原始\s*\d[\d,]*\s*題\s*CSV|原\s*CSV\s*把|本批\s*依|題庫總數修正)/iu, label: "匯入批次註記" },
  { pattern: /(?:由|依|回查)\s*官方\s*PDF[^。\n|]*(?:重建|修復|補回|分離)/iu, label: "PDF 重建註記" },
  { pattern: /(?:^|[\s(])(?:\.\.\/)+assets\//iu, label: "原題資產路徑" },
  { pattern: /\.(?:avif|png|jpe?g|webp)(?:[)\s?#]|$)/iu, label: "圖片檔案路徑" },
  { pattern: /答案核對提醒/u, label: "答案核對提醒" },
  { pattern: /精要詳解包/u, label: "詳解包製作註記" },
  { pattern: /人工複核/u, label: "內部複核狀態" },
  { pattern: /(?:標記複核|現行詳解|詳解(?:已|將|未))/u, label: "詳解複核流程" },
  { pattern: /答案狀態/u, label: "答案狀態標籤" },
  { pattern: /年代辨識/u, label: "年代辨識標籤" },
  { pattern: /(?:年代與指引校正|年代校正方面|現行指引校正)/u, label: "編輯校正標籤" },
  { pattern: /(?:這不代表詳解未完成|詳解已把官方答案與現行判定分開|使用時應同時閱讀官方答案與現行臨床判定)/u, label: "詳解製作說明" },
  { pattern: /(?:請以本站顯示的官方答案作答|官方答案仍依試卷原樣保存|官方答案須依試卷原樣保存)/u, label: "答案保存流程說明" },
  { pattern: /(?:考古題作答必須|考古題作答需|因此準備考古題時|對於考古題中的固定數值)/u, label: "泛用考古題聲明" },
  { pattern: /(?:本題在真實急診中仍須於處置後|本題若出現在真實急診，需將官方答案轉化)/u, label: "泛用臨床聲明" },
  { pattern: /本題核心(?:原則|觀念)(?:目前)?仍可使用/u, label: "泛用指引聲明" },
  { pattern: /解題時先辨識題目是在考診斷、立即處置、禁忌、風險分層或歷史規範/u, label: "泛用解題聲明" },
  { pattern: /(?:即使官方答案在出題年代可以成立|完成初步處置後仍應重新評估生命徵象|作答時先從題幹找出時間軸)/u, label: "重複防禦性聲明" },
  { pattern: /(?:檢查、治療及專科會診應依病人穩定度|處置應回到病人的穩定度|急診處置應先辨識立即生命威脅|作答時不能只抓一個關鍵字|檢查與治療應依病人穩定度)/u, label: "重複處置聲明" },
  { pattern: /(?:本題的判斷應將「當年考試預期答案」|已分開保存官方答案|官方答案保留供考古追溯|只記住官方選項|只背官方答案字母)/u, label: "重複答案防禦聲明" },
  { pattern: /(?:最常見的錯誤是忽略題目問的是|題幹中的病史、生命徵象、時間軸與檢查結果|本題最常見陷阱是選到部分正確|最常見陷阱是忽略題幹的決策層級)/u, label: "重複解題聲明" },
];

assert.equal(manifest.schemaVersion, 1, "詳解包 manifest schema 不符");
assert.equal(manifest.defaultPackId, "original", "舊版深度詳解必須維持預設");
assert.equal(manifest.totalQuestions, 3320, "詳解包總題數不符");
assert.equal(manifest.packs.find((pack) => pack.id === "original")?.questionCount, 3320, "預設詳解題數不符");
assert.ok(concisePack, "找不到精要詳解包");
assert.equal(concisePack.questionCount, 3320, "精要詳解題數不符");
assert.equal(manifest.validation.sourceQuestions, 3520, "來源壓縮包應有 3,520 題");
assert.equal(manifest.validation.importedQuestions, 3320, "應匯入 3,320 題");
assert.equal(manifest.validation.skippedParallelDuplicates, 200, "應略過 ROC113-B 的 200 題平行重複題");
assert.equal(manifest.validation.missingTargetIds, 0, "仍有本站題目缺少精要詳解");
assert.equal(manifest.validation.duplicateTargetIds, 0, "詳解包有重複目標 ID");
assert.equal(manifest.validation.unexpectedTargetIds, 0, "詳解包有未知目標 ID");
assert.equal(manifest.validation.archiveReviewFlags, 1458, "未完整讀入權威人工複核索引");
assert.equal(manifest.validation.reviewIndexUsed, true, "未使用人工複核索引");
assert.deepEqual(concisePack.chunks.map((chunk) => chunk.exam).sort(), expectedExams, "詳解分卷與題庫分卷不一致");

const actualIds = new Set();
let questionCount = 0;
let totalCharacters = 0;

for (const chunkEntry of concisePack.chunks) {
  const chunkPath = path.join(packRoot, "concise", chunkEntry.filename);
  assert.ok(fs.existsSync(chunkPath), `缺少詳解分卷：${chunkEntry.filename}`);
  const chunk = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
  assert.equal(chunk.schemaVersion, manifest.schemaVersion, `${chunkEntry.exam} schema 不符`);
  assert.equal(chunk.packId, "concise", `${chunkEntry.exam} pack ID 不符`);
  assert.equal(chunk.exam, chunkEntry.exam, `${chunkEntry.exam} 分卷標籤不符`);
  assert.equal(chunk.questionCount, Object.keys(chunk.explanations).length, `${chunkEntry.exam} 題數欄位不符`);
  assert.equal(chunk.questionCount, chunkEntry.questionCount, `${chunkEntry.exam} manifest 題數不符`);
  assert.equal(Object.hasOwn(chunk, "reviewWarningCount"), false, `${chunkEntry.exam} 不應公開複核提醒計數`);
  assert.equal(Object.hasOwn(chunkEntry, "reviewWarningCount"), false, `${chunkEntry.exam} manifest 不應公開複核提醒計數`);

  for (const [questionId, explanation] of Object.entries(chunk.explanations)) {
    assert.ok(expectedIds.has(questionId), `未知精要詳解 ID：${questionId}`);
    assert.ok(!actualIds.has(questionId), `重複精要詳解 ID：${questionId}`);
    actualIds.add(questionId);
    questionCount += 1;
    totalCharacters += explanation.length;
    assert.ok(explanation.length >= 300, `${questionId} 詳解內容異常過短`);

    const headingLines = explanation.split("\n").filter((line) => /^##\s+/u.test(line));
    assert.deepEqual(headingLines, canonicalHeadings.map((heading) => `## ${heading}`), `${questionId} 詳解章節不完整或順序錯誤`);
    for (const { pattern, label } of forbiddenPatterns) {
      assert.doesNotMatch(explanation, pattern, `${questionId} 仍含${label}`);
    }

    const quick = explanationForMode(explanation, "quick");
    const standard = explanationForMode(explanation, "standard");
    const full = explanationForMode(explanation, "full");
    assert.match(quick, /^## 核心理由/mu, `${questionId} 速讀缺少核心理由`);
    assert.match(quick, /^## 選項分析/mu, `${questionId} 速讀缺少選項分析`);
    assert.doesNotMatch(quick, /^## (?:考場解題路徑|核心知識整理|延伸學習|參考資料)$/mu, `${questionId} 速讀包含過多章節`);
    assert.match(standard, /^## 考場解題路徑/mu, `${questionId} 標準模式缺少解題路徑`);
    assert.match(standard, /^## 核心知識整理/mu, `${questionId} 標準模式缺少核心知識`);
    assert.match(standard, /^## 常見陷阱與變形/mu, `${questionId} 標準模式缺少陷阱`);
    assert.doesNotMatch(standard, /^## (?:延伸學習|參考資料)$/mu, `${questionId} 標準模式包含完整模式章節`);
    assert.match(full, /^## 延伸學習/mu, `${questionId} 完整模式缺少延伸學習`);
    assert.match(full, /^## 參考資料/mu, `${questionId} 完整模式缺少參考資料`);

  }
}

assert.equal(questionCount, 3320, "精要詳解總題數不符");
assert.equal(actualIds.size, expectedIds.size, "精要詳解 ID 數不符");
assert.deepEqual([...expectedIds].filter((id) => !actualIds.has(id)), [], "仍有題目缺少精要詳解");
assert.equal(Object.hasOwn(manifest.validation, "mappedReviewWarnings"), false, "manifest 不應公開複核提醒計數");

console.log(JSON.stringify({
  defaultPackId: manifest.defaultPackId,
  sourceQuestions: manifest.validation.sourceQuestions,
  importedQuestions: questionCount,
  skippedParallelDuplicates: manifest.validation.skippedParallelDuplicates,
  exams: concisePack.chunks.length,
  editorialLeaks: 0,
  totalCharacters,
}, null, 2));
