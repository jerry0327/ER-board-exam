import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(
  process.env.EMS_GUIDE_SOURCE
    || path.join(repositoryRoot, "..", "..", "outputs", "02_learning_guides", "ems"),
);
const targetRoot = path.join(repositoryRoot, "public", "guides", "ems");
const chapterTargetRoot = path.join(targetRoot, "chapters");
const expectedChapterCount = 24;
const modeSpecs = [
  { id: "full", sourceVariant: "full", targetSuffix: "", minimumCharacters: 2_000 },
  { id: "standard", sourceVariant: "standard", targetSuffix: "-standard", minimumCharacters: 2_000 },
  { id: "quick", sourceVariant: "quick", targetSuffix: "-quick", minimumCharacters: 600 },
];
const readingDepths = ["quick", "standard", "full"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourceNames = (await readdir(sourceRoot))
  .filter((name) => /^ems-CH\d{3}-(?:full|standard|quick)\.md$/u.test(name))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

assert(
  sourceNames.length === expectedChapterCount * modeSpecs.length,
  `EMS guide expected ${expectedChapterCount * modeSpecs.length} chapter variants, found ${sourceNames.length}.`,
);

const expectedSourceNames = Array.from({ length: expectedChapterCount }, (_, index) => {
  const id = String(index + 1).padStart(3, "0");
  return modeSpecs.map((mode) => `ems-CH${id}-${mode.sourceVariant}.md`);
}).flat();
const sourceNameSet = new Set(sourceNames);
for (const sourceName of expectedSourceNames) {
  assert(sourceNameSet.has(sourceName), `EMS guide source is missing ${sourceName}.`);
}

await mkdir(chapterTargetRoot, { recursive: true });
const expectedTargets = new Set();
const chapters = [];

for (let index = 0; index < expectedChapterCount; index += 1) {
  const number = index + 1;
  const id = String(number).padStart(3, "0");
  const modes = {};

  for (const mode of modeSpecs) {
    const sourceName = `ems-CH${id}-${mode.sourceVariant}.md`;
    const rawBytes = await readFile(path.join(sourceRoot, sourceName));
    const raw = rawBytes.toString("utf8");
    const markdown = `${raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd()}\n`;
    const heading = /^#\s+第(\d+)章\s+(.+)$/mu.exec(markdown);
    assert(heading, `${sourceName}: missing chapter H1.`);
    assert(Number(heading[1]) === number, `${sourceName}: H1 chapter number does not match its filename.`);
    assert(markdown.length >= mode.minimumCharacters, `${sourceName}: chapter content is unexpectedly short.`);

    const targetName = `${id}${mode.targetSuffix}.md`;
    const targetPath = path.join(chapterTargetRoot, targetName);
    const bytes = Buffer.from(markdown, "utf8");
    await writeFile(targetPath, bytes);
    expectedTargets.add(targetName);
    modes[mode.id] = {
      headingTitle: heading[2].trim(),
      bytes: bytes.byteLength,
      contentHash: sha256(bytes),
      sourceSha256: sha256(rawBytes),
      markdownPath: `/guides/ems/chapters/${targetName}`,
    };
  }

  const full = modes.full;
  chapters.push({
    id,
    number,
    title: full.headingTitle,
    order: number,
    bytes: full.bytes,
    contentHash: full.contentHash,
    markdownPath: full.markdownPath,
    modes,
  });
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
  title: "緊急醫療救護（EMS）學習指引",
  subtitle: "到院前救護、系統、災難與研究",
  chapterCount: chapters.length,
  defaultMode: "full",
  chapters,
};

await writeFile(
  path.join(targetRoot, "manifest.json"),
  `${JSON.stringify(manifest)}\n`,
  "utf8",
);

console.log(`Imported ${chapters.length} EMS learning-guide chapters in ${modeSpecs.length} reading depths (${sourceRevision}).`);
