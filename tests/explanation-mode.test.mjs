import assert from "node:assert/strict";
import test from "node:test";
import { coreReasonFromExplanation, explanationForMode } from "../app/lib/explanation-mode.ts";

const markdown = `## 3. 官方答案

### 官方答案
D

### 題型
最佳處置題

### 核心理由
核心句

## 4. 考場解題路徑
路徑

### 題型
重複題型

### 核心理由
重複核心理由

## 5. 選項分析
### A. 選項
A 分析
### B. 選項
B 分析

## 6. 核心知識整理
知識

## 7. 常見陷阱與變形
陷阱

## 8. 延伸學習
延伸

## 9. 參考資料
- https://example.com`;

test("quick explanation keeps core reason and complete option analysis", () => {
  const result = explanationForMode(markdown, "quick");
  assert.match(result, /## 核心理由/);
  assert.match(result, /### A\. 選項/);
  assert.match(result, /### B\. 選項/);
  assert.doesNotMatch(result, /考場解題路徑|核心知識整理|參考資料/);
});

test("standard explanation omits extension and references", () => {
  const result = explanationForMode(markdown, "standard");
  assert.match(result, /考場解題路徑|核心知識整理|常見陷阱與變形/);
  assert.doesNotMatch(result, /延伸學習|參考資料/);
});

test("full explanation preserves every substantive section without duplicate wrappers", () => {
  const result = explanationForMode(markdown, "full");
  assert.doesNotMatch(result, /### 題型/);
  assert.ok(result.trimStart().startsWith("## 核心理由"));
  assert.match(result, /## 延伸學習/);
  assert.match(result, /## 參考資料/);
  assert.doesNotMatch(result, /解題定位|### 官方答案|## 官方答案/);
});

test("raw explanation returns the literal Markdown source without normalization", () => {
  const raw = `  ## 3. 官方答案\r\n\r\n### 官方答案\r\nD\r\n\r\n${markdown}\r\n`;
  assert.equal(explanationForMode(raw, "raw"), raw);
});

test("core reason is extracted from both legacy and canonical pack headings", () => {
  assert.equal(coreReasonFromExplanation(markdown), "核心句");
  assert.equal(coreReasonFromExplanation("## 核心理由\n\n精要核心\n\n## 選項分析\n\nA"), "精要核心");
});
