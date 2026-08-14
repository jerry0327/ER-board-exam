import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { plainQuestionText } from "../app/lib/question-text.ts";

test("question text removes Markdown emphasis without making content bold", () => {
  assert.equal(plainQuestionText("症狀 **1 小時前突然出現**。"), "症狀 1 小時前突然出現。");
});

test("question text turns flattened Markdown bullets into readable lines", () => {
  assert.equal(plainQuestionText("檢驗： * WBC 6800 * Hb 7.0"), "檢驗：\nWBC 6800\nHb 7.0");
});

test("question text preserves a dimension by using the multiplication sign", () => {
  assert.equal(plainQuestionText("頭皮有 2*2 公分血腫"), "頭皮有 2 × 2 公分血腫");
});

test("removes appended editorial notes without damaging comparison signs", () => {
  assert.equal(
    plainQuestionText("關於此疾病何者錯誤？ > **圖片註記（非原題文字）：**依選項可知答案。"),
    "關於此疾病何者錯誤？",
  );
  assert.equal(plainQuestionText("胸水須 >10 ml/kg 才能顯示"), "胸水須 >10 ml/kg 才能顯示");
});

test("removes a leading answer-bearing note but preserves a genuine blockquoted stem", () => {
  assert.equal(
    plainQuestionText("> 原題用詞不一致；解題上最符合某診斷。 40 歲女性因右足疼痛就醫，下列何者適當？"),
    "40 歲女性因右足疼痛就醫，下列何者適當？",
  );
  assert.equal(plainQuestionText("> 5 歲男童因咳嗽就醫，下列何者正確？"), "5 歲男童因咳嗽就醫，下列何者正確？");
});

test("removes reconstruction captions and generic authoring preambles", () => {
  assert.equal(
    plainQuestionText("病人的 ECG 如圖，下列何者正確？ 圖片：原題附 ECG 圖，不自行描述未見內容。"),
    "病人的 ECG 如圖，下列何者正確？",
  );
  assert.equal(
    plainQuestionText("下列何者適當？ **原題圖像與資料重建：**影像支持某診斷。"),
    "下列何者適當？",
  );
  assert.equal(
    plainQuestionText("本題為一般敘述題，未提供單一病人情境。 下列關於疝氣之敘述何者較不適當？"),
    "下列關於疝氣之敘述何者較不適當？",
  );
  assert.equal(
    plainQuestionText("生命徵象如上，身體診察發現下肢如圖；官方題圖可見某病灶。抽血檢查發現低血鈉。 有關於此病人的處置，何者適當？"),
    "生命徵象如上，身體診察發現下肢如圖； 抽血檢查發現低血鈉。 有關於此病人的處置，何者適當？",
  );
  assert.equal(
    plainQuestionText("心電圖如下，何者正確？ ### 圖片重建 官方圖指向某答案。"),
    "心電圖如下，何者正確？",
  );
  assert.equal(
    plainQuestionText("心電圖監視器波形如下，下列何者最不適當？ 心電圖監視器波形可保守描述為：規則、窄 QRS 心搏過速。"),
    "心電圖監視器波形如下，下列何者最不適當？",
  );
  assert.equal(
    plainQuestionText("心電圖如下，下列何者正確？ 本題 ECG 在此情境下提示某診斷，但不能只靠 ECG 定診。"),
    "心電圖如下，下列何者正確？",
  );
  assert.equal(
    plainQuestionText("超音波影像如下，下列何者正確？ 圖片"),
    "超音波影像如下，下列何者正確？",
  );
  assert.equal(
    plainQuestionText("服藥後出現圖示表徵。題圖顯示大片紅斑與表皮剝脫。下列關於此疾病何者適當？"),
    "服藥後出現圖示表徵。 下列關於此疾病何者適當？",
  );
  assert.equal(
    plainQuestionText("皮膚病灶如圖。圖中可見多發紫紅色病灶。關於此疾病何者適當？"),
    "皮膚病灶如圖。 關於此疾病何者適當？",
  );
  assert.equal(
    plainQuestionText("胸部 X 光顯示雙肺浸潤，下列何者適當？"),
    "胸部 X 光顯示雙肺浸潤，下列何者適當？",
  );
});

test("all public question stems are clean in the exam-facing renderer", async () => {
  const payload = JSON.parse(await readFile(new URL("../public/data/index.json", import.meta.url), "utf8"));
  const cleaned = new Map(payload.questions.map((question) => [question.id, plainQuestionText(question.stem)]));
  for (const [id, stem] of cleaned) {
    assert.doesNotMatch(stem, /(?:^|\s)>\s*(?:\*\*)?(?:註[：:]|原題|原始|題目中文|題幹原文|題目所附|圖片註記|本次|本輸入|本解析)/u, `${id} 仍含編輯註記`);
    assert.doesNotMatch(stem, /(?:圖片|題目圖片|原題圖像與資料重建|圖像描述)[：:]/u, `${id} 仍含圖片重建說明`);
    assert.doesNotMatch(stem, /^(?:本題為|本題未提供|題目未提供)/u, `${id} 仍含無意義的編輯前言`);
    assert.doesNotMatch(stem, /\s#{2,6}\s|題圖(?:為|顯示|重點)|圖中(?:重點|可見)|圖示重點|圖片重點|(?:影像|圖像)(?:重點|重建|提示)[：:]|心電圖(?:重點|資訊|監視器波形可保守描述為)|本題\s+ECG\b|圖片補充描述[：:]|原始(?:題本|圖像(?:為|顯示))|本次已查到|官方(?:題圖|題本附圖)/iu, `${id} 仍含解題用影像說明`);
    assert.doesNotMatch(stem, /\s圖片$/u, `${id} 仍含孤立圖片標記`);
  }
  assert.doesNotMatch(cleaned.get("110-Q010"), /恙蟲病|焦痂/u);
  assert.doesNotMatch(cleaned.get("114A-Q128"), /最符合.*拇趾嵌甲/u);
});
