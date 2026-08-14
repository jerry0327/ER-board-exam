import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditHeadingCategories,
  buildFocusMarkdown,
  buildQuickMarkdown,
  normalizeImplicitHeadingSequences,
  normalizeStudyGuideSource,
  visibleMarkdownUnits,
} from "./lib/study-guide-reading-modes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chapterSourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const packId = process.argv[3] ?? "concise";
const packLabel = process.argv[4] ?? (packId === "concise" ? "精要版" : "詳細版");
const sourceVersion = process.argv[5] ?? null;
const manifestPath = path.join(projectRoot, "public", "guides", "manifest.json");
const packRoot = path.join(projectRoot, "public", "guides", "packs", packId);
const fullRoot = path.join(packRoot, "full");
const focusRoot = path.join(packRoot, "key-points");
const quickRoot = path.join(packRoot, "quick");

if (!chapterSourceRoot || !fs.existsSync(chapterSourceRoot)) {
  throw new Error("Usage: node scripts/import-study-guide-pack.mjs <chapters-directory> [pack-id] [label] [source-version]");
}
if (!/^[a-z][a-z0-9-]*$/u.test(packId)) throw new Error(`Invalid pack id: ${packId}`);

const digest = (value) => createHash("sha256").update(value).digest("hex");

const sourceEntries = fs.readdirSync(chapterSourceRoot, { withFileTypes: true });
const directories = sourceEntries
  .filter((entry) => entry.isDirectory() && /^\d{3}_/u.test(entry.name))
  .sort((left, right) => left.name.localeCompare(right.name, "en"));
const flatFiles = sourceEntries
  .filter((entry) => entry.isFile() && /^chapter_\d{3}\.md$/u.test(entry.name))
  .sort((left, right) => left.name.localeCompare(right.name, "en"));

if (directories.length && flatFiles.length) throw new Error("Chapter source mixes workflow directories and flat chapter files");
if (directories.length !== 303 && flatFiles.length !== 303) {
  throw new Error(`Expected 303 workflow directories or 303 flat chapter files, found ${directories.length} and ${flatFiles.length}`);
}

const chapterSources = directories.length
  ? directories.map((directory) => ({
    chapterId: Number(directory.name.slice(0, 3)),
    sourcePath: path.join(chapterSourceRoot, directory.name, "final_study_guide_zh-TW.md"),
    metaPath: path.join(chapterSourceRoot, directory.name, "chapter_meta.json"),
    sourceName: directory.name,
  }))
  : flatFiles.map((file) => ({
    chapterId: Number(file.name.slice(8, 11)),
    sourcePath: path.join(chapterSourceRoot, file.name),
    metaPath: null,
    sourceName: file.name,
  }));

const catalog = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (catalog.totalChapters !== 303 || catalog.chapters.length !== 303) throw new Error("Existing guide catalog is incomplete");

let fullBytes = 0;
let focusBytes = 0;
let quickBytes = 0;
let quickVisibleUnits = 0;
const headingCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, numeric: 0, "chinese-number": 0, letter: 0, part: 0 };
const seen = new Set();
const outputs = [];

