import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { brotliQuality } from "./lib/static-content-codec.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "public");
const tintinalliManifestPath = path.join(publicRoot, "guides", "manifest.json");
const rosensManifestPath = path.join(publicRoot, "guides", "rosens", "manifest.json");
const options = parseArguments(process.argv.slice(2));
const sourceRoot = options.sourceRoot
  ?? [path.resolve(projectRoot, ".."), path.resolve(projectRoot, "..", "..")]
    .find((candidate) => fs.existsSync(path.join(candidate, "outputs", "02_learning_guides")))
  ?? path.resolve(projectRoot, "..");

if (process.env.STATIC_CONTENT_LOCK_HELD !== "1") {
  throw new Error(
    "Run this script through scripts/with-uncompressed-static-content.mjs so the content-pack update is transactional",
  );
}
if (brotliQuality !== 11) {
  throw new Error(`Full-guide sync requires Brotli quality 11; configured quality is ${brotliQuality}`);
}

const sourceDefinitions = [
  {
    textbook: "tintinalli",
    packId: "concise",
    count: 303,
    sourceDirectory: path.join(sourceRoot, "outputs", "02_learning_guides", "tintinalli-concise"),
    sourceName: (number) => `tintinalli-CH${String(number).padStart(3, "0")}-concise-full.md`,
    sourcePattern: /^tintinalli-CH\d{3}-concise-full\.md$/u,
  },
  {
    textbook: "tintinalli",
    packId: "detailed",
    count: 303,
    sourceDirectory: path.join(sourceRoot, "outputs", "02_learning_guides", "tintinalli-detailed"),
    sourceName: (number) => `tintinalli-CH${String(number).padStart(3, "0")}-detailed-full.md`,
    sourcePattern: /^tintinalli-CH\d{3}-detailed-full\.md$/u,
  },
  {
    textbook: "rosens",
    packId: "detailed",
    count: 208,
    sourceDirectory: path.join(sourceRoot, "outputs", "02_learning_guides", "rosens"),
    sourceName: (number) => `rosens-CH${String(number).padStart(3, "0")}-full.md`,
    sourcePattern: /^rosens-CH\d{3}-full\.md$/u,
  },
];

const tintinalliOriginal = readJson(tintinalliManifestPath, "Tintinalli manifest");
const rosensOriginal = readJson(rosensManifestPath, "Rosen's manifest");
validateTintinalliManifest(tintinalliOriginal);
validateRosensManifest(rosensOriginal);

const tintinalliNext = structuredClone(tintinalliOriginal);
const rosensNext = structuredClone(rosensOriginal);
const sourceFiles = new Map(
  sourceDefinitions.map((definition) => [
    `${definition.textbook}:${definition.packId}`,
    collectExactChapterSources(definition),
  ]),
);
const preparedDocuments = prepareFullDocuments({
  tintinalliCatalog: tintinalliNext,
  rosensCatalog: rosensNext,
  sourceFiles,
});

if (preparedDocuments.length !== 814) {
  throw new Error(`Expected 814 prepared full guides, found ${preparedDocuments.length}`);
}

assertOnlyAllowedManifestFieldsChanged({
  tintinalliOriginal,
  tintinalliNext,
  rosensOriginal,
  rosensNext,
});

// These 1,628 documents are intentionally outside the write set. Their
// manifest metadata and bytes are checked before and after a real sync.
const protectedTierSnapshot = snapshotProtectedTiers(tintinalliOriginal, rosensOriginal);
const documentChanges = preparedDocuments.filter((document) => !document.sourceBuffer.equals(document.currentBuffer));
const manifestMetadataChanges = countManifestMetadataChanges({
  tintinalliOriginal,
  tintinalliNext,
  rosensOriginal,
  rosensNext,
});

const summary = {
  mode: options.verify ? "verify" : options.dryRun ? "dry-run" : "sync",
  sourceRoot,
  preparedFullDocuments: preparedDocuments.length,
  changedFullDocuments: documentChanges.length,
  unchangedFullDocuments: preparedDocuments.length - documentChanges.length,
  protectedTierDocuments: protectedTierSnapshot.length,
  changedManifestMetadataFields: manifestMetadataChanges,
  brotli: {
    transaction: "scripts/with-uncompressed-static-content.mjs",
    storedQuality: brotliQuality,
  },
};

