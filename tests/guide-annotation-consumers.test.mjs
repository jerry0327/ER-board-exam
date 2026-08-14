import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { searchSpotlight } from "../app/lib/spotlight.ts";

const chapter = {
  id: 61,
  title: "Acute Limb Ischemia",
  sectionId: 7,
  sectionTitle: "Cardiovascular Emergencies",
  printPage: 411,
  parts: [],
  available: true,
  markdownPath: "/guides/061.md",
  contentHash: "guide-061",
  linkedQuestionCount: 2,
  contents: {},
};

const annotation = {
  id: "h_gt061_full_table",
  questionId: "guide-tintinalli-061",
  kind: "excerpt",
  body: "",
  quote: "| Disease | Finding |\n| --- | --- |\n| ALI | Six Ps |",
  prefix: "",
  suffix: "",
  startOffset: null,
  endOffset: null,
  revision: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
  deletedAt: null,
};

const rosensChapter = {
  id: "001",
  displayId: "001",
  title: "Airway",
  ordinal: 1,
  volume: 1,
  part: "PART I",
  sectionId: "p1-s1",
  sectionLabel: "SECTION ONE",
  sectionTitle: "Resuscitation and Analgesia",
  kind: "core",
};

function guideAnnotation(id, questionId, body) {
  return { ...annotation, id, questionId, body, quote: "", kind: "question_note" };
}

test("spotlight resolves and searches learning-guide annotation metadata", () => {
  const byTitle = searchSpotlight({
    query: "Acute Limb Ischemia",
    questions: [],
    tintinalliChapters: [chapter],
    annotations: [annotation],
  });
  assert.equal(byTitle.annotations[0]?.annotation.questionId, "guide-tintinalli-061");
  assert.equal(byTitle.annotations[0]?.guide?.title, chapter.title);

  const bySection = searchSpotlight({
    query: "Cardiovascular Emergencies",
    questions: [],
    tintinalliChapters: [chapter],
    annotations: [annotation],
  });
  assert.equal(bySection.annotations[0]?.guide?.sectionTitle, chapter.sectionTitle);
});

test("spotlight resolves Rosen's chapters and supplemental guide annotations", () => {
  const rosensNote = guideAnnotation("rosens-note", "guide-rosens-001", "airway checklist");
  const rosensResult = searchSpotlight({
    query: "Rosen airway",
    questions: [],
    rosensChapters: [rosensChapter],
    annotations: [rosensNote],
  });
  assert.equal(rosensResult.annotations[0]?.guideSource?.textbook, "rosens");
  assert.equal(rosensResult.annotations[0]?.rosensChapter?.title, "Airway");

  const overview = searchSpotlight({
    query: "Rosen 全書",
    questions: [],
    annotations: [guideAnnotation("rosens-overview", "guide-rosens-overview", "")],
  });
  assert.equal(overview.annotations[0]?.guideSource?.resourceKind, "overview");

  const section = searchSpotlight({
    query: "Tintinalli Section 03",
    questions: [],
    annotations: [guideAnnotation("tintinalli-section", "guide-tintinalli-section-03", "")],
  });
  assert.equal(section.annotations[0]?.guideSource?.resourceKind, "section");
  assert.equal(section.annotations[0]?.annotation.questionId, "guide-tintinalli-section-03");

  const rosensSection = searchSpotlight({
    query: "Rosen Section 3-10",
    questions: [],
    annotations: [guideAnnotation("rosens-section", "guide-rosens-section-03-10", "")],
  });
  assert.equal(rosensSection.annotations[0]?.guideSource?.resourceKind, "section");
  assert.equal(rosensSection.annotations[0]?.guideSource?.textbook, "rosens");
});

test("notebook keeps guide resources source-aware and renders their Markdown", async () => {
  const source = await readFile(new URL("../app/views/notebook-view.tsx", import.meta.url), "utf8");
  assert.match(source, /guideProgressMap\?: ReadonlyMap<number, GuideProgressRecord>/u);
  assert.match(source, /guideResourceProgressMap\?: ReadonlyMap<string, GuideResourceProgressRecord>/u);
  assert.match(source, /parseAnyGuideAnnotationResourceId\(annotation\.questionId\)/u);
  assert.match(source, /new Map\(rosensChapters\.map/u);
  assert.match(source, /guideResourceProgressMap\.get\(guideSource\.resourceId\)/u);
  assert.match(source, /LEARNING_SOURCE_REGISTRY\.rosens\.title/u);
  assert.match(source, /const textbook = LEARNING_SOURCE_REGISTRY\[source\.textbook\]\.title/u);
  assert.match(source, /\$\{textbook\} · Section \$\{sectionId\} Overview/u);
  assert.match(source, /Whole-Book Overview/u);
  assert.doesNotMatch(source, /全書整合讀書指南|Section \$\{sectionId\} 整合讀書指南/u);
  assert.match(source, /guideSource \|\| progress\?\.wrongState/u);
  assert.match(source, /guideSource \|\| !\(progress\?\.dueAt/u);
  assert.match(source, /MarkdownContent markdown=\{annotation\.quote\} variant="annotation"/u);
  assert.match(source, /MarkdownContent markdown=\{annotation\.body\} variant="annotation"/u);
  assert.match(source, /annotation\.quote && annotation\.kind === "excerpt"/u);
  assert.match(source, /guideSource && annotation\.kind === "question_note"/u);
  assert.match(source, /annotation\.kind === "excerpt" \? "內容摘錄" : "筆記"/u);
  assert.match(source, /annotation\.kind === "excerpt" \? NotebookPen : BookMarked/u);
  assert.match(source, /className="notebook-kind" role="img" aria-label=\{kindLabel\}/u);
  assert.match(source, /onOpenAnnotation\(annotation\.questionId, annotation\.id\)/u);
});
