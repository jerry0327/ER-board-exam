import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { learningDocuments } from "../app/lib/learning-documents.ts";
import {
  SPOTLIGHT_MAX_RESULTS,
  SPOTLIGHT_OFFICIAL_RESOURCES,
  SPOTLIGHT_QUICK_VIEWS,
  SPOTLIGHT_RESULT_LIMITS,
  safeSpotlightResourceHref,
  searchSpotlight,
} from "../app/lib/spotlight.ts";
import { readLegacyCss } from "./css-test-utils.mjs";

const component = await readFile(new URL("../app/components/global-spotlight.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/spotlight.css", import.meta.url), "utf8");
const globalCss = await readLegacyCss();
const siteCss = await readFile(new URL("../app/site.css", import.meta.url), "utf8");
const app = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const routes = await readFile(new URL("../app/lib/app-route.ts", import.meta.url), "utf8");

function question(id, title, extras = {}) {
  const [exam, number = "1"] = id.split("-Q");
  return {
    id,
    exam,
    year: Number(exam.replace(/\D/gu, "")) || 115,
    number: Number(number),
    title,
    stem: `${title} clinical stem`,
    answerKeys: ["A"],
    allCredit: false,
    questionType: "single best answer",
    focus: "Emergency Medicine",
    category: "Critical care",
    sourceSections: [],
    images: [],
    ...extras,
  };
}

const questions = [
  question("115B-Q200", "Warfarin-induced skin necrosis", { searchText: "painful purpura thrombotic necrosis" }),
  question("114A-Q012", "Methemoglobinemia", { searchText: "methemoglobinemia methylene blue cyanosis" }),
];

const tintinalli = [{
  id: 12,
  title: "Approach to Nontraumatic Shock",
  sectionId: 2,
  sectionTitle: "Resuscitation",
  printPage: 88,
  parts: [{ part: null, title: "Shock", printPage: 88 }],
  available: true,
  markdownPath: "/guides/012.md",
  contentHash: "abc",
  linkedQuestionCount: 2,
  contents: {},
}];

const rosens = [
  {
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
  },
  {
    id: "e08",
    displayId: "E08",
    title: "Chemical Agents",
    ordinal: 200,
    volume: 2,
    part: "ONLINE",
    sectionId: "online",
    sectionLabel: "ONLINE CHAPTERS",
    sectionTitle: "Special Operations",
    kind: "echapter",
  },
];

const goldfrank = [{
  id: "140",
  number: 140,
  title: "Postmortem Toxicology",
  order: 140,
  bytes: 10_000,
  contentHash: "c".repeat(64),
  markdownPath: "/guides/goldfrank/chapters/140.md",
  modes: {
    quick: { headingTitle: "Postmortem Toxicology Rapid Review", bytes: 3_000, contentHash: "a".repeat(64), sourceSha256: "1".repeat(64), markdownPath: "/guides/goldfrank/chapters/140-quick.md" },
    standard: { headingTitle: "Forensic Interpretation of Postmortem Drug Levels", bytes: 6_000, contentHash: "b".repeat(64), sourceSha256: "2".repeat(64), markdownPath: "/guides/goldfrank/chapters/140-standard.md" },
    full: { headingTitle: "Postmortem Toxicology", bytes: 10_000, contentHash: "c".repeat(64), sourceSha256: "3".repeat(64), markdownPath: "/guides/goldfrank/chapters/140.md" },
  },
}];

const audio = [{
  id: "rosens-001",
  collectionId: "rosens",
  collectionTitle: "Rosen's Emergency Medicine",
  kind: "textbook-chapter",
  sequence: 1,
  textbook: "rosens",
  chapterId: "001",
  chapterLabel: "CH.001",
  title: "Airway",
  file: "releases/abcdef123456/Rosens_CH001_Airway",
  durationSeconds: 900,
  encodedSpeed: 1.4,
  revision: "abcdef123456",
  dataBytes: 1000,
  dataSha256: "a".repeat(64),
  metadataBytes: 100,
  metadataSha256: "b".repeat(64),
}];

