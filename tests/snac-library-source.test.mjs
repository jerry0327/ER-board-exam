import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeRetainedSnacEntry,
  parseSnacSourceFilename,
  resolveSnacCollectionSourceMode,
  resolveSnacSourceDisplayTitle,
} from "../scripts/lib/snac-library-source.mjs";

const config = JSON.parse(await readFile(new URL("../scripts/snac-library.config.json", import.meta.url), "utf8"));
const collectionById = new Map(config.collections.map((collection) => [collection.id, collection]));
const goldfrankChapterCatalog = JSON.parse(await readFile(
  new URL("../app/data/goldfrank-chapters.json", import.meta.url),
  "utf8",
));
const rosensChapterCatalog = JSON.parse(await readFile(
  new URL("../app/data/rosens-chapters.json", import.meta.url),
  "utf8",
));
const tintinalliChapterCatalog = JSON.parse(await readFile(
  new URL("../app/data/tintinalli-chapters.json", import.meta.url),
  "utf8",
));

function withCanonicalTitles(collection, catalog) {
  return {
    ...collection,
    itemTitles: Object.fromEntries(catalog.chapters.map((chapter) => [chapter.id, chapter.title])),
  };
}

const canonicalSources = [
  ["goldfrank", "../../outputs/03_audio/goldfrank/snac", "goldfrank-CH001.snac.json", "001"],
  ["rosens", "../../outputs/03_audio/rosens/snac", "rosens-CH001.snac.json", "001"],
  ["tintinalli", "../../outputs/03_audio/tintinalli/snac", "tintinalli-CH001.snac.json", "001"],
  ["questions", "../../outputs/03_audio/question-bank/snac", "094-Q001-Q005.snac.json", "094_Q001-Q005"],
  ["board-guides", "../../outputs/03_audio/board-guides/snac", "board-guide-10A.snac.json", "10A"],
  ["ems", "../../outputs/03_audio/ems/snac", "ems-CH001.snac.json", "001"],
  ["tintinalli-sections", "../../outputs/03_audio/tintinalli/snac", "tintinalli-SE001.snac.json", "001"],
  ["tintinalli-overview", "../../outputs/03_audio/tintinalli/snac", "tintinalli-WHOLE.snac.json", "WHOLE"],
  ["rosens-sections", "../../outputs/03_audio/rosens/snac", "rosens-SE01-01.snac.json", "01-01"],
  ["rosens-overview", "../../outputs/03_audio/rosens/snac", "rosens-WHOLE.snac.json", "WHOLE"],
];

test("SNAC source config targets the flattened canonical audio layout", () => {
  for (const [collectionId, sourceDirectory, filename, resourceId] of canonicalSources) {
    const collection = collectionById.get(collectionId);
    assert(collection, collectionId);
    assert.equal(collection.sourceDirectory, sourceDirectory, collectionId);
    assert.equal(parseSnacSourceFilename(collection, filename)?.resourceId, resourceId, collectionId);
  }
});

test("shared textbook directories keep each collection filename namespace isolated", () => {
  const rosensFiles = [
    "rosens-SE01-01.snac.json",
    "rosens-WHOLE.snac.json",
  ];
  assert.equal(rosensFiles.filter((filename) => parseSnacSourceFilename(collectionById.get("rosens"), filename)).length, 0);
  assert.equal(rosensFiles.filter((filename) => parseSnacSourceFilename(collectionById.get("rosens-sections"), filename)).length, 1);
  assert.equal(rosensFiles.filter((filename) => parseSnacSourceFilename(collectionById.get("rosens-overview"), filename)).length, 1);
  assert.equal(parseSnacSourceFilename(collectionById.get("rosens-sections"), "rosens-CH001.snac.json"), null);
  assert.equal(parseSnacSourceFilename(collectionById.get("rosens-overview"), "rosens-CH001.snac.json"), null);

  const tintinalliFiles = [
    "tintinalli-SE001.snac.json",
    "tintinalli-WHOLE.snac.json",
  ];
  assert.equal(tintinalliFiles.filter((filename) => parseSnacSourceFilename(collectionById.get("tintinalli"), filename)).length, 0);
  assert.equal(tintinalliFiles.filter((filename) => parseSnacSourceFilename(collectionById.get("tintinalli-sections"), filename)).length, 1);
  assert.equal(tintinalliFiles.filter((filename) => parseSnacSourceFilename(collectionById.get("tintinalli-overview"), filename)).length, 1);
  assert.equal(parseSnacSourceFilename(collectionById.get("tintinalli-sections"), "tintinalli-CH001.snac.json"), null);
  assert.equal(parseSnacSourceFilename(collectionById.get("tintinalli-overview"), "tintinalli-CH001.snac.json"), null);
});

test("retention applies only to an absent source or zero canonical matches", () => {
  const collection = collectionById.get("rosens");
  assert.equal(resolveSnacCollectionSourceMode({
    collection,
    sourceDirectoryExists: false,
    matchingMetadataCount: 0,
  }), "retain-existing");
  assert.equal(resolveSnacCollectionSourceMode({
    collection,
    sourceDirectoryExists: true,
    matchingMetadataCount: 0,
  }), "retain-existing");
  assert.throws(() => resolveSnacCollectionSourceMode({
    collection,
    sourceDirectoryExists: true,
    matchingMetadataCount: 1,
  }), /expected 208 metadata files, found 1/u);
  assert.throws(() => resolveSnacCollectionSourceMode({
    collection,
    sourceDirectoryExists: true,
    matchingMetadataCount: collection.expectedItems - 1,
  }), /expected 208 metadata files, found 207/u);
  assert.equal(resolveSnacCollectionSourceMode({
    collection,
    sourceDirectoryExists: true,
    matchingMetadataCount: collection.expectedItems,
  }), "import-source");

  assert.throws(() => resolveSnacCollectionSourceMode({
    collection: collectionById.get("rosens-sections"),
    sourceDirectoryExists: true,
    matchingMetadataCount: 0,
  }), /expected 27 metadata files, found 0/u);
});

