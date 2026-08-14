import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import {
  interpolateSnacSourceTemplate,
  normalizeRetainedSnacEntry,
  parseSnacSourceFilename,
  resolveSnacCollectionSourceMode,
  resolveSnacSourceDisplayTitle,
} from "./lib/snac-library-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDirectory = path.join(repositoryRoot, "public", "audio", "snac");
const publicCatalogPath = path.join(targetDirectory, "catalog.json");
const defaultConfigPath = path.join(repositoryRoot, "scripts", "snac-library.config.json");
const textbookSectionsPath = path.join(repositoryRoot, "app", "data", "textbook-sections.json");
const configArgument = process.argv.find((argument) => argument.startsWith("--config="));
const configPath = path.resolve(configArgument?.slice("--config=".length) || defaultConfigPath);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(candidatePath) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function loadExistingCatalog() {
  if (await exists(publicCatalogPath)) {
    return JSON.parse(await readFile(publicCatalogPath, "utf8"));
  }
  const compressedPath = `${publicCatalogPath}.brp`;
  if (await exists(compressedPath)) {
    const compressed = await readFile(compressedPath);
    return JSON.parse(brotliDecompressSync(compressed).toString("utf8"));
  }
  return null;
}

async function listFilesRecursively(directory, relativeDirectory = "") {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listFilesRecursively(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }
  return results;
}