const annotations = [{
  id: "note-1",
  questionId: "115B-Q200",
  kind: "question_note",
  body: "HIT confusion and thrombosis distinction",
  quote: "",
  prefix: "",
  suffix: "",
  startOffset: null,
  endOffset: null,
  revision: 1,
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
  deletedAt: null,
}];

test("spotlight searches questions, guides, runtime audio, documents, and annotations", () => {
  assert.equal(searchSpotlight({ query: "115B Q200", questions }).questions[0]?.id, "115B-Q200");
  assert.equal(searchSpotlight({ query: "methylene blue", questions }).questions[0]?.id, "114A-Q012");
  assert.equal(searchSpotlight({ query: "chapter 12", questions, tintinalliChapters: tintinalli }).tintinalli[0]?.id, 12);
  assert.equal(searchSpotlight({ query: "Rosen airway", questions, rosensChapters: rosens }).rosens[0]?.id, "001");
  assert.equal(searchSpotlight({ query: "chapter 200", questions, rosensChapters: rosens }).rosens[0]?.ordinal, 200);
  assert.equal(searchSpotlight({ query: "Goldfrank chapter 140", questions, goldfrankChapters: goldfrank }).goldfrank[0]?.id, "140");
  assert.equal(searchSpotlight({ query: "airway", questions, audioSummaries: audio }).audio[0]?.id, "rosens-001");
  assert.equal(searchSpotlight({ query: "PDF", questions, learningDocuments }).documents[0]?.id, "emergency-clinical-decision-atlas");
  assert.equal(searchSpotlight({ query: "HIT confusion", questions, annotations }).annotations[0]?.annotation.id, "note-1");
});

test("spotlight indexes Goldfrank manifest chapters by title and reading topic", () => {
  assert.equal(searchSpotlight({ query: "postmortem toxicology", questions, goldfrankChapters: goldfrank }).goldfrank[0]?.id, "140");
  assert.equal(searchSpotlight({ query: "forensic interpretation drug levels", questions, goldfrankChapters: goldfrank }).goldfrank[0]?.title, "Postmortem Toxicology");
});

test("quick navigation is consolidated and the product search omits external resource cards", () => {
  assert.deepEqual(SPOTLIGHT_QUICK_VIEWS, [
    "\u7e3d\u89bd",
    "\u958b\u59cb\u4f5c\u7b54",
    "\u5b78\u7fd2\u6307\u5f15",
    "\u932f\u984c\u672c",
    "\u5099\u8003\u4e2d\u5fc3",
  ]);
  const audioResults = searchSpotlight({ query: "audio audiobook", questions, audioSummaries: audio, resources: [] });
  assert.equal(audioResults.navigation[0]?.view, "\u5b78\u7fd2\u97f3\u6a94");
  assert.deepEqual(audioResults.resources, []);

  const chapterAudioResults = searchSpotlight({ query: "CH.001 airway", questions, audioSummaries: audio, resources: [] });
  assert.equal(chapterAudioResults.audio[0]?.id, "rosens-001");

  const documentResults = searchSpotlight({ query: "PDF", questions, learningDocuments, resources: [] });
  assert.equal(documentResults.documents[0]?.id, "emergency-clinical-decision-atlas");
  assert.deepEqual(documentResults.resources, []);
});

test("spotlight caps every group and the complete result set", () => {
  const manyQuestions = Array.from({ length: 60 }, (_, index) => question(
    `115A-Q${String(index + 1).padStart(3, "0")}`,
    `Shock case ${index + 1}`,
    { searchText: "shock" },
  ));
  const results = searchSpotlight({
    query: "shock",
    questions: manyQuestions,
    tintinalliChapters: tintinalli,
    goldfrankChapters: goldfrank,
    resources: [],
  });
  assert.ok(results.questions.length <= SPOTLIGHT_RESULT_LIMITS.questions);
  assert.ok(results.tintinalli.length <= SPOTLIGHT_RESULT_LIMITS.tintinalli);
  assert.ok(results.goldfrank.length <= SPOTLIGHT_RESULT_LIMITS.goldfrank);
  assert.ok(results.audio.length <= SPOTLIGHT_RESULT_LIMITS.audio);
  assert.ok(results.documents.length <= SPOTLIGHT_RESULT_LIMITS.documents);
  assert.ok(results.count <= SPOTLIGHT_MAX_RESULTS);
});

