import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  goldfrankProductionLanguagePattern,
  sanitizeGoldfrankGuideMarkdown,
} from "./lib/goldfrank-guide-markdown.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chapterCatalogRelativePath = "../app/data/goldfrank-chapters.json";
const chapterCatalogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  chapterCatalogRelativePath,
);
const sourceRoot = path.resolve(
  process.env.GOLDFRANK_GUIDE_SOURCE
    || path.join(repositoryRoot, "..", "..", "outputs", "02_learning_guides", "goldfrank"),
);
const targetRoot = path.join(repositoryRoot, "public", "guides", "goldfrank");
const chapterTargetRoot = path.join(targetRoot, "chapters");
const expectedChapterCount = 140;
const modeSpecs = [
  { id: "full", sourceVariant: "full", targetSuffix: "", minimumCharacters: 2_000 },
  { id: "standard", sourceVariant: "standard", targetSuffix: "-standard", minimumCharacters: 600 },
  { id: "quick", sourceVariant: "quick", targetSuffix: "-quick", minimumCharacters: 500 },
];
const readingDepths = ["quick", "standard", "full"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeMarkdown(markdown) {
  return `${markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd()}\n`;
}

const chapterCatalog = JSON.parse(await readFile(chapterCatalogPath, "utf8"));
assert(chapterCatalog.schema === "em-board-goldfrank-chapters-v1", "Unexpected Goldfrank chapter catalog schema.");
assert(chapterCatalog.edition === "11e", "Goldfrank chapter catalog must describe edition 11e.");
assert(chapterCatalog.isbn === "9781259859618", "Goldfrank chapter catalog ISBN is invalid.");
assert(chapterCatalog.chapterCount === expectedChapterCount, "Goldfrank chapter catalog count is invalid.");
assert(
  Array.isArray(chapterCatalog.chapters) && chapterCatalog.chapters.length === expectedChapterCount,
  `Goldfrank chapter catalog must contain ${expectedChapterCount} chapters.`,
);
const canonicalTitleById = new Map();
for (let index = 0; index < chapterCatalog.chapters.length; index += 1) {
  const chapter = chapterCatalog.chapters[index];
  const expectedNumber = index + 1;
  const expectedId = String(expectedNumber).padStart(3, "0");
  assert(chapter.number === expectedNumber && chapter.id === expectedId, `Goldfrank chapter catalog is not contiguous at ${expectedId}.`);
  assert(typeof chapter.title === "string" && chapter.title.trim().length > 0, `Goldfrank chapter ${expectedId} title is invalid.`);
  assert(!canonicalTitleById.has(chapter.id), `Goldfrank chapter catalog contains duplicate id ${chapter.id}.`);
  canonicalTitleById.set(chapter.id, chapter.title.trim());
}
assert(
  new Set(canonicalTitleById.values()).size === expectedChapterCount,
  "Goldfrank chapter catalog titles must be unique.",
);

const sourceNames = (await readdir(sourceRoot))
  .filter((name) => /^goldfrank-CH\d{3}-(?:full|standard|quick)\.md$/u.test(name))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

assert(
  sourceNames.length === expectedChapterCount * modeSpecs.length,
  `Goldfrank guide expected ${expectedChapterCount * modeSpecs.length} chapter variants, found ${sourceNames.length}.`,
);

const expectedSourceNames = Array.from({ length: expectedChapterCount }, (_, index) => {
  const id = String(index + 1).padStart(3, "0");
  return modeSpecs.map((mode) => `goldfrank-CH${id}-${mode.sourceVariant}.md`);
}).flat();
const sourceNameSet = new Set(sourceNames);
for (const sourceName of expectedSourceNames) {
  assert(sourceNameSet.has(sourceName), `Goldfrank guide source is missing ${sourceName}.`);
}

const pendingFiles = [];
const chapters = [];

for (let index = 0; index < expectedChapterCount; index += 1) {
  const number = index + 1;
  const id = String(number).padStart(3, "0");
  const canonicalTitle = canonicalTitleById.get(id);
  assert(canonicalTitle, `Goldfrank chapter ${id} is missing its canonical title.`);
  const modes = {};

  for (const mode of modeSpecs) {
    const sourceName = `goldfrank-CH${id}-${mode.sourceVariant}.md`;
    const rawBytes = await readFile(path.join(sourceRoot, sourceName));
    const raw = normalizeMarkdown(rawBytes.toString("utf8"));
    const sourceHeading = /^#\s+第\s*(\d+)\s*章\s*｜\s*(.+)$/mu.exec(raw);
    assert(sourceHeading, `${sourceName}: expected H1 in the form "# 第 N 章｜Title".`);
    assert(Number(sourceHeading[1]) === number, `${sourceName}: H1 chapter number does not match its filename.`);

    const markdown = normalizeMarkdown(
      sanitizeGoldfrankGuideMarkdown(raw).replace(/^#\s+.+$/mu, () => `# ${canonicalTitle}`),
    );
    const learnerHeading = /^#\s+(.+)$/mu.exec(markdown);
    assert(learnerHeading, `${sourceName}: sanitized chapter is missing its learner-facing H1.`);
    assert(learnerHeading[1].trim() === canonicalTitle, `${sourceName}: published H1 is not canonical.`);
    assert(markdown.length >= mode.minimumCharacters, `${sourceName}: sanitized chapter content is unexpectedly short.`);
    assert(
      !goldfrankProductionLanguagePattern.test(markdown),
      `${sourceName}: sanitized chapter still contains source-file or production-review language.`,
    );

    const targetName = `${id}${mode.targetSuffix}.md`;
    const bytes = Buffer.from(markdown, "utf8");
    pendingFiles.push({ targetName, bytes });
    modes[mode.id] = {
      headingTitle: learnerHeading[1].trim(),
      bytes: bytes.byteLength,
      contentHash: sha256(bytes),
      sourceSha256: sha256(rawBytes),
      markdownPath: `/guides/goldfrank/chapters/${targetName}`,
    };
  }

  assert(
    new Set(readingDepths.map((depth) => modes[depth].contentHash)).size === readingDepths.length,
    `Goldfrank chapter ${id}: quick, standard, and full modes must have distinct content hashes.`,
  );
  const full = modes.full;
  chapters.push({
    id,
    number,
    title: canonicalTitle,
    order: number,
    bytes: full.bytes,
    contentHash: full.contentHash,
    markdownPath: full.markdownPath,
    modes,
  });
}

await mkdir(chapterTargetRoot, { recursive: true });
const expectedTargets = new Set(pendingFiles.map(({ targetName }) => targetName));
for (const { targetName, bytes } of pendingFiles) {
  const targetPath = path.join(chapterTargetRoot, targetName);
  await writeFile(targetPath, bytes);
  const writtenBytes = await readFile(targetPath);
  assert(writtenBytes.equals(bytes), `${targetName}: written chapter failed byte-for-byte verification.`);
}

for (const name of await readdir(chapterTargetRoot)) {
  if (/^\d{3}(?:-(?:standard|quick))?\.md$/u.test(name) && !expectedTargets.has(name)) {
    await unlink(path.join(chapterTargetRoot, name));
  }
}

const sourceRevision = sha256(Buffer.from(
  chapters.flatMap((chapter) => readingDepths.map((depth) => chapter.modes[depth].contentHash)).join(""),
  "utf8",
)).slice(0, 20);
const manifest = {
  schemaVersion: 1,
  sourceRevision,
  title: "Goldfrank’s Toxicologic Emergencies 學習指引",
  subtitle: "臨床毒理、暴露評估與中毒處置",
  chapterCount: chapters.length,
  defaultMode: "full",
  chapters,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
const manifestPath = path.join(targetRoot, "manifest.json");
await writeFile(manifestPath, manifestBytes);
assert((await readFile(manifestPath)).equals(manifestBytes), "Goldfrank guide manifest failed byte-for-byte verification.");

console.log(`Imported ${chapters.length} Goldfrank learning-guide chapters in ${modeSpecs.length} reading depths (${sourceRevision}).`);