test("question filenames retain their deployed stable resource identity", () => {
  const collection = collectionById.get("questions");
  const parsed = parseSnacSourceFilename(collection, "094-Q001-Q005.snac.json");
  assert(parsed);
  assert.equal(parsed.resourceId, "094_Q001-Q005");
  assert.equal(`${collection.entryIdPrefix}${parsed.resourceId.toLowerCase()}`, "questions-094_q001-q005");
  assert.equal(parsed.match.groups.examLabel, "094");
  assert.equal(parsed.match.groups.questionStart, "001");
  assert.equal(parsed.match.groups.questionEnd, "005");
});

test("title-free canonical filenames produce structured display titles", () => {
  const questions = collectionById.get("questions");
  const parsedQuestions = parseSnacSourceFilename(questions, "094-Q001-Q005.snac.json");
  assert.equal(resolveSnacSourceDisplayTitle({
    collection: questions,
    ...parsedQuestions,
    filename: "094-Q001-Q005.snac.json",
  }), "094 · Q001–Q005");

  const rosens = withCanonicalTitles(collectionById.get("rosens"), rosensChapterCatalog);
  const parsedRosens = parseSnacSourceFilename(rosens, "rosens-CH001.snac.json");
  assert.equal(resolveSnacSourceDisplayTitle({
    collection: rosens,
    ...parsedRosens,
    filename: "rosens-CH001.snac.json",
  }), "Airway");

  assert.equal(resolveSnacSourceDisplayTitle({
    collection: rosens,
    ...parsedRosens,
    existingTitle: "Airway",
    filename: "rosens-CH001.snac.json",
  }), "Airway");

  const tintinalli = withCanonicalTitles(collectionById.get("tintinalli"), tintinalliChapterCatalog);
  const parsedTintinalli = parseSnacSourceFilename(tintinalli, "tintinalli-CH029.snac.json");
  assert.equal(resolveSnacSourceDisplayTitle({
    collection: tintinalli,
    ...parsedTintinalli,
    existingTitle: "Tracheal Intubation",
    filename: "tintinalli-CH029.snac.json",
  }), "Tracheal Intubation / Mechanical Ventilation");

  const goldfrank = {
    ...collectionById.get("goldfrank"),
    itemTitles: Object.fromEntries(
      goldfrankChapterCatalog.chapters.map((chapter) => [chapter.id, chapter.title]),
    ),
  };
  const parsedGoldfrank = parseSnacSourceFilename(goldfrank, "goldfrank-CH001.snac.json");
  assert.equal(resolveSnacSourceDisplayTitle({
    collection: goldfrank,
    ...parsedGoldfrank,
    filename: "goldfrank-CH001.snac.json",
  }), "Historical Principles and Perspectives");

  const boardGuides = collectionById.get("board-guides");
  const parsedBoardGuide = parseSnacSourceFilename(boardGuides, "board-guide-10A.snac.json");
  assert.equal(resolveSnacSourceDisplayTitle({
    collection: boardGuides,
    ...parsedBoardGuide,
    filename: "board-guide-10A.snac.json",
  }), "題庫學習指引 10A");

  const rosensSections = collectionById.get("rosens-sections");
  const parsedRosensSection = parseSnacSourceFilename(rosensSections, "rosens-SE01-01.snac.json");
  assert.equal(resolveSnacSourceDisplayTitle({
    collection: rosensSections,
    ...parsedRosensSection,
    sectionTitle: "Resuscitation and Analgesia",
    filename: "rosens-SE01-01.snac.json",
  }), "Resuscitation and Analgesia");
});

test("retained textbook entries receive canonical titles and current English collection metadata", () => {
  const rosens = withCanonicalTitles(collectionById.get("rosens"), rosensChapterCatalog);
  const retainedChapter = normalizeRetainedSnacEntry({
    collection: rosens,
    entry: {
      chapterId: "128",
      title: "Nonfreezing Cold Injuries",
      collectionTitle: "Rosen's Emergency Medicine",
    },
  });
  assert.equal(retainedChapter.title, "Hypothermia, Frostbite, and Non-freezing Cold Injuries");
  assert.equal(retainedChapter.collectionTitle, "Rosen’s Emergency Medicine: Concepts and Clinical Practice");

  const overview = collectionById.get("tintinalli-overview");
  const retainedOverview = normalizeRetainedSnacEntry({
    collection: overview,
    entry: {
      chapterId: "WHOLE",
      title: "全書速讀總覽",
      collectionTitle: "Tintinalli 全書速讀",
      libraryTitle: "Tintinalli's Emergency Medicine",
      sectionLabel: "全書",
      sectionTitle: "全書速讀總覽",
    },
  });
  assert.equal(retainedOverview.title, "Whole-Book Overview");
  assert.equal(retainedOverview.sectionTitle, "Whole-Book Overview");
  assert.equal(retainedOverview.sectionLabel, "Whole Book");
  assert.equal(retainedOverview.collectionTitle, "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide — Whole-Book Overview");
  assert.equal(retainedOverview.libraryTitle, "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide");
});
