import assert from "node:assert/strict";
import test from "node:test";
import { isStructuredLabelText } from "../app/lib/structured-label.ts";

test("styles every concise explanation field label, not only a fixed shortlist", () => {
  assert.equal(isStructuredLabelText("判斷："), true);
  assert.equal(isStructuredLabelText("臨床重點："), true);
  assert.equal(isStructuredLabelText("影像判讀線索："), true);
  assert.equal(isStructuredLabelText("變形／適用條件"), true);
  assert.equal(isStructuredLabelText("這是一整段很長的粗體內容，不應被當成欄位標籤而套用醒目標籤樣式，避免干擾正文閱讀。"), false);
});
