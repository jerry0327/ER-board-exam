import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../app/views/dashboard-view.tsx", import.meta.url), "utf8");
const questionSheet = await readFile(new URL("../app/components/question-sheet.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("keeps notebook cues restrained without simulated binding holes or a page halo", () => {
  assert.doesNotMatch(dashboard, /welcome-binding|welcome-tape/u);
  assert.doesNotMatch(dashboard, /stack-tabs/u);
  assert.doesNotMatch(questionSheet, /paper-holes/u);
  assert.doesNotMatch(css, /welcome-binding|welcome-tape|paper-holes|stack-tabs/u);
  assert.match(css, /\.site-shell::before \{ display: none; \}/u);
  assert.match(css, /\.study-stack::before \{ display: none; \}/u);
  assert.match(css, /\.welcome-art::before \{ display: none; \}/u);
  assert.match(css, /\.exam-countdown-card::after \{ display: none; \}/u);
  assert.doesNotMatch(css, /\.exam-countdown-card \{[^}]*radial-gradient/su);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.hero-copy\.welcome-folio \{ display: block;/u);
});

test("labels future exam dates as a historical-pattern estimate and keeps the official source", () => {
  assert.match(dashboard, /最新甄審簡章與考試日期/u);
  assert.match(dashboard, /推估依據：111–115 年公告日期規律/u);
  assert.match(dashboard, /nextEmergencyBoardEstimate\(taiwanDateKey\(new Date\(now\)\)\)/u);
  assert.match(dashboard, /預估筆試/u);
  assert.match(dashboard, /預估口試/u);
  assert.match(dashboard, /https:\/\/www\.sem\.org\.tw\/News\/7\/Index/u);
  assert.doesNotMatch(dashboard, /2027\/05|2027\/06/u);
});