async function loadCanonicalTitleCatalog(collection) {
  if (!collection.canonicalTitleCatalog) return collection;

  assert(
    typeof collection.canonicalTitleCatalog === "string",
    `${collection.id}: canonical title catalog path is invalid.`,
  );
  const catalogPath = path.resolve(path.dirname(configPath), collection.canonicalTitleCatalog);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  assert(
    catalog.schema === collection.canonicalTitleCatalogSchema,
    `${collection.id}: canonical title catalog schema is invalid.`,
  );
  assert(
    catalog.chapterCount === collection.expectedItems
      && Array.isArray(catalog.chapters)
      && catalog.chapters.length === collection.expectedItems,
    `${collection.id}: canonical title catalog must contain ${collection.expectedItems} chapters.`,
  );

  const itemTitles = {};
  for (let index = 0; index < catalog.chapters.length; index += 1) {
    const chapter = catalog.chapters[index];
    const expectedNumber = index + 1;
    const expectedId = String(expectedNumber).padStart(3, "0");
    assert(
      chapter.number === expectedNumber && chapter.id === expectedId,
      `${collection.id}: canonical title catalog is not contiguous at ${expectedId}.`,
    );
    assert(
      typeof chapter.title === "string" && chapter.title.trim().length > 0,
      `${collection.id}: canonical title ${expectedId} is invalid.`,
    );
    itemTitles[chapter.id] = chapter.title.trim();
  }
  assert(
    new Set(Object.values(itemTitles)).size === collection.expectedItems,
    `${collection.id}: canonical chapter titles must be unique.`,
  );
  return { ...collection, itemTitles };
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const textbookSections = JSON.parse(await readFile(textbookSectionsPath, "utf8"));
assert(textbookSections.schema === "em-board-textbook-sections-v1", "Unexpected textbook section catalog schema.");
assert(config.schema === "snac-library-import-v1", "Unexpected SNAC library config schema.");
assert(Number.isFinite(config.siteBaselineSpeed) && config.siteBaselineSpeed > 0, "Invalid site baseline speed.");
assert(Number.isFinite(config.encodedSpeed) && config.encodedSpeed > 0, "Invalid encoded speed.");
assert(Array.isArray(config.collections) && config.collections.length > 0, "No SNAC collections were configured.");
config.collections = await Promise.all(config.collections.map(loadCanonicalTitleCatalog));

const collectionIds = new Set();
const entries = [];
const collectionSummaries = [];
const expectedRawAssets = new Set(["catalog.json"]);
const existingCatalog = await loadExistingCatalog();
if (existingCatalog) {
  assert(existingCatalog.schema === "em-board-audio-catalog-v2", "Existing SNAC catalog schema is invalid.");
  assert(Array.isArray(existingCatalog.entries), "Existing SNAC catalog entries are invalid.");
}
const existingTitleByResource = new Map(
  (existingCatalog?.entries ?? []).map((entry) => [
    `${entry.collectionId}:${entry.chapterId}`,
    entry.title,
  ]),
);
let totalBytes = 0;

function retainExistingCollection(collection) {
  const retainedEntries = existingCatalog?.entries.filter((entry) => entry.collectionId === collection.id) ?? [];
  assert(
    retainedEntries.length === collection.expectedItems,
    `${collection.id}: source is unavailable and expected ${collection.expectedItems} retained entries, found ${retainedEntries.length}.`,
  );
  for (const entry of retainedEntries) {
    const sectionMetadata = collection.kind === "textbook-section"
      ? textbookSections.textbooks?.[collection.textbook]?.sections?.find((section) => section.id === entry.sectionId)
      : null;
    entries.push(normalizeRetainedSnacEntry({ collection, entry, sectionMetadata }));
    expectedRawAssets.add(`${entry.file}.snac`);
    expectedRawAssets.add(`${entry.file}.snac.json`);
    totalBytes += entry.dataBytes;
  }
  collectionSummaries.push({
    id: collection.id,
    title: collection.title,
    kind: collection.kind,
    itemCount: retainedEntries.length,
  });
}

for (const collection of config.collections) {
  assert(/^[a-z0-9][a-z0-9_-]*$/u.test(collection.id), `Invalid collection id: ${collection.id}`);
  assert(!collectionIds.has(collection.id), `Duplicate collection id: ${collection.id}`);
  assert(
    collection.kind === "textbook-chapter" || collection.kind === "textbook-section" || collection.kind === "question-set",
    `Invalid collection kind: ${collection.id}`,
  );
  if (collection.libraryId !== undefined) {
    assert(/^[a-z0-9][a-z0-9_-]*$/u.test(collection.libraryId), `Invalid library id: ${collection.id}`);
  }
  assert(/^[a-z0-9][a-z0-9_-]*$/u.test(collection.textbook), `Invalid source key: ${collection.id}`);
  assert(Number.isInteger(collection.expectedItems) && collection.expectedItems > 0, `Invalid expected item count: ${collection.id}`);
  collectionIds.add(collection.id);

  const sourceDirectory = path.resolve(collection.sourceDirectory);
  const sourceDirectoryExists = await exists(sourceDirectory);
  if (!sourceDirectoryExists) {
    const missingSourceMode = resolveSnacCollectionSourceMode({
      collection,
      sourceDirectoryExists,
      matchingMetadataCount: 0,
      sourceDirectory,
    });
    if (missingSourceMode === "retain-existing") {
      retainExistingCollection(collection);
      continue;
    }
  }
  const sourceNames = await readdir(sourceDirectory);
  const metadataItems = sourceNames
    .map((name) => ({ name, parsed: parseSnacSourceFilename(collection, name) }))
    .filter((item) => item.parsed)
    .map(({ name, parsed }) => ({ name, ...parsed }))
    .sort((left, right) => {
      if (collection.kind === "question-set") {
        const leftExam = left.match.groups?.examLabel;
        const rightExam = right.match.groups?.examLabel;
        const leftStart = Number(left.match.groups?.questionStart);
        const rightStart = Number(right.match.groups?.questionStart);
        if (leftExam && rightExam && Number.isInteger(leftStart) && Number.isInteger(rightStart)) {
          return rightExam.localeCompare(leftExam, "en", { numeric: true }) || leftStart - rightStart;
        }
      }
      return left.resourceId.localeCompare(right.resourceId, "en", { numeric: true });
    });
  const sourceMode = resolveSnacCollectionSourceMode({
    collection,
    sourceDirectoryExists,
    matchingMetadataCount: metadataItems.length,
    sourceDirectory,
  });
  if (sourceMode === "retain-existing") {
    retainExistingCollection(collection);
    continue;
  }

  for (let index = 0; index < metadataItems.length; index += 1) {
    const { name: metadataName, match, resourceId } = metadataItems[index];
    const sectionId = collection.kind === "textbook-section"
      ? String(collection.sectionIdTemplate
        ? interpolateSnacSourceTemplate(collection.sectionIdTemplate, match.groups, metadataName)
        : match.groups?.sectionId ?? resourceId).toLowerCase().replace(/^0+(?=\d)/u, "")
      : null;
    const sectionMetadata = sectionId
      ? textbookSections.textbooks?.[collection.textbook]?.sections?.find((section) => section.id === sectionId)
      : null;
    const title = resolveSnacSourceDisplayTitle({
      collection,
      match,
      resourceId,
      sectionTitle: sectionMetadata?.title,
      existingTitle: existingTitleByResource.get(`${collection.id}:${resourceId}`),
      filename: metadataName,
    });
    const sectionLabel = collection.kind === "textbook-section"
      ? collection.defaultSectionLabel
        ?? sectionMetadata?.label
        ?? `${collection.labelPrefix}${sectionId}`
      : null;
    const metadataPath = path.join(sourceDirectory, metadataName);
    const metadataBytes = await readFile(metadataPath);
    const metadata = JSON.parse(metadataBytes.toString("utf8"));
    const dataName = metadata.dataFile;
    assert(typeof dataName === "string" && path.basename(dataName) === dataName && dataName.endsWith(".snac"), `${metadataName}: dataFile is invalid.`);
    const dataPath = path.join(sourceDirectory, dataName);
    const data = await readFile(dataPath);
    const dataStats = await stat(dataPath);

    assert(metadata.schema === "snac-chapter-v1", `${metadataName}: unsupported schema.`);
    assert(metadata.codec === "snac-24khz" && metadata.packetFormat === "SNC1", `${metadataName}: unexpected codec/container.`);
    assert(metadata.sampleRate === 24000 && metadata.channels === 1, `${metadataName}: expected 24 kHz mono.`);
    assert(metadata.speed === config.encodedSpeed, `${metadataName}: expected ${config.encodedSpeed}x preprocessing.`);
    assert(metadata.tokenBits === 12 && metadata.codebookCount === 3, `${metadataName}: unexpected token layout.`);
    assert(dataName === metadataName.slice(0, -5), `${metadataName}: dataFile does not match metadata filename.`);
    assert(dataStats.size === metadata.dataBytes, `${metadataName}: byte count mismatch.`);
    assert(sha256(data) === metadata.dataSha256, `${metadataName}: SHA-256 mismatch.`);
    assert(Array.isArray(metadata.packets) && metadata.packets.length === metadata.packetCount, `${metadataName}: packet count mismatch.`);
    assert(metadata.packets.every((packet) => packet[0] >= 0 && packet[1] > 0 && packet[0] + packet[1] <= data.length), `${metadataName}: packet range outside payload.`);
    assert(metadata.playbackDurationSeconds > 0 && metadata.sourceDurationSeconds > 0, `${metadataName}: invalid duration.`);

    const metadataSha256 = sha256(metadataBytes);
    const revision = sha256(Buffer.from(`${metadata.dataSha256}:${metadataSha256}`)).slice(0, 20);
    const baseFile = dataName.slice(0, -".snac".length);
    const releaseRelativeDirectory = path.posix.join("releases", revision);
    const releaseRelativeFile = path.posix.join(releaseRelativeDirectory, baseFile);
    const releaseDirectory = path.join(targetDirectory, ...releaseRelativeDirectory.split("/"));
    await mkdir(releaseDirectory, { recursive: true });
    await Promise.all([
      copyFile(dataPath, path.join(releaseDirectory, dataName)),
      copyFile(metadataPath, path.join(releaseDirectory, metadataName)),
    ]);
    expectedRawAssets.add(path.posix.join(releaseRelativeDirectory, dataName));
    expectedRawAssets.add(path.posix.join(releaseRelativeDirectory, metadataName));

    const fallbackRange = collection.kind === "question-set"
      ? /Q?(?<start>\d{1,5})\D+Q?(?<end>\d{1,5})$/u.exec(resourceId)
      : null;
    const questionStart = Number(match.groups?.questionStart ?? fallbackRange?.groups?.start);
    const questionEnd = Number(match.groups?.questionEnd ?? fallbackRange?.groups?.end);
    const questionExam = match.groups?.examLabel?.toUpperCase();
    if (collection.kind === "question-set") {
      assert(/^\d{3}[AB]?$/u.test(questionExam ?? ""), `${metadataName}: question exam label is invalid.`);
      assert(Number.isInteger(questionStart) && questionStart > 0, `${metadataName}: question range start is invalid.`);
      assert(Number.isInteger(questionEnd) && questionEnd >= questionStart, `${metadataName}: question range end is invalid.`);
      if (Number.isInteger(collection.questionsPerItem)) {
        assert(
          questionEnd - questionStart + 1 === collection.questionsPerItem,
          `${metadataName}: expected ${collection.questionsPerItem} questions in this audio item.`,
        );
      }
    }
    entries.push({
      id: `${collection.entryIdPrefix}${resourceId.toLowerCase()}`,
      collectionId: collection.id,
      collectionTitle: collection.title,
      ...(collection.libraryId && collection.libraryId !== collection.id ? {
        libraryId: collection.libraryId,
        libraryTitle: collection.libraryTitle || collection.title,
      } : {}),
      kind: collection.kind,
      sequence: index + 1,
      textbook: collection.textbook,
      chapterId: resourceId,
      chapterLabel: collection.kind === "question-set"
        ? `${questionExam} Q.${String(questionStart).padStart(3, "0")}–${String(questionEnd).padStart(3, "0")}`
        : `${collection.labelPrefix}${resourceId}`,
      ...(collection.kind === "textbook-section" ? {
        sectionId,
        sectionLabel,
        sectionTitle: title,
      } : {}),
      title,
      file: releaseRelativeFile,
      durationSeconds: metadata.sourceDurationSeconds / config.siteBaselineSpeed,
      encodedSpeed: metadata.speed,
      revision,
      dataBytes: data.byteLength,
      dataSha256: metadata.dataSha256,
      metadataBytes: metadataBytes.byteLength,
      metadataSha256,
      ...(collection.kind === "question-set" ? {
        questionExam,
        questionStart,
        questionEnd,
      } : {}),
    });
    totalBytes += data.length;
  }

  collectionSummaries.push({
    id: collection.id,
    title: collection.title,
    kind: collection.kind,
    itemCount: metadataItems.length,
  });
}

await mkdir(targetDirectory, { recursive: true });
for (const relativePath of await listFilesRecursively(targetDirectory)) {
  const portablePath = relativePath.replaceAll("\\", "/");
  if (
    (portablePath.endsWith(".snac") || portablePath.endsWith(".snac.json"))
    && !expectedRawAssets.has(portablePath)
  ) {
    await unlink(path.join(targetDirectory, relativePath));
  }
}

const catalogRevision = sha256(Buffer.from(JSON.stringify(entries))).slice(0, 20);
const catalog = {
  schema: "em-board-audio-catalog-v2",
  catalogRevision,
  baselineSpeed: config.siteBaselineSpeed,
  encodedSpeed: config.encodedSpeed,
  collectionCount: collectionSummaries.length,
  itemCount: entries.length,
  collections: collectionSummaries,
  entries,
};
const catalogPartPath = `${publicCatalogPath}.part`;
await writeFile(catalogPartPath, `${JSON.stringify(catalog)}\n`, "utf8");
await rename(catalogPartPath, publicCatalogPath);

console.log(JSON.stringify({
  configPath,
  targetDirectory,
  catalogRevision,
  collections: collectionSummaries,
  items: entries.length,
  payloadBytes: totalBytes,
  baselineSpeed: config.siteBaselineSpeed,
}, null, 2));
