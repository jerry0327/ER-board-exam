import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LEARNING_SOURCE_REGISTRY } from "../app/lib/learning-source-registry.ts";

const expectedTitles = {
  tintinalli: "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide",
  rosens: "Rosen’s Emergency Medicine: Concepts and Clinical Practice",
  goldfrank: "Goldfrank’s Toxicologic Emergencies",
};

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("canonical textbook identities use their full official titles", async () => {
  assert.equal(LEARNING_SOURCE_REGISTRY.tintinalli.title, expectedTitles.tintinalli);
  assert.equal(LEARNING_SOURCE_REGISTRY.rosens.title, expectedTitles.rosens);
  assert.equal(LEARNING_SOURCE_REGISTRY.goldfrank.title, expectedTitles.goldfrank);
  assert.equal(LEARNING_SOURCE_REGISTRY.ems.title, "急診住院醫師緊急醫療救護教科書");

  const sectionCatalog = JSON.parse(await readSource("app/data/textbook-sections.json"));
  assert.equal(sectionCatalog.textbooks.tintinalli.title, expectedTitles.tintinalli);
  assert.equal(sectionCatalog.textbooks.rosens.title, expectedTitles.rosens);
});

test("supplemental importers publish official book titles and English overview labels", async () => {
  const [supplementalImporter, rosensSectionImporter] = await Promise.all([
    readSource("scripts/import-supplemental-guides.mjs"),
    readSource("scripts/import-rosens-sections.mjs"),
  ]);

  for (const title of [expectedTitles.tintinalli, expectedTitles.rosens]) {
    assert.match(supplementalImporter, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(supplementalImporter, /const wholeBookOverviewTitle = "Whole-Book Overview"/u);
  assert.match(supplementalImporter, /normalizeWholeBookHeading\([\s\S]{0,240}tintinalliTitle/u);
  assert.match(supplementalImporter, /normalizeWholeBookHeading\(normalizedMarkdown\(rosensOverviewPath[\s\S]{0,120}rosensTitle\)/u);
  assert.match(rosensSectionImporter, /title: rosensTitle[\s\S]{0,140}title: wholeBookOverviewTitle/u);
  assert.doesNotMatch(supplementalImporter, /title: "(?:Tintinalli’s|Rosen’s) Emergency Medicine \d+e"|全書整合讀書指南/u);
});

test("reader, search, notes, and resume surfaces use canonical titles and English resource labels", async () => {
  const sources = await Promise.all([
    "app/views/supplemental-guide-view.tsx",
    "app/views/notebook-view.tsx",
    "app/components/global-spotlight.tsx",
    "app/question-bank-app.tsx",
  ].map(readSource));
  const [supplemental, notebook, spotlight, app] = sources;

  assert.match(supplemental, /Section Overviews \/ Whole-Book Overview/u);
  assert.match(supplemental, /Section \$\{entry\.section\} Overview/u);
  assert.match(supplemental, /normalizeSupplementalGuideMarkdownTitle\(selectedEntry, sanitizeStudyGuideMarkdown/u);
  assert.match(supplemental, /documentTitle=\{supplementalGuideDocumentTitle\(selectedEntry\)\}/u);
  assert.match(notebook, /\$\{textbook\} · Section \$\{sectionId\} Overview/u);
  assert.match(notebook, /Whole-Book Overview/u);
  assert.match(spotlight, /LEARNING_SOURCE_REGISTRY\.tintinalli\.title/u);
  assert.match(spotlight, /LEARNING_SOURCE_REGISTRY\.rosens\.title/u);
  assert.match(spotlight, /LEARNING_SOURCE_REGISTRY\.goldfrank\.title/u);
  assert.match(app, /\$\{textbookTitle\} · Whole-Book Overview/u);
  assert.match(app, /\$\{textbookTitle\} · Section \$\{supplementalSectionDisplayId\(source\.sectionId\)\} Overview/u);

  for (const source of sources) {
    assert.doesNotMatch(source, /全書整合讀書指南|全書指南|Section \$\{(?:entry\.)?section(?:Id)?\} 整合讀書指南/u);
  }
});

test("chapter reader catalog headers render official textbook names", async () => {
  const [tintinalli, rosens, sharedChapterReader] = await Promise.all([
    readSource("app/views/guide-view.tsx"),
    readSource("app/views/rosens-guide-view.tsx"),
    readSource("app/views/ems-guide-view.tsx"),
  ]);

  assert.match(tintinalli, /<h1>\{LEARNING_SOURCE_REGISTRY\.tintinalli\.title\}<\/h1>/u);
  assert.match(rosens, /<h1>\{LEARNING_SOURCE_REGISTRY\.rosens\.title\}<\/h1>/u);
  assert.match(sharedChapterReader, /currentTextbook: LEARNING_SOURCE_REGISTRY\.goldfrank\.title/u);
  assert.match(sharedChapterReader, /libraryTitle: LEARNING_SOURCE_REGISTRY\.goldfrank\.title/u);
});
