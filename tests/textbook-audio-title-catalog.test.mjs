import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rosensChapters } from "../app/lib/rosens-catalog.ts";
import { logicalContentEntries } from "../scripts/lib/static-content-codec.mjs";

const tintinalliCatalog = JSON.parse(await readFile(
  new URL("../app/data/tintinalli-chapters.json", import.meta.url),
  "utf8",
));
const rosensCatalog = JSON.parse(await readFile(
  new URL("../app/data/rosens-chapters.json", import.meta.url),
  "utf8",
));
const config = JSON.parse(await readFile(
  new URL("../scripts/snac-library.config.json", import.meta.url),
  "utf8",
));
const collectionById = new Map(config.collections.map((collection) => [collection.id, collection]));

function assertContiguousEnglishCatalog(catalog, expectedSchema, expectedCount) {
  assert.equal(catalog.schema, expectedSchema);
  assert.equal(catalog.chapterCount, expectedCount);
  assert.equal(catalog.chapters.length, expectedCount);
  assert.equal(new Set(catalog.chapters.map((chapter) => chapter.title)).size, expectedCount);
  for (const [index, chapter] of catalog.chapters.entries()) {
    const number = index + 1;
    assert.equal(chapter.number, number);
    assert.equal(chapter.id, String(number).padStart(3, "0"));
    assert.equal(chapter.title, chapter.title.trim());
    assert.doesNotMatch(chapter.title, /\p{Script=Han}/u);
  }
}

test("Rosen audio titles exactly follow all 208 canonical catalog entries", () => {
  assertContiguousEnglishCatalog(rosensCatalog, "em-board-rosens-chapters-v1", 208);
  assert.deepEqual(
    rosensCatalog.chapters.map(({ sourceId, title }) => ({ sourceId, title })),
    rosensChapters.map(({ id: sourceId, title }) => ({ sourceId, title })),
  );
  assert.equal(rosensCatalog.chapters[127].title, "Hypothermia, Frostbite, and Non-freezing Cold Injuries");
  assert.equal(rosensCatalog.chapters[184].title, "The Combative and Difficult Patient");
  assert.equal(rosensCatalog.chapters[203].title, "Emergency Medical Services: Overview and Ground Transport");
});

test("Tintinalli audio titles exactly follow the 303-chapter canonical guide manifest", () => {
  assertContiguousEnglishCatalog(tintinalliCatalog, "em-board-tintinalli-chapters-v1", 303);
  const packedContent = new Map(logicalContentEntries());
  const manifestBytes = packedContent.get("guides/manifest.json");
  assert(manifestBytes, "Tintinalli guide manifest must remain in the logical content pack");
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  assert.deepEqual(
    tintinalliCatalog.chapters.map(({ id, title }) => ({ id: Number(id), title })),
    manifest.chapters.map(({ id, title }) => ({ id, title })),
  );
  assert.equal(tintinalliCatalog.chapters[28].title, "Tracheal Intubation / Mechanical Ventilation");
});

test("Tintinalli and Rosen SNAC collections expose only full official English names", () => {
  const expected = new Map([
    ["tintinalli", "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide"],
    ["tintinalli-sections", "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide — Section Overviews"],
    ["tintinalli-overview", "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide — Whole-Book Overview"],
    ["rosens", "Rosen’s Emergency Medicine: Concepts and Clinical Practice"],
    ["rosens-sections", "Rosen’s Emergency Medicine: Concepts and Clinical Practice — Section Overviews"],
    ["rosens-overview", "Rosen’s Emergency Medicine: Concepts and Clinical Practice — Whole-Book Overview"],
  ]);
  for (const [id, title] of expected) {
    const collection = collectionById.get(id);
    assert(collection, id);
    assert.equal(collection.title, title);
    assert.doesNotMatch(JSON.stringify(collection), /速讀|全書/u);
  }
  assert.equal(collectionById.get("tintinalli-overview").itemTitles.WHOLE, "Whole-Book Overview");
  assert.equal(collectionById.get("rosens-overview").itemTitles.WHOLE, "Whole-Book Overview");
});
