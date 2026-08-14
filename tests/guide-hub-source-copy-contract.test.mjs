import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [hub, registry] = await Promise.all([
  readFile(new URL("../app/views/guide-hub-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/learning-source-registry.ts", import.meta.url), "utf8"),
]);

test("learning-guide sources keep the requested six-card order and canonical book names", () => {
  const cardOrder = [...hub.matchAll(/<article className="guide-book-card ([a-z]+)"/gu)]
    .map((match) => match[1]);
  assert.deepEqual(cardOrder, ["tintinalli", "rosens", "goldfrank", "ems", "ails", "board"]);

  const canonicalEnglishTitles = [
    "Tintinalli’s Emergency Medicine:A Comprehensive Study Guide",
    "Rosen’s Emergency Medicine:Concepts and Clinical Practice",
    "Goldfrank’sToxicologic Emergencies",
  ];
  const headingText = [...hub.matchAll(/<h2 id="(?:tintinalli|rosens|goldfrank)-guide-title">([\s\S]*?)<\/h2>/gu)]
    .map((match) => match[1].replace(/<br \/>/gu, "").trim());
  assert.deepEqual(headingText, canonicalEnglishTitles);
  assert.equal(headingText.some((title) => /\p{Script=Han}/u.test(title)), false);

  assert.match(registry, /title: "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide"/u);
  assert.match(registry, /title: "Rosen’s Emergency Medicine: Concepts and Clinical Practice"/u);
  assert.match(registry, /title: "AILS急性中毒救命術"/u);
  assert.match(registry, /ems:[\s\S]*?order: 4/u);
  assert.match(registry, /ails:[\s\S]*?order: 5/u);
  assert.match(registry, /board:[\s\S]*?order: 6/u);
});

test("all six source descriptions explain the publication or teaching source instead of product features", () => {
  const descriptions = [...hub.matchAll(/<span className="guide-book-description">([^<]+)<\/span>/gu)]
    .map((match) => match[1]);
  assert.equal(descriptions.length, 6);
  assert(descriptions.every((description) => description.length >= 45));
  assert(descriptions.some((description) => description.includes("第 9 版綜合急診醫學教科書")));
  assert(descriptions.some((description) => description.includes("第 10 版雙冊急診醫學參考書")));
  assert(descriptions.some((description) => description.includes("第 11 版臨床毒理學權威教科書")));
  assert(descriptions.some((description) => description.includes("台灣急診醫學會 EMS 委員會編寫")));
  assert(descriptions.some((description) => description.includes("台灣急診醫學會出版的第三版急性中毒教材")));
  assert(descriptions.some((description) => description.includes("歷屆急診專科醫師甄審題目與參考文獻")));
  for (const description of descriptions) {
    assert.doesNotMatch(description, /速讀|普通|完整版|學習音檔|從這裡開始|系統.*記住|順手找到|接著做/u);
  }
});
