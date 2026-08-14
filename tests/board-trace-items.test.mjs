import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../app/lib/board-trace-items.ts", import.meta.url), "utf8");
const executable = stripTypeScriptTypes(source, { mode: "strip" });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`;
const { groupBoardTraceHits, reconcileBoardTraceHits, traceQuestionCount } = await import(moduleUrl);

const question = {
  id: "101-Q111",
  year: 101,
  title: "醫院災害應變持續運作",
};
const questionById = new Map([[question.id, question]]);

function hit(atom, optionKey = null, questionId = question.id) {
  return {
    canonicalAtomId: atom,
    canonicalQuestionId: "ROC101-Q111",
    questionId,
    aliases: [question.id, "101B-Q111"],
    optionKey,
  };
}

test("題幹與 A–E atoms 合併為一題且保留排序後的精準選項", () => {
  const items = groupBoardTraceHits([
    hit("ROC101-Q111-OPT-B", "B"),
    hit("ROC101-Q111-OPT-C", "C"),
    hit("ROC101-Q111"),
    hit("ROC101-Q111-OPT-A", "A"),
    hit("ROC101-Q111-OPT-D", "D"),
    hit("ROC101-Q111-OPT-E", "E"),
    hit("ROC101-Q111-OPT-B", "B"),
  ], questionById);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].target, { kind: "question", questionId: question.id });
  assert.equal(items[0].matchesQuestionStem, true);
  assert.deepEqual(items[0].matchedOptionKeys, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(items[0].directMatches, {
    matchesQuestionStem: true,
    optionKeys: ["A", "B", "C", "D", "E"],
  });
  assert.equal(items[0].relatedMatches, undefined);
  assert.deepEqual(items[0].aliases, [{ label: "101B-Q111" }]);
});

test("單一與多個選項都使用同一個題目列與命中位置 renderer", () => {
  const single = groupBoardTraceHits([hit("ROC101-Q111-OPT-B", "B")], questionById);
  assert.deepEqual(single[0].target, { kind: "question", questionId: question.id });
  assert.deepEqual(single[0].directMatches, {
    matchesQuestionStem: false,
    optionKeys: ["B"],
  });
  assert.deepEqual(single[0].matchedOptionKeys, ["B"]);

  const multiple = groupBoardTraceHits([
    hit("ROC101-Q111-OPT-C", "C"),
    hit("ROC101-Q111-OPT-A", "A"),
  ], questionById);
  assert.deepEqual(multiple[0].target, { kind: "question", questionId: question.id });
  assert.equal(multiple[0].matchesQuestionStem, false);
  assert.deepEqual(multiple[0].matchedOptionKeys, ["A", "C"]);
  assert.deepEqual(multiple[0].directMatches, {
    matchesQuestionStem: false,
    optionKeys: ["A", "C"],
  });
});

test("direct 與 related 先跨關係合併，同一題只出現一次並保留所有精準跳轉", () => {
  const directHits = [
    hit("ROC101-Q111-OPT-E", "E"),
    hit("ROC101-Q111-OPT-B", "B"),
    hit("ROC101-Q111-OPT-C", "C"),
  ];
  const relatedHits = [
    hit("ROC101-Q111"),
    hit("ROC101-Q111-OPT-A", "A"),
    hit("ROC101-Q111-OPT-D", "D"),
    hit("ROC101-Q111-OPT-B", "B"),
  ];

  const result = reconcileBoardTraceHits(directHits, relatedHits, questionById);

  assert.equal(result.directItems.length, 1);
  assert.equal(result.relatedItems.length, 0);
  assert.deepEqual(result.directItems[0].target, { kind: "question", questionId: question.id });
  assert.deepEqual(result.directItems[0].directMatches, {
    matchesQuestionStem: false,
    optionKeys: ["B", "C", "E"],
  });
  assert.deepEqual(result.directItems[0].relatedMatches, {
    matchesQuestionStem: true,
    optionKeys: ["A", "D"],
  });
  assert.deepEqual(result.directItems[0].matchedOptionKeys, ["A", "B", "C", "D", "E"]);
});

test("canonical 題號控制分組與題數，不受年度別名影響", () => {
  const hits = [
    hit("ROC101-Q111-OPT-A", "A", "101-Q111"),
    hit("ROC101-Q111-OPT-D", "D", "101B-Q111"),
  ];
  assert.equal(groupBoardTraceHits(hits, questionById).length, 1);
  assert.equal(traceQuestionCount(hits), 1);
});
