import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFocusMarkdown,
  buildQuickMarkdown,
  normalizeImplicitHeadingSequences,
  normalizeStudyGuideSource,
  visibleMarkdownUnits,
} from "./lib/study-guide-reading-modes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chapterSourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const overviewSourcePath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const sourceVersion = process.argv[4] ?? null;
const guideRoot = path.join(projectRoot, "public", "guides", "rosens");
const packRoot = path.join(guideRoot, "detailed");
const manifestPath = path.join(guideRoot, "manifest.json");

if (!chapterSourceRoot || !fs.existsSync(chapterSourceRoot)) {
  throw new Error("Usage: node scripts/import-rosens-guide-pack.mjs <chapters-directory> <whole-book-overview.md> [source-version]");
}
if (!overviewSourcePath || !fs.existsSync(overviewSourcePath)) {
  throw new Error("Rosen's whole-book overview Markdown is required");
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const contentEntry = (relativePath, buffer) => ({
  markdownPath: `/guides/rosens/detailed/${relativePath.replaceAll(path.sep, "/")}`,
  contentHash: digest(buffer).slice(0, 16),
  sourceSha256: digest(buffer),
  bytes: buffer.length,
});
const sourcePathFor = (sequence) => path.join(chapterSourceRoot, `chapter_${String(sequence).padStart(3, "0")}.md`);
const chapterIdForSequence = (sequence) => sequence <= 192
  ? String(sequence).padStart(3, "0")
  : `e${String(sequence - 192).padStart(2, "0")}`;

function normalizeDocumentHeadingHierarchy(markdown) {
  let primaryHeadingSeen = false;
  return markdown.split("\n").map((line) => {
    if (!/^#\s+/u.test(line)) return line;
    if (!primaryHeadingSeen) {
      primaryHeadingSeen = true;
      return line;
    }
    return `#${line}`;
  }).join("\n");
}

const unexpectedChapterFiles = fs.readdirSync(chapterSourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^chapter_\d+\.md$/u.test(entry.name) && !/^chapter_(?:00[1-9]|0[1-9]\d|1\d{2}|20[0-8])\.md$/u.test(entry.name))
  .map((entry) => entry.name);
if (unexpectedChapterFiles.length) throw new Error(`Unexpected Rosen's chapter files: ${unexpectedChapterFiles.join(", ")}`);

const missing = Array.from({ length: 208 }, (_, index) => index + 1).filter((sequence) => !fs.existsSync(sourcePathFor(sequence)));
if (missing.length) throw new Error(`Missing Rosen's source chapters: ${missing.map((value) => String(value).padStart(3, "0")).join(", ")}`);

const prepared = [];
const manifestChapters = [];
let fullBytes = 0;
let standardBytes = 0;
let quickBytes = 0;
let quickVisibleUnits = 0;

for (let sequence = 1; sequence <= 208; sequence += 1) {
  const chapterId = chapterIdForSequence(sequence);
  const sourceMarkdown = normalizeStudyGuideSource(fs.readFileSync(sourcePathFor(sequence), "utf8"));
  const fullMarkdown = normalizeDocumentHeadingHierarchy(normalizeImplicitHeadingSequences(sourceMarkdown));
  const heading = fullMarkdown.match(/^#\s+(.+)$/mu)?.[1] ?? "";
  const headingNumber = heading.match(/(?:第\s*0*(\d{1,3})\s*章|Chapter\s*0*(\d{1,3})\b)/iu);
  const identifiedSequence = Number(headingNumber?.[1] ?? headingNumber?.[2] ?? NaN);
  if (Number.isInteger(identifiedSequence) && identifiedSequence !== sequence) {
    throw new Error(`Rosen's source chapter ${sequence} identifies chapter ${identifiedSequence}`);
  }
  const fullBuffer = Buffer.from(fullMarkdown, "utf8");
  if (!/^#\s+/u.test(fullMarkdown) || fullBuffer.length < 100) throw new Error(`Rosen's source chapter ${sequence} is invalid`);

  const standardMarkdown = buildFocusMarkdown(fullMarkdown);
  const quickMarkdown = buildQuickMarkdown(fullMarkdown);
  const standardBuffer = Buffer.from(standardMarkdown, "utf8");
  const quickBuffer = Buffer.from(quickMarkdown, "utf8");
  const visibleUnits = visibleMarkdownUnits(quickMarkdown);
  if (!(quickBuffer.length < standardBuffer.length && standardBuffer.length < fullBuffer.length)) {
    throw new Error(`Rosen's ${chapterId} guide sizes are not quick < standard < full`);
  }
  if (visibleUnits < 1_400 || visibleUnits > 2_600) {
    throw new Error(`Rosen's ${chapterId} quick guide has ${visibleUnits} visible units`);
  }

  const modes = {
    quick: contentEntry(path.join(chapterId, "quick.md"), quickBuffer),
    standard: contentEntry(path.join(chapterId, "standard.md"), standardBuffer),
    full: contentEntry(path.join(chapterId, "full.md"), fullBuffer),
  };
  prepared.push({ chapterId, fullBuffer, standardBuffer, quickBuffer });
  manifestChapters.push({ id: chapterId, sourceSequence: sequence, available: true, modes });
  fullBytes += fullBuffer.length;
  standardBytes += standardBuffer.length;
  quickBytes += quickBuffer.length;
  quickVisibleUnits += visibleUnits;
}

const overviewMarkdown = normalizeStudyGuideSource(fs.readFileSync(overviewSourcePath, "utf8"));
const overviewBuffer = Buffer.from(overviewMarkdown, "utf8");
if (!/^#\s+/u.test(overviewMarkdown) || overviewBuffer.length < 100) throw new Error("Rosen's whole-book overview is invalid");
const overview = contentEntry("overview.md", overviewBuffer);

const manifest = {
  schemaVersion: 1,
  textbookId: "rosens",
  title: "Rosen’s Emergency Medicine 學習指引",
  packId: "detailed",
  sourceVersion,
  totalEntries: 208,
  importedChapters: 208,
  defaultMode: "standard",
  overview,
  chapters: manifestChapters,
};

// Do not touch production output until every source chapter and the overview
// have passed validation. Re-running the import deterministically replaces the
// same files and manifest.
fs.mkdirSync(packRoot, { recursive: true });
for (const entry of prepared) {
  const chapterRoot = path.join(packRoot, entry.chapterId);
  fs.mkdirSync(chapterRoot, { recursive: true });
  fs.writeFileSync(path.join(chapterRoot, "quick.md"), entry.quickBuffer);
  fs.writeFileSync(path.join(chapterRoot, "standard.md"), entry.standardBuffer);
  fs.writeFileSync(path.join(chapterRoot, "full.md"), entry.fullBuffer);
}
fs.writeFileSync(path.join(packRoot, "overview.md"), overviewBuffer);
fs.mkdirSync(guideRoot, { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifest: manifestPath,
  sourceVersion,
  chapters: prepared.length,
  unavailableChapterIds: [],
  overviewBytes: overviewBuffer.length,
  fullBytes,
  standardBytes,
  quickBytes,
  quickVisibleUnitsAverage: Math.round(quickVisibleUnits / prepared.length),
  quickRatio: Number((quickBytes / fullBytes).toFixed(3)),
  standardRatio: Number((standardBytes / fullBytes).toFixed(3)),
}, null, 2));