for (const source of chapterSources) {
  const { chapterId } = source;
  if (!Number.isInteger(chapterId) || chapterId < 1 || chapterId > 303 || seen.has(chapterId)) {
    throw new Error(`Invalid or duplicate chapter source: ${source.sourceName}`);
  }
  seen.add(chapterId);

  if (!fs.existsSync(source.sourcePath)) throw new Error(`Chapter ${chapterId} is missing its final guide`);
  if (source.metaPath) {
    if (!fs.existsSync(source.metaPath)) throw new Error(`Chapter ${chapterId} is missing its metadata`);
    const metadata = JSON.parse(fs.readFileSync(source.metaPath, "utf8"));
    if (Number(metadata.chapter) !== chapterId || metadata.status !== "completed" || metadata.workflow_completed !== true) {
      throw new Error(`Chapter ${chapterId} metadata is not marked complete`);
    }
  }

  const sourceMarkdown = normalizeStudyGuideSource(fs.readFileSync(source.sourcePath, "utf8"));
  let fullMarkdown = normalizeImplicitHeadingSequences(sourceMarkdown);
  const catalogChapter = catalog.chapters[chapterId - 1];
  if (catalogChapter.id !== chapterId) throw new Error(`Catalog chapter order mismatch at ${chapterId}`);
  const firstHeading = fullMarkdown.match(/^#\s+(.+)$/mu)?.[1] ?? "";
  const chapterNumberFromHeading = (value) => {
    const match = value.match(/(?:第\s*0*(\d{1,3})\s*章|Chapter\s*0*(\d{1,3})\b|CH\s*0*(\d{1,3})\b)/iu);
    return Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? NaN);
  };
  const firstHeadingChapter = chapterNumberFromHeading(firstHeading);
  if (Number.isInteger(firstHeadingChapter) && firstHeadingChapter !== chapterId) {
    throw new Error(`Chapter ${chapterId} first heading identifies chapter ${firstHeadingChapter}`);
  }
  const searchableHeading = (value) => value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const expectedTitle = searchableHeading(catalogChapter.title);
  const firstHeadingIncludesTitle = searchableHeading(firstHeading).includes(expectedTitle);
  const laterHeadings = [...fullMarkdown.matchAll(/^#{1,6}\s+(.+)$/gmu)]
    .filter((match) => (match.index ?? 0) > 0 && (match.index ?? 0) < 600);
  const laterTitleHeading = laterHeadings.find((match) => searchableHeading(match[1]).includes(expectedTitle));
  const laterNumberedHeading = laterHeadings.find((match) => chapterNumberFromHeading(match[1]) === chapterId);
  if (!firstHeadingIncludesTitle && laterTitleHeading) {
    const laterHeading = laterTitleHeading[0];
    fullMarkdown = fullMarkdown.replace(/^#\s+.+\n+/u, "");
    fullMarkdown = fullMarkdown.replace(laterHeading, laterHeading.replace(/^#{1,6}/u, "#"));
  } else if (!Number.isInteger(firstHeadingChapter)) {
    const laterHeading = laterNumberedHeading?.[0];
    if (!laterHeading) throw new Error(`Chapter ${chapterId} has no heading with its chapter number`);
    fullMarkdown = fullMarkdown.replace(/^#\s+.+\n+/u, "");
    fullMarkdown = fullMarkdown.replace(laterHeading, laterHeading.replace(/^#{1,6}/u, "#"));
  }
  const fullBuffer = Buffer.from(fullMarkdown, "utf8");
  if (!/^#\s+/u.test(fullMarkdown) || fullBuffer.length < 100) throw new Error(`Chapter ${chapterId} final guide is invalid`);
  const focusMarkdown = buildFocusMarkdown(fullMarkdown);
  const quickMarkdown = buildQuickMarkdown(fullMarkdown);
  const focusBuffer = Buffer.from(focusMarkdown, "utf8");
  const quickBuffer = Buffer.from(quickMarkdown, "utf8");
  const visibleUnits = visibleMarkdownUnits(quickMarkdown);
  if (!(quickBuffer.length < focusBuffer.length && focusBuffer.length < fullBuffer.length)) {
    throw new Error(`Chapter ${chapterId} guide sizes are not quick < focus < full`);
  }
  if (visibleUnits < 1_400 || visibleUnits > 2_600) throw new Error(`Chapter ${chapterId} quick guide has ${visibleUnits} visible units`);

  const filename = `chapter-${String(chapterId).padStart(3, "0")}.md`;
  outputs.push({ filename, fullBuffer, focusBuffer, quickBuffer });
  fullBytes += fullBuffer.length;
  focusBytes += focusBuffer.length;
  quickBytes += quickBuffer.length;
  quickVisibleUnits += visibleUnits;
  const chapterHeadingCounts = auditHeadingCategories(fullMarkdown);
  for (const key of Object.keys(headingCounts)) headingCounts[key] += chapterHeadingCounts[key];

  const chapter = catalogChapter;
  chapter.contents = chapter.contents ?? {};
  chapter.contents[packId] = {
    available: true,
    sourceVersion,
    modes: {
      quick: {
        markdownPath: `/guides/packs/${packId}/quick/${filename}`,
        contentHash: digest(quickBuffer).slice(0, 16),
        sourceSha256: digest(quickBuffer),
        bytes: quickBuffer.length,
      },
      focus: {
        markdownPath: `/guides/packs/${packId}/key-points/${filename}`,
        contentHash: digest(focusBuffer).slice(0, 16),
        sourceSha256: digest(focusBuffer),
        bytes: focusBuffer.length,
      },
      full: {
        markdownPath: `/guides/packs/${packId}/full/${filename}`,
        contentHash: digest(fullBuffer).slice(0, 16),
        sourceSha256: digest(fullBuffer),
        bytes: fullBuffer.length,
      },
    },
  };
}

// Write only after every chapter has passed validation, so one malformed
// upload cannot leave a partially imported production pack behind.
fs.mkdirSync(fullRoot, { recursive: true });
fs.mkdirSync(focusRoot, { recursive: true });
fs.mkdirSync(quickRoot, { recursive: true });
for (const output of outputs) {
  fs.writeFileSync(path.join(fullRoot, output.filename), output.fullBuffer);
  fs.writeFileSync(path.join(focusRoot, output.filename), output.focusBuffer);
  fs.writeFileSync(path.join(quickRoot, output.filename), output.quickBuffer);
}

const pack = {
  id: packId,
  label: packLabel,
  description: packId === "concise"
    ? "目前匯入的 303 章版本，適合快速建立架構與複習。"
    : "逐章補充更多細節、脈絡與延伸閱讀。",
  status: "available",
  importedChapters: 303,
  sourceVersion,
};
const packs = Array.isArray(catalog.packs) ? [...catalog.packs] : [];
const existingPackIndex = packs.findIndex((entry) => entry.id === packId);
if (existingPackIndex >= 0) packs[existingPackIndex] = pack;
else packs.push(pack);
if (packId === "concise" && !packs.some((entry) => entry.id === "detailed")) {
  packs.push({
    id: "detailed",
    label: "詳細版",
    description: "保留給之後上傳的詳細學習指引；匯入後可直接逐章切換。",
    status: "coming_soon",
    importedChapters: 0,
    sourceVersion: null,
  });
}

catalog.schemaVersion = 3;
catalog.defaultPackId = catalog.defaultPackId ?? "concise";
catalog.packs = packs;
const defaultPack = packs.find((entry) => entry.id === catalog.defaultPackId);
catalog.importedChapters = defaultPack?.importedChapters ?? 0;

for (const chapter of catalog.chapters) {
  const defaultContent = chapter.contents?.[catalog.defaultPackId];
  chapter.available = Boolean(defaultContent?.available);
  chapter.markdownPath = defaultContent?.modes?.full?.markdownPath ?? null;
  chapter.contentHash = defaultContent?.modes?.full?.contentHash ?? null;
}

fs.writeFileSync(manifestPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({
  manifest: manifestPath,
  packId,
  sourceLayout: directories.length ? "workflow-directories" : "flat-files",
  chapters: seen.size,
  fullBytes,
  focusBytes,
  quickBytes,
  quickVisibleUnitsAverage: Math.round(quickVisibleUnits / seen.size),
  quickRatio: Number((quickBytes / fullBytes).toFixed(3)),
  focusRatio: Number((focusBytes / fullBytes).toFixed(3)),
  headingCounts,
}, null, 2));