test("retained official resource data permits only HTTPS allowlisted hosts", () => {
  for (const resource of SPOTLIGHT_OFFICIAL_RESOURCES) assert.ok(safeSpotlightResourceHref(resource.href));
  const societyNews = SPOTLIGHT_OFFICIAL_RESOURCES.find((resource) => resource.id === "tsem-announcements");
  assert.equal(societyNews?.href, "https://www.sem.org.tw/News");
  assert.deepEqual(SPOTLIGHT_OFFICIAL_RESOURCES.slice(0, 3).map((resource) => resource.id), ["tsem-courses", "tsem-forms", "tsem-learning-platform"]);
  assert.equal(safeSpotlightResourceHref("http://www.sem.org.tw/News/7/Index"), null);
  assert.equal(safeSpotlightResourceHref("https://www.sem.org.tw.evil.example/"), null);
  assert.equal(safeSpotlightResourceHref("https://user:password@www.sem.org.tw/"), null);
  assert.equal(safeSpotlightResourceHref("javascript:alert(1)"), null);
});

test("spotlight component exposes keyboard, runtime loading, and internal callbacks", () => {
  assert.match(component, /useDialogFocus\(open, dialogRef, closeSpotlight\)/u);
  assert.match(component, /event\.metaKey.*event\.ctrlKey/u);
  assert.match(component, /event\.key\.toLocaleLowerCase\(\) !== "k"/u);
  assert.match(component, /document\.querySelector<HTMLElement>\("\[aria-modal='true'\]"\)/u);
  assert.match(component, /activeModal\.id !== "global-spotlight-dialog"/u);
  assert.match(component, /aria-keyshortcuts="Control\+K Meta\+K"/u);
  assert.match(component, /role="dialog"[\s\S]{0,120}aria-modal="true"/u);
  assert.match(component, /loadSearchCatalog\(\)/u);
  assert.match(component, /loadStudyGuideCatalog\(\)/u);
  assert.match(component, /loadGoldfrankGuideManifest\(\)/u);
  assert.match(component, /setGoldfrankChapters\(manifest\.chapters\)/u);
  assert.match(component, /loadAudioSummaryCatalog\(\)\.then\(setAudioCatalog\)/u);
  assert.match(component, /audioSummaries: audioCatalog/u);
  assert.match(component, /learningDocuments,/u);
  assert.match(component, /resources: \[\]/u);
  assert.match(component, /onOpenReader\(question\.id\)/u);
  assert.match(component, /onOpenTintinalli\(chapter\.id\)/u);
  assert.match(component, /onOpenRosens\(chapter\.id\)/u);
  assert.match(component, /onOpenGoldfrank\(chapter\.id\)/u);
  assert.match(component, /onPlayAudio\(source\)/u);
  assert.match(component, /onOpenDocument\(document\.id\)/u);
  assert.match(component, /onOpenAnnotation\(annotation\.questionId, annotation\.id\)/u);
  assert.match(component, /onOpenRosens\(guideSource\.resourceKind === "chapter"[\s\S]{0,180}`section-\$\{guideSource\.sectionId\}`\)/u);
  assert.match(component, /onOpenTintinalli\(guideSource\.chapter\)/u);
  assert.match(component, /onOpenTintinalli\(guideSource\.resourceKind === "overview" \? "overview" : `section-\$\{guideSource\.sectionId\}`\)/u);
  assert.match(component, /guideSource\.resourceKind === "chapter" \? "\u7ae0\u7bc0\u7b46\u8a18" : "\u6307\u5357\u7b46\u8a18"/u);
  assert.match(component, /onStartQuestions\(\[question\.id\]\)/u);
  assert.doesNotMatch(component, /SPOTLIGHT_OFFICIAL_RESOURCES|rel="noopener noreferrer"|target="_blank"/u);
});

