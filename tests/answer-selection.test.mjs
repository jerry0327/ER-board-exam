import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import React from "react";
import { applyAnswerSelection } from "../app/hooks/use-answer-selection.ts";

const question = {
  id: "TEST-Q001",
  canonicalId: "TEST-Q001",
  exam: "TEST",
  year: 115,
  number: 1,
  category: "測試",
  sourceSections: [],
  tags: [],
  questionType: "單選題",
  title: "測試題",
  stem: "請選擇答案",
  options: [
    { key: "A", text: "選項 A" },
    { key: "B", text: "選項 B" },
  ],
  answerKeys: ["A"],
  answerText: "A",
  allCredit: false,
  images: [],
  explanation: "測試詳解",
  qualityStatus: "ok",
  excludedFromPractice: false,
};

function session(overrides = {}) {
  return {
    schemaVersion: 2,
    ids: [question.id],
    cursor: 0,
    mode: "study",
    answers: {},
    confidence: {},
    eliminatedOptions: {},
    scratchpads: {},
    submitted: [],
    flaggedIds: [],
    timerEnabled: false,
    completed: false,
    startedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function findElement(node, predicate) {
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

test("single- and multiple-answer options toggle off when selected again", () => {
  const selectedSingle = session({ answers: { [question.id]: ["A"] } });
  assert.deepEqual(applyAnswerSelection(selectedSingle, question, "A").answers[question.id], []);
  assert.deepEqual(applyAnswerSelection(selectedSingle, question, "B").answers[question.id], ["B"]);

  const multipleQuestion = { ...question, answerKeys: ["A", "B"] };
  const selectedMultiple = session({ answers: { [question.id]: ["A", "B"] } });
  assert.deepEqual(applyAnswerSelection(selectedMultiple, multipleQuestion, "A").answers[question.id], ["B"]);
});

test("explicit clearing is idempotent and locked answers cannot change", () => {
  const selected = session({ answers: { [question.id]: ["A"] } });
  const cleared = applyAnswerSelection(selected, question, "A", "clear");
  assert.deepEqual(cleared.answers[question.id], []);
  assert.equal(applyAnswerSelection(cleared, question, "A", "clear"), cleared);

  const submitted = session({ answers: { [question.id]: ["A"] }, submitted: [question.id] });
  assert.equal(applyAnswerSelection(submitted, question, "A"), submitted);
  const completed = session({ answers: { [question.id]: ["A"] }, completed: true });
  assert.equal(applyAnswerSelection(completed, question, "A"), completed);
});

test("answer option double-clicks end cleared without submitting and expose toggle-button semantics", async () => {
  const outfile = path.resolve("node_modules/.cache/question-sheet-answer-selection-test.mjs");
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

  let currentSession = session({ mode: "exam" });
  let submissions = 0;
  const onSelect = (key, intent) => {
    currentSession = applyAnswerSelection(currentSession, question, key, intent);
  };
  const sheet = QuestionSheet({ question, selectedKeys: [], onSelect, onSubmit: () => { submissions += 1; } });
  const optionGroup = findElement(sheet, (element) => element.props.className?.includes?.("answer-options"));
  assert.equal(optionGroup.props.role, "group");
  assert.match(optionGroup.props["aria-label"], /再次按下可取消/u);
  const option = findElement(optionGroup, (element) => element.type === "button" && element.props["aria-pressed"] !== undefined);
  assert.ok(option);
  assert.equal(option.props.type, "button");
  assert.equal(option.props.role, undefined);
  assert.equal(option.props["aria-pressed"], false);
  assert.equal(option.props.disabled, false);

  option.props.onClick({ detail: 1 });
  assert.deepEqual(currentSession.answers[question.id], ["A"]);
  option.props.onClick({ detail: 2 });
  assert.deepEqual(currentSession.answers[question.id], []);
  let prevented = false;
  let stopped = false;
  option.props.onDoubleClick({
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  });
  assert.deepEqual(currentSession.answers[question.id], []);
  assert.equal(submissions, 0);
  assert.equal(prevented, true);
  assert.equal(stopped, true);

  currentSession = session({ mode: "exam", answers: { [question.id]: ["A"] } });
  option.props.onClick({ detail: 1 });
  option.props.onClick({ detail: 2 });
  option.props.onDoubleClick({ preventDefault: () => undefined, stopPropagation: () => undefined });
  assert.deepEqual(currentSession.answers[question.id], [], "double-clicking an already selected option must remain cleared");

  option.props.onClick({ detail: 0 });
  assert.deepEqual(currentSession.answers[question.id], ["A"], "keyboard-generated clicks must still toggle the option");

  const lockedSheet = QuestionSheet({ question, selectedKeys: ["A"], submitted: true, onSelect });
  const lockedOptionGroup = findElement(lockedSheet, (element) => element.props.className?.includes?.("answer-options"));
  const lockedOption = findElement(lockedOptionGroup, (element) => element.type === "button" && element.props["aria-pressed"] !== undefined);
  assert.equal(lockedOption.props.disabled, true);
  assert.equal(lockedOption.props["aria-pressed"], true);
});

test("held answer shortcuts cannot oscillate between selected and cleared", async () => {
  const practice = await readFile(new URL("../app/views/practice-view.impl.tsx", import.meta.url), "utf8");
  assert.match(practice, /else \{\s*if \(!event\.repeat\) updateAnswer\(key\);\s*\}/u);
});
