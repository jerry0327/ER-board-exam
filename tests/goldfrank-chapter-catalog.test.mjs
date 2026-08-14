import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseSnacSourceFilename,
  resolveSnacSourceDisplayTitle,
} from "../scripts/lib/snac-library-source.mjs";

const [catalog, config, guideImporter, audioImporter] = await Promise.all([
  readFile(new URL("../app/data/goldfrank-chapters.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../scripts/snac-library.config.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../scripts/import-goldfrank-guide.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/import-snac-library.mjs", import.meta.url), "utf8"),
]);

const catalogRelativePath = "../app/data/goldfrank-chapters.json";
const goldfrankCollection = config.collections.find((collection) => collection.id === "goldfrank");
const canonicalTitles = Object.fromEntries(
  catalog.chapters.map((chapter) => [chapter.id, chapter.title]),
);

test("Goldfrank 11e canonical chapter catalog is complete, contiguous, and English", () => {
  assert.equal(catalog.schema, "em-board-goldfrank-chapters-v1");
  assert.equal(catalog.edition, "11e");
  assert.equal(catalog.isbn, "9781259859618");
  assert.equal(catalog.chapterCount, 140);
  assert.equal(catalog.chapters.length, 140);
  assert.equal(
    catalog.provenance.bibliographicSource,
    "https://accessemergencymedicine.mhmedical.com/content.aspx?bookid=2569&sectionid=210256528",
  );
  assert.equal(
    catalog.provenance.tableOfContentsSource,
    "https://hsc-catalog.ku.edu.kw/record%3Db1025970",
  );

  for (let index = 0; index < catalog.chapters.length; index += 1) {
    const expectedNumber = index + 1;
    const expectedId = String(expectedNumber).padStart(3, "0");
    const chapter = catalog.chapters[index];
    assert.equal(chapter.number, expectedNumber, expectedId);
    assert.equal(chapter.id, expectedId, expectedId);
    assert.equal(chapter.title, chapter.title.trim(), expectedId);
    assert.doesNotMatch(chapter.title, /\p{Script=Han}/u, expectedId);
  }

  assert.equal(new Set(catalog.chapters.map((chapter) => chapter.id)).size, 140);
  assert.equal(new Set(catalog.chapters.map((chapter) => chapter.title.normalize("NFC"))).size, 140);
  assert.deepEqual(catalog.chapters[0], {
    id: "001",
    number: 1,
    title: "Historical Principles and Perspectives",
  });
  assert.deepEqual(catalog.chapters.at(-1), {
    id: "140",
    number: 140,
    title: "Postmortem Toxicology",
  });
  assert.equal(canonicalTitles["012"], "Fluid, Electrolyte, and Acid–Base Principles");
  assert.equal(canonicalTitles["059"], "β-Adrenergic Antagonists");
  assert.equal(canonicalTitles["063"], "Methylxanthines and Selective β2-Adrenergic Agonists");
  assert.equal(canonicalTitles["072"], "Sedative–Hypnotics");
  assert.equal(canonicalTitles["080"], "γ-Hydroxybutyric Acid (γ-Hydroxybutyrate)");
  assert.equal(canonicalTitles["110"], "Insecticides: Organic Phosphorus Compounds and Carbamates");
});

test("Goldfrank guide and audio imports share the canonical chapter catalog", () => {
  assert(goldfrankCollection);
  assert.equal(goldfrankCollection.expectedItems, 140);
  assert.equal(goldfrankCollection.canonicalTitleCatalog, catalogRelativePath);
  assert.equal(goldfrankCollection.canonicalTitleCatalogSchema, catalog.schema);
  assert.equal(goldfrankCollection.defaultTitleTemplate, undefined);
  assert.match(guideImporter, /chapterCatalogRelativePath = "\.\.\/app\/data\/goldfrank-chapters\.json"/u);
  assert.match(guideImporter, /replace\(\/\^#\\s\+\.\+\$\/mu, \(\) => `# \$\{canonicalTitle\}`\)/u);
  assert.match(guideImporter, /headingTitle: learnerHeading\[1\]\.trim\(\)/u);
  assert.match(guideImporter, /title: canonicalTitle/u);
  assert.match(audioImporter, /loadCanonicalTitleCatalog/u);
  assert.match(audioImporter, /collection\.canonicalTitleCatalog/u);
  assert.match(audioImporter, /itemTitles\[chapter\.id\] = chapter\.title\.trim\(\)/u);
  assert.match(audioImporter, /normalizeRetainedSnacEntry\(\{ collection, entry, sectionMetadata \}\)/u);
  assert.doesNotMatch(JSON.stringify(goldfrankCollection), /Goldfrank Chapter/u);
});

test("Goldfrank SNAC titles resolve to original chapter names for CH001 and CH140", () => {
  const collection = { ...goldfrankCollection, itemTitles: canonicalTitles };
  for (const [id, expectedTitle] of [
    ["001", "Historical Principles and Perspectives"],
    ["140", "Postmortem Toxicology"],
  ]) {
    const filename = `goldfrank-CH${id}.snac.json`;
    const parsed = parseSnacSourceFilename(collection, filename);
    assert(parsed);
    assert.equal(resolveSnacSourceDisplayTitle({
      collection,
      ...parsed,
      existingTitle: `Goldfrank Chapter ${id}`,
      filename,
    }), expectedTitle);
  }
});
