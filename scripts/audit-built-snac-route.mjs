import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = resolve(projectRoot, "dist/client");
const workerPath = resolve(projectRoot, "dist/server/index.js");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assetPathFor(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const path = resolve(clientRoot, `.${pathname}`);
  if (path !== clientRoot && !path.startsWith(`${clientRoot}${sep}`)) return null;
  return path;
}

const assets = {
  async fetch(request) {
    const path = assetPathFor(request.url);
    if (!path) return new Response(null, { status: 400 });
    try {
      return new Response(await readFile(path), {
        headers: { "content-type": "application/octet-stream" },
      });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return new Response(null, { status: 404 });
      }
      throw error;
    }
  },
};

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("snac-route-audit", `${process.pid}-${Date.now()}`);
const worker = (await import(workerUrl.href)).default;
assert.equal(typeof worker?.fetch, "function", "Built Worker fetch handler is missing");

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
Object.defineProperty(globalThis, "caches", {
  configurable: true,
  get() {
    throw new Error("Default cache is not permitted in this runtime");
  },
});

const pending = [];
const ctx = {
  passThroughOnException() {},
  waitUntil(promise) {
    pending.push(Promise.resolve(promise));
  },
};
const env = { ASSETS: assets, BUCKET: undefined };

async function fetchIdentity(pathname) {
  return worker.fetch(new Request(`https://audit.invalid${pathname}`, {
    headers: { "accept-encoding": "identity" },
  }), env, ctx);
}

try {
  const catalogResponse = await fetchIdentity("/audio/snac/catalog.json");
  assert.equal(catalogResponse.status, 200, "Built catalog route did not use packaged fallback");
  const catalog = await catalogResponse.json();
  assert.equal(catalog.schema, "em-board-audio-catalog-v2");
  assert.equal(catalog.collectionCount, 10, "Built catalog must expose every chapter, section, overview, question, and guide-audio collection");
  assert.equal(catalog.entries.length, 1433, "Built catalog must expose all canonical chapter, section, overview, question, and guide-audio summaries");
  assert.deepEqual(
    catalog.collections.map(({ id, itemCount }) => ({ id, itemCount })),
    [
      { id: "goldfrank", itemCount: 140 },
      { id: "rosens", itemCount: 208 },
      { id: "tintinalli", itemCount: 303 },
      { id: "questions", itemCount: 664 },
      { id: "board-guides", itemCount: 39 },
      { id: "ems", itemCount: 24 },
      { id: "tintinalli-sections", itemCount: 26 },
      { id: "tintinalli-overview", itemCount: 1 },
      { id: "rosens-sections", itemCount: 27 },
      { id: "rosens-overview", itemCount: 1 },
    ],
    "Built catalog collection counts are incomplete",
  );
  const questionEntries = catalog.entries.filter((entry) => entry.kind === "question-set");
  assert.equal(questionEntries.length, 664, "Built catalog must expose all 664 five-question audio items");
  assert.equal(
    questionEntries.reduce((sum, entry) => sum + entry.questionEnd - entry.questionStart + 1, 0),
    3320,
    "Built question audio must cover all 3,320 questions",
  );
  assert(
    questionEntries.every((entry) => /^\d{3}[AB]?$/u.test(entry.questionExam) && entry.questionEnd - entry.questionStart === 4),
    "Built question audio entries must each describe one five-question range",
  );
  const boardGuideEntries = catalog.entries.filter((entry) => entry.collectionId === "board-guides");
  assert.equal(boardGuideEntries.length, 39, "Built catalog must expose all 39 board learning-guide audio items");
  assert(boardGuideEntries.every((entry) => entry.textbook === "board" && /^\d{1,2}[A-Z]\d?$/u.test(entry.chapterId)));
  assert.equal(catalog.entries.filter((entry) => entry.collectionId === "ems").length, 24);
  const goldfrankEntries = catalog.entries.filter((entry) => entry.collectionId === "goldfrank");
  assert.equal(goldfrankEntries.length, 140);
  assert(goldfrankEntries.every((entry, index) => entry.textbook === "goldfrank" && entry.chapterId === String(index + 1).padStart(3, "0")));
  assert.deepEqual(
    catalog.entries.filter((entry) => entry.collectionId === "tintinalli-sections").map((entry) => entry.sectionId),
    Array.from({ length: 26 }, (_, index) => String(index + 1)),
  );
  assert.deepEqual(
    catalog.entries.filter((entry) => entry.collectionId === "rosens-sections").map((entry) => entry.sectionId),
    ["p1-s1", "p1-s2", "p2-s1", "p2-s2", "p2-s3", ...Array.from({ length: 12 }, (_, index) => `p3-s${index + 1}`), "p4-s1", "p4-s2", ...Array.from({ length: 8 }, (_, index) => `p5-s${index + 1}`)],
  );
  assert(catalog.entries.filter((entry) => entry.collectionId.endsWith("-overview")).every((entry) => entry.sectionId === "overview"));

  // The repository retains the v99 textbook fallbacks as a local seed source;
  // newly added question and board-guide audio is verified in R2 below.
  const sampleIndexes = [0, 139, 140, 347, 348, 650, 651, 1314, 1315, 1353, 1354, 1377, 1378, 1403, 1404, 1405, 1431, 1432];
  for (const index of sampleIndexes) {
    const source = catalog.entries[index];
    assert(source, `Catalog sample ${index} is unavailable`);
    const currentPath = source.file.split("/").map(encodeURIComponent).join("/");
    const legacyPath = encodeURIComponent(source.file);

    for (const encodedPath of [currentPath, legacyPath]) {
      const dataResponse = await fetchIdentity(`/audio/snac/${encodedPath}.snac?v=${source.revision}`);
      assert.equal(dataResponse.status, 200, `Built SNAC route failed: ${source.id}`);
      const data = new Uint8Array(await dataResponse.arrayBuffer());
      assert.equal(data.byteLength, source.dataBytes, `Built SNAC size mismatch: ${source.id}`);
      assert.equal(sha256(data), source.dataSha256, `Built SNAC hash mismatch: ${source.id}`);

      const metadataResponse = await fetchIdentity(
        `/audio/snac/${encodedPath}.snac.json?v=${source.revision}`,
      );
      assert.equal(metadataResponse.status, 200, `Built metadata route failed: ${source.id}`);
      const metadata = new Uint8Array(await metadataResponse.arrayBuffer());
      assert.equal(metadata.byteLength, source.metadataBytes, `Built metadata size mismatch: ${source.id}`);
      assert.equal(
        sha256(metadata),
        source.metadataSha256,
        `Built metadata hash mismatch: ${source.id}`,
      );
    }
  }
  await Promise.all(pending);
} finally {
  if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
  else delete globalThis.caches;
}

console.log("Validated built SNAC delivery without Cache API or R2, including legacy encoded paths.");