test("Goldfrank chapter results use a dedicated group, visible title, topic, and open callback", () => {
  assert.match(component, /results\.goldfrank\.length > 0/u);
  assert.match(component, /id="spotlight-goldfrank-heading">\{LEARNING_SOURCE_REGISTRY\.goldfrank\.title\}<\/h3>/u);
  assert.match(component, /Chapter \{chapter\.id\}・\{chapter\.title\}/u);
  assert.match(component, /<small>\{LEARNING_SOURCE_REGISTRY\.goldfrank\.title\} · 11th Edition<\/small>/u);
  assert.match(component, /onClick=\{\(\) => perform\(\(\) => onOpenGoldfrank\(chapter\.id\)\)\}/u);
});

test("spotlight result surfaces reuse shared card and button primitives", () => {
  const resultClassNames = [...component.matchAll(/className="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((className) => className.split(/\s+/u).includes("spotlight-result"));
  assert.ok(resultClassNames.length > 0);
  assert.ok(resultClassNames.every((className) => className.split(/\s+/u).includes("quiet-button")));
  assert.match(component, /className="paper-card spotlight-question-result"/u);
  assert.match(component, /className="quiet-button spotlight-practice-one"/u);
  assert.doesNotMatch(css, /\.spotlight-(?:result|question-result|practice-one)(?![-\w])[^,{]*\{[^}]*(?:background(?:-color)?|border(?:-[\w-]+)?|box-shadow|color)\s*:/su);
});

test("main shell integrates consolidated navigation and all search callbacks", () => {
  assert.match(layout, /import "\.\/site\.css";/u);
  assert.match(siteCss, /@import "\.\/spotlight\.css" layer\(legacy\);/u);
  assert.match(component, /const navigationIcons: Record<NavView, LucideIcon>/u);
  assert.match(routes, /audio: "\u5b78\u7fd2\u97f3\u6a94"/u);
  assert.match(routes, /documents: "\u5b78\u7fd2\u6587\u4ef6"/u);
  assert.match(app, /const primaryNavItems = \[[\s\S]*?label: "\u5b78\u7fd2"/u);
  assert.match(app, /const GlobalSpotlight = lazy\(loadGlobalSpotlight\)/u);
  assert.match(app, /<div className="topbar-actions">[\s\S]*?spotlightInitiallyOpen && fullQuestionIndexReady \? \([\s\S]*?<GlobalSpotlight/u);
  assert.match(app, /const requestSpotlight = useCallback[\s\S]*?loadGlobalSpotlight\(\)[\s\S]*?ensureFullQuestionBank\(\)[\s\S]*?setSpotlightLoadFailed\(true\)/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}questions=\{questions\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}annotations=\{annotations\.annotations\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onOpenReader=\{openReader\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onOpenAnnotation=\{openAnnotation\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onOpenTintinalli=\{openGuide\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onOpenRosens=\{openRosensGuide\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onOpenGoldfrank=\{openGoldfrankGuide\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onPlayAudio=/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onOpenDocument=\{selectLearningDocument\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onNavigate=\{navigate\}/u);
  assert.match(app, /<GlobalSpotlight[\s\S]{0,700}onStartQuestions=\{openPracticeIds\}/u);
});

test("spotlight stylesheet becomes a full-screen sheet on mobile", () => {
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.spotlight-dialog \{[\s\S]*height: 100dvh;[\s\S]*max-height: none;/u);
  assert.match(css, /@media \(max-width: 1480px\)[\s\S]*\.spotlight-trigger \{[\s\S]*min-width: 42px;[\s\S]*width: 42px;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.spotlight-trigger \{ height: 38px; min-width: 38px; width: 38px; \}/u);
  assert.match(globalCss, /@media \(max-width: 960px\) \{[\s\S]*\.desktop-nav \{ display: none; \}[\s\S]*\.mobile-menu \{ display: inline-flex; \}/u);
  assert.match(css, /\.spotlight-overlay \{[\s\S]*position: fixed;[\s\S]*z-index: 160;/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
});
