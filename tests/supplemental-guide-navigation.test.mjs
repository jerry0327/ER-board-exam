import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseAppHash, textbookGuideHash } from "../app/lib/app-route.ts";
import { supplementalGuideStartingChapter, tintinalliSectionFirstChapters } from "../app/lib/supplemental-guide-navigation.ts";
import { rosensChapters, rosensSections } from "../app/lib/rosens-catalog.ts";
import { rosensSupplementalSectionKeys } from "../app/lib/supplemental-guide-ids.ts";
import { parseSupplementalGuideManifest } from "../app/lib/supplemental-guides.ts";
import {
  normalizeTextbookAudioSectionId,
  rosensTextbookSections,
  tintinalliTextbookSections,
} from "../app/lib/textbook-audio-sections.ts";

const chapterManifest = JSON.parse(await readFile(new URL("../public/guides/manifest.json", import.meta.url), "utf8"));
const tintinalliManifest = JSON.parse(await readFile(new URL("../public/guides/tintinalli/manifest.json", import.meta.url), "utf8"));
const rosensManifest = JSON.parse(await readFile(new URL("../public/guides/rosens/supplemental-manifest.json", import.meta.url), "utf8"));

test("every Tintinalli Section quick start targets the first chapter in that Section", () => {
  const catalog = parseSupplementalGuideManifest("tintinalli", tintinalliManifest);
  const firstChapterBySection = new Map();
  for (const chapter of chapterManifest.chapters) {
    if (!firstChapterBySection.has(chapter.sectionId)) firstChapterBySection.set(chapter.sectionId, chapter.id);
  }

  assert.deepEqual(tintinalliSectionFirstChapters, catalog.entries.slice(1).map((entry) => firstChapterBySection.get(entry.section)));
  for (const entry of catalog.entries.slice(1)) {
    const target = supplementalGuideStartingChapter(entry);
    assert.equal(target, firstChapterBySection.get(entry.section));
    assert.deepEqual(parseAppHash(textbookGuideHash("tintinalli", target)), {
      view: "學習指引",
      resourceId: String(target),
      annotationId: null,
      textbookId: "tintinalli",
    });
  }
});

test("whole-book readers route to real chapter catalogs instead of their current overview", () => {
  const tintinalli = parseSupplementalGuideManifest("tintinalli", tintinalliManifest);
  const rosens = parseSupplementalGuideManifest("rosens", rosensManifest);
  assert.equal(supplementalGuideStartingChapter(tintinalli.entries[0]), 1);
  assert.equal(supplementalGuideStartingChapter(rosens.entries[0]), "001");
  assert.deepEqual(parseAppHash(textbookGuideHash("tintinalli")), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "tintinalli" });
  assert.deepEqual(parseAppHash(textbookGuideHash("rosens")), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
});

test("every Rosen’s Section quick start targets that Section’s first chapter", () => {
  const catalog = parseSupplementalGuideManifest("rosens", rosensManifest);
  assert.deepEqual(catalog.entries.slice(1).map((entry) => entry.section), rosensSupplementalSectionKeys);
  for (const [index, entry] of catalog.entries.slice(1).entries()) {
    const target = supplementalGuideStartingChapter(entry);
    assert.equal(target, rosensSections[index].chapterIds[0]);
    assert.equal(parseAppHash(textbookGuideHash("rosens", target)).resourceId, target);
  }
});

test("the lightweight audio taxonomy stays aligned with both textbook catalogs", () => {
  const tintinalli = parseSupplementalGuideManifest("tintinalli", tintinalliManifest);
  assert.equal(tintinalliTextbookSections.length, chapterManifest.sections.length);
  for (const [index, section] of tintinalliTextbookSections.entries()) {
    const manifestSection = chapterManifest.sections[index];
    const chapters = chapterManifest.chapters.filter((chapter) => chapter.sectionId === manifestSection.id);
    assert.deepEqual(
      [section.id, section.title, section.firstChapter, section.lastChapter],
      [String(manifestSection.id), manifestSection.title, chapters[0].id, chapters.at(-1).id],
    );
    assert.equal(tintinalli.entries[index + 1].section, Number(section.id));
  }

  assert.equal(rosensTextbookSections.length, rosensSections.length);
  for (const [index, section] of rosensTextbookSections.entries()) {
    const catalogSection = rosensSections[index];
    const first = rosensChapters.find((chapter) => chapter.id === catalogSection.chapterIds[0]);
    const last = rosensChapters.find((chapter) => chapter.id === catalogSection.chapterIds.at(-1));
    assert.deepEqual(
      [section.id, section.title, section.firstChapter, section.lastChapter, section.firstGuideChapterId],
      [catalogSection.id, catalogSection.title, first.ordinal, last.ordinal, catalogSection.chapterIds[0]],
    );
  }
});

test("supplemental Section ids resolve to the canonical textbook audio ids", () => {
  assert.equal(normalizeTextbookAudioSectionId("tintinalli", "07"), "7");
  assert.equal(normalizeTextbookAudioSectionId("rosens", "1-1"), "p1-s1");
  assert.equal(normalizeTextbookAudioSectionId("rosens", "3-10"), "p3-s10");
  assert.equal(normalizeTextbookAudioSectionId("rosens", "p5-s8"), "p5-s8");
});

test("textbook-root navigation opens the mobile catalog without recording a phantom Chapter 001 visit", async () => {
  const [app, wrapper, tintinalliReader, rosensReader] = await Promise.all([
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(app, /const openTextbookGuideLibrary = useCallback[\s\S]{0,420}textbookGuideHash\(textbookId\)/u);
  assert.match(app, /onOpenTextbookLibrary=\{openTextbookGuideLibrary\}/u);
  assert.match(wrapper, /onOpenChapterLibrary=\{\(\) => onOpenTextbookLibrary\(textbookId\)\}/u);
  for (const [reader, readyState] of [[tintinalliReader, "catalog"], [rosensReader, "manifest"]]) {
    assert.match(reader, new RegExp(`if \\(requestedChapter !== null \\|\\| !narrow \\|\\| !${readyState}\\) return;[\\s\\S]{0,100}setLibraryOpen\\(true\\)`, "u"));
    assert.match(reader, /if \(requestedChapter === null \|\|[^\n]*progressStatus === "loading"[^\n]*\) return;/u);
  }
});