if (options.dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (options.verify) {
  verifyFullDocuments(preparedDocuments);
  verifyManifestMetadata({
    tintinalliActual: tintinalliOriginal,
    tintinalliExpected: tintinalliNext,
    rosensActual: rosensOriginal,
    rosensExpected: rosensNext,
  });
  verifyProtectedTiers(protectedTierSnapshot);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

commitExpandedTransaction({
  preparedDocuments,
  tintinalliNext,
  rosensNext,
});

verifyFullDocuments(preparedDocuments);
verifyManifestFiles(tintinalliNext, rosensNext);
verifyProtectedTiers(protectedTierSnapshot);
console.log(JSON.stringify(summary, null, 2));

function parseArguments(argumentsList) {
  const parsed = {
    dryRun: false,
    verify: false,
    sourceRoot: null,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (argument === "--verify") {
      parsed.verify = true;
      continue;
    }
    if (argument === "--source-root") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--source-root requires a path");
      parsed.sourceRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--help") {
      console.log([
        "Usage: node scripts/sync-full-study-guides.mjs [options]",
        "",
        "Options:",
        "  --source-root <path>  Workspace root containing outputs/02_learning_guides/",
        "  --dry-run             Validate and report without writing",
        "  --verify              Require production full guides to match sources without writing",
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (parsed.dryRun && parsed.verify) throw new Error("--dry-run and --verify are mutually exclusive");
  return parsed;
}

function collectExactChapterSources(definition) {
  const { count, sourceDirectory, sourceName, sourcePattern, textbook, packId } = definition;
  if (!fs.existsSync(sourceDirectory) || !fs.statSync(sourceDirectory).isDirectory()) {
    throw new Error(`Missing ${textbook} ${packId} source directory: ${sourceDirectory}`);
  }

  const expectedNames = new Set(
    Array.from({ length: count }, (_, index) => sourceName(index + 1)),
  );
  const chapterLikeNames = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && sourcePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  const unexpected = chapterLikeNames.filter((name) => !expectedNames.has(name));
  const missing = [...expectedNames].filter((name) => !chapterLikeNames.includes(name));

  if (chapterLikeNames.length !== count || unexpected.length || missing.length) {
    throw new Error([
      `${textbook} ${packId} must contain exactly ${count} canonical full-guide files`,
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : null,
      missing.length ? `missing: ${missing.join(", ")}` : null,
    ].filter(Boolean).join("; "));
  }

  return chapterLikeNames.map((name, index) => {
    const sourcePath = path.join(sourceDirectory, name);
    const sourceBuffer = fs.readFileSync(sourcePath);
    validateMarkdown(sourceBuffer, `${textbook} ${packId} ${name}`);
    return {
      sequence: index + 1,
      sourcePath,
      sourceBuffer,
    };
  });
}

function prepareFullDocuments({ tintinalliCatalog, rosensCatalog, sourceFiles: filesBySource }) {
  const documents = [];

  for (const packId of ["concise", "detailed"]) {
    const sources = filesBySource.get(`tintinalli:${packId}`);
    for (const source of sources) {
      const chapterNumber = source.sequence;
      const padded = String(chapterNumber).padStart(3, "0");
      const chapter = tintinalliCatalog.chapters[chapterNumber - 1];
      const content = chapter?.contents?.[packId];
      const expectedMarkdownPath = `/guides/packs/${packId}/full/chapter-${padded}.md`;

      if (chapter?.id !== chapterNumber || !content?.available || !content.modes?.full) {
        throw new Error(`Tintinalli ${packId} Chapter ${chapterNumber} is unavailable in the manifest`);
      }
      if (content.modes.full.markdownPath !== expectedMarkdownPath) {
        throw new Error(
          `Tintinalli ${packId} Chapter ${chapterNumber} full path mismatch: ${content.modes.full.markdownPath}`,
        );
      }

      const targetPath = resolvePublicMarkdownPath(expectedMarkdownPath);
      const currentBuffer = readExistingTarget(targetPath, `Tintinalli ${packId} Chapter ${chapterNumber}`);
      updateContentDigest(content.modes.full, source.sourceBuffer);
      if (tintinalliCatalog.defaultPackId === packId) {
        if (chapter.markdownPath !== expectedMarkdownPath) {
          throw new Error(`Tintinalli Chapter ${chapterNumber} legacy full path mismatch`);
        }
        chapter.contentHash = digest(source.sourceBuffer).slice(0, 16);
      }

      documents.push({
        key: `tintinalli:${packId}:${padded}`,
        sourcePath: source.sourcePath,
        sourceBuffer: source.sourceBuffer,
        targetPath,
        currentBuffer,
      });
    }
  }

  const rosensSources = filesBySource.get("rosens:detailed");
  for (const source of rosensSources) {
    const sequence = source.sequence;
    const chapterId = rosensChapterId(sequence);
    const chapter = rosensCatalog.chapters[sequence - 1];
    const expectedMarkdownPath = `/guides/rosens/detailed/${chapterId}/full.md`;

    if (
      chapter?.id !== chapterId
      || chapter.sourceSequence !== sequence
      || !chapter.available
      || !chapter.modes?.full
    ) {
      throw new Error(`Rosen's source ${sequence} does not match manifest chapter ${chapterId}`);
    }
    if (chapter.modes.full.markdownPath !== expectedMarkdownPath) {
      throw new Error(`Rosen's ${chapterId} full path mismatch: ${chapter.modes.full.markdownPath}`);
    }

    const targetPath = resolvePublicMarkdownPath(expectedMarkdownPath);
    const currentBuffer = readExistingTarget(targetPath, `Rosen's ${chapterId}`);
    updateContentDigest(chapter.modes.full, source.sourceBuffer);
    documents.push({
      key: `rosens:detailed:${chapterId}`,
      sourcePath: source.sourcePath,
      sourceBuffer: source.sourceBuffer,
      targetPath,
      currentBuffer,
    });
  }

  const uniqueTargets = new Set(documents.map((document) => document.targetPath));
  if (uniqueTargets.size !== documents.length) throw new Error("Full guide target paths are not unique");
  return documents;
}

function validateMarkdown(buffer, label) {
  let markdown;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
  if (markdown.charCodeAt(0) === 0xfeff) throw new Error(`${label} begins with a UTF-8 BOM`);
  if (markdown.includes("\u0000") || markdown.includes("\uFFFD")) {
    throw new Error(`${label} contains invalid text markers`);
  }

  const syntaxTree = unified().use(remarkParse).parse(markdown);
  const headingDepths = [];
  walkMarkdown(syntaxTree, (node) => {
    if (node.type === "heading") headingDepths.push(node.depth);
  });

  const h1Count = headingDepths.filter((depth) => depth === 1).length;
  if (h1Count !== 1) throw new Error(`${label} must contain exactly one H1; found ${h1Count}`);
  if (headingDepths[0] !== 1) throw new Error(`${label} must begin its heading hierarchy with H1`);
  const unsupportedDepth = headingDepths.find((depth) => depth < 1 || depth > 4);
  if (unsupportedDepth) throw new Error(`${label} contains unsupported H${unsupportedDepth}; only H1-H4 are allowed`);

  for (let index = 1; index < headingDepths.length; index += 1) {
    if (headingDepths[index] > headingDepths[index - 1] + 1) {
      throw new Error(
        `${label} heading hierarchy jumps from H${headingDepths[index - 1]} to H${headingDepths[index]}`,
      );
    }
  }
}

function walkMarkdown(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) walkMarkdown(child, visitor);
}

function snapshotProtectedTiers(tintinalliCatalog, rosensCatalog) {
  const snapshot = [];
  for (const packId of ["concise", "detailed"]) {
    for (const chapter of tintinalliCatalog.chapters) {
      const modes = chapter.contents[packId].modes;
      for (const modeName of ["quick", "focus"]) {
        snapshot.push(snapshotManifestDocument(
          modes[modeName],
          `Tintinalli ${packId} Chapter ${chapter.id} ${modeName}`,
        ));
      }
    }
  }
  for (const chapter of rosensCatalog.chapters) {
    for (const modeName of ["quick", "standard"]) {
      snapshot.push(snapshotManifestDocument(
        chapter.modes[modeName],
        `Rosen's ${chapter.id} ${modeName}`,
      ));
    }
  }

  if (snapshot.length !== 1_628) {
    throw new Error(`Expected 1,628 protected normal/quick documents, found ${snapshot.length}`);
  }
  if (new Set(snapshot.map((entry) => entry.targetPath)).size !== snapshot.length) {
    throw new Error("Protected normal/quick paths are not unique");
  }
  return snapshot;
}

function snapshotManifestDocument(entry, label) {
  if (!entry?.markdownPath) throw new Error(`${label} is missing from its manifest`);
  const targetPath = resolvePublicMarkdownPath(entry.markdownPath);
  const buffer = readExistingTarget(targetPath, label);
  const hash = digest(buffer);
  if (
    entry.contentHash !== hash.slice(0, 16)
    || entry.sourceSha256 !== hash
    || entry.bytes !== buffer.length
  ) {
    throw new Error(`${label} manifest metadata does not match its bytes`);
  }
  return {
    label,
    targetPath,
    hash,
    bytes: buffer.length,
  };
}

function verifyProtectedTiers(snapshot) {
  for (const entry of snapshot) {
    const buffer = readExistingTarget(entry.targetPath, entry.label);
    if (buffer.length !== entry.bytes || digest(buffer) !== entry.hash) {
      throw new Error(`${entry.label} changed even though only full guides may be updated`);
    }
  }
}

function commitExpandedTransaction({ preparedDocuments: documents, tintinalliNext: tintinalli, rosensNext: rosens }) {
  const manifestWrites = [
    {
      key: "manifest:tintinalli",
      targetPath: tintinalliManifestPath,
      sourceBuffer: Buffer.from(`${JSON.stringify(tintinalli, null, 2)}\n`, "utf8"),
    },
    {
      key: "manifest:rosens",
      targetPath: rosensManifestPath,
      sourceBuffer: Buffer.from(`${JSON.stringify(rosens, null, 2)}\n`, "utf8"),
    },
  ];
  const writes = [
    ...documents.map((document) => ({
      key: document.key,
      targetPath: document.targetPath,
      sourceBuffer: document.sourceBuffer,
    })),
    ...manifestWrites,
  ];
  const staged = [];

  try {
    for (const [index, write] of writes.entries()) {
      fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
      const temporaryPath = path.join(
        path.dirname(write.targetPath),
        `.${path.basename(write.targetPath)}.tmp-full-sync-${process.pid}-${index}-${randomBytes(6).toString("hex")}`,
      );
      fs.writeFileSync(temporaryPath, write.sourceBuffer, { flag: "wx" });
      staged.push({ ...write, temporaryPath });
    }
    for (const write of staged) fs.renameSync(write.temporaryPath, write.targetPath);
  } finally {
    for (const write of staged) fs.rmSync(write.temporaryPath, { force: true });
  }
}

function verifyFullDocuments(documents) {
  const mismatches = [];
  for (const document of documents) {
    const actual = readExistingTarget(document.targetPath, document.key);
    if (!actual.equals(document.sourceBuffer)) mismatches.push(document.key);
  }
  if (mismatches.length) {
    throw new Error(`Production full guides do not match sources: ${mismatches.join(", ")}`);
  }
}

function verifyManifestFiles(tintinalliExpected, rosensExpected) {
  const tintinalliActual = readJson(tintinalliManifestPath, "Tintinalli manifest");
  const rosensActual = readJson(rosensManifestPath, "Rosen's manifest");
  if (JSON.stringify(tintinalliActual) !== JSON.stringify(tintinalliExpected)) {
    throw new Error("Tintinalli manifest differs after the full-only sync");
  }
  if (JSON.stringify(rosensActual) !== JSON.stringify(rosensExpected)) {
    throw new Error("Rosen's manifest differs after the full-only sync");
  }
}

function verifyManifestMetadata({
  tintinalliActual,
  tintinalliExpected,
  rosensActual,
  rosensExpected,
}) {
  const changes = countManifestMetadataChanges({
    tintinalliOriginal: tintinalliActual,
    tintinalliNext: tintinalliExpected,
    rosensOriginal: rosensActual,
    rosensNext: rosensExpected,
  });
  if (changes) throw new Error(`Production manifests have ${changes} stale full-guide metadata fields`);
}

function countManifestMetadataChanges({
  tintinalliOriginal,
  tintinalliNext,
  rosensOriginal,
  rosensNext,
}) {
  let changes = 0;
  const metadataKeys = ["contentHash", "sourceSha256", "bytes"];
  for (let index = 0; index < 303; index += 1) {
    for (const packId of ["concise", "detailed"]) {
      const before = tintinalliOriginal.chapters[index].contents[packId].modes.full;
      const after = tintinalliNext.chapters[index].contents[packId].modes.full;
      changes += metadataKeys.filter((key) => before[key] !== after[key]).length;
    }
    if (tintinalliOriginal.chapters[index].contentHash !== tintinalliNext.chapters[index].contentHash) {
      changes += 1;
    }
  }
  for (let index = 0; index < 208; index += 1) {
    const before = rosensOriginal.chapters[index].modes.full;
    const after = rosensNext.chapters[index].modes.full;
    changes += metadataKeys.filter((key) => before[key] !== after[key]).length;
  }
  return changes;
}

function assertOnlyAllowedManifestFieldsChanged({
  tintinalliOriginal,
  tintinalliNext,
  rosensOriginal,
  rosensNext,
}) {
  const tintinalliBefore = maskMutableTintinalliFields(tintinalliOriginal);
  const tintinalliAfter = maskMutableTintinalliFields(tintinalliNext);
  const rosensBefore = maskMutableRosensFields(rosensOriginal);
  const rosensAfter = maskMutableRosensFields(rosensNext);
  if (JSON.stringify(tintinalliBefore) !== JSON.stringify(tintinalliAfter)) {
    throw new Error("Tintinalli manifest mutation escaped the full-guide metadata allowlist");
  }
  if (JSON.stringify(rosensBefore) !== JSON.stringify(rosensAfter)) {
    throw new Error("Rosen's manifest mutation escaped the full-guide metadata allowlist");
  }
}

function maskMutableTintinalliFields(catalog) {
  const masked = structuredClone(catalog);
  for (const chapter of masked.chapters) {
    for (const packId of ["concise", "detailed"]) maskContentDigest(chapter.contents[packId].modes.full);
    chapter.contentHash = "<full-content-hash>";
  }
  return masked;
}

function maskMutableRosensFields(catalog) {
  const masked = structuredClone(catalog);
  for (const chapter of masked.chapters) maskContentDigest(chapter.modes.full);
  return masked;
}

function maskContentDigest(entry) {
  entry.contentHash = "<content-hash>";
  entry.sourceSha256 = "<source-sha256>";
  entry.bytes = "<bytes>";
}

function updateContentDigest(entry, buffer) {
  const hash = digest(buffer);
  entry.contentHash = hash.slice(0, 16);
  entry.sourceSha256 = hash;
  entry.bytes = buffer.length;
}

function validateTintinalliManifest(catalog) {
  if (
    catalog.schemaVersion !== 3
    || catalog.totalChapters !== 303
    || catalog.chapters?.length !== 303
    || !["concise", "detailed"].includes(catalog.defaultPackId)
  ) {
    throw new Error("Tintinalli manifest is incomplete or has an unsupported schema");
  }
  for (const packId of ["concise", "detailed"]) {
    const pack = catalog.packs?.find((entry) => entry.id === packId);
    if (!pack || pack.status !== "available" || pack.importedChapters !== 303) {
      throw new Error(`Tintinalli ${packId} manifest pack is incomplete`);
    }
  }
}

function validateRosensManifest(catalog) {
  if (
    catalog.schemaVersion !== 1
    || catalog.textbookId !== "rosens"
    || catalog.totalEntries !== 208
    || catalog.importedChapters !== 208
    || catalog.chapters?.length !== 208
  ) {
    throw new Error("Rosen's manifest is incomplete or has an unsupported schema");
  }
}

function rosensChapterId(sequence) {
  return sequence <= 192
    ? String(sequence).padStart(3, "0")
    : `e${String(sequence - 192).padStart(2, "0")}`;
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} is not expanded at ${filePath}; run this script through scripts/with-uncompressed-static-content.mjs`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function readExistingTarget(targetPath, label) {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    throw new Error(
      `${label} target is not expanded at ${targetPath}; use the content-pack transaction wrapper`,
    );
  }
  return fs.readFileSync(targetPath);
}

function resolvePublicMarkdownPath(markdownPath) {
  if (!/^\/guides\/[A-Za-z0-9._@+()/+-]+\.md$/u.test(markdownPath)) {
    throw new Error(`Unsafe guide Markdown path: ${markdownPath}`);
  }
  const resolved = path.resolve(publicRoot, ...markdownPath.slice(1).split("/"));
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`Guide Markdown path escapes public/: ${markdownPath}`);
  }
  return resolved;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
