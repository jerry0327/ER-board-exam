import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditHeadingCategories,
  buildFocusMarkdown,
  buildQuickMarkdown,
  isProductionMetadataNode,
  normalizeImplicitHeadingSequences,
  parseGuideMarkdown,
  visibleMarkdownUnits,
} from "./lib/study-guide-reading-modes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packId = process.argv[2] ?? "concise";
if (!/^[a-z][a-z0-9-]*$/u.test(packId)) throw new Error(`Invalid pack id: ${packId}`);

const manifestPath = path.join(projectRoot, "public", "guides", "manifest.json");
const packRoot = path.join(projectRoot, "public", "guides", "packs", packId);
const fullRoot = path.join(packRoot, "full");
const focusRoot = path.join(packRoot, "key-points");
const quickRoot = path.join(packRoot, "quick");
const digest = (value) => createHash("sha256").update(value).digest("hex");

const catalog = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (catalog.totalChapters !== 303 || catalog.chapters.length !== 303) throw new Error("Guide catalog is incomplete");

const prepared = [];
const metrics = {
  fullBytes: 0,
  focusBytes: 0,
  quickBytes: 0,
  quickVisibleUnits: [],
  normalizedImplicitHeadings: 0,
  headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, numeric: 0, "chinese-number": 0, letter: 0, part: 0 },
};

for (const chapter of catalog.chapters) {
  const filename = `chapter-${String(chapter.id).padStart(3, "0")}.md`;
  const sourcePath = path.join(fullRoot, filename);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing full guide: ${filename}`);

  const sourceMarkdown = fs.readFileSync(sourcePath, "utf8");
  const beforeH4 = auditHeadingCategories(sourceMarkdown).h4;
  const fullMarkdown = normalizeImplicitHeadingSequences(sourceMarkdown);
  const afterCounts = auditHeadingCategories(fullMarkdown);
  metrics.normalizedImplicitHeadings += afterCounts.h4 - beforeH4;
  const focusMarkdown = buildFocusMarkdown(fullMarkdown);
  const quickMarkdown = buildQuickMarkdown(fullMarkdown);
  const fullBuffer = Buffer.from(fullMarkdown, "utf8");
  const focusBuffer = Buffer.from(focusMarkdown, "utf8");
  const quickBuffer = Buffer.from(quickMarkdown, "utf8");
  const visibleUnits = visibleMarkdownUnits(quickMarkdown);

  if (!(quickBuffer.length < focusBuffer.length && focusBuffer.length < fullBuffer.length)) {
    throw new Error(`${filename}: expected quick < focus < full bytes, got ${quickBuffer.length} < ${focusBuffer.length} < ${fullBuffer.length}`);
  }
  if (visibleUnits < 1_400 || visibleUnits > 2_600) {
    throw new Error(`${filename}: quick mode has ${visibleUnits} visible units; expected 1,400–2,600`);
  }
  for (const [mode, markdown] of [["quick", quickMarkdown], ["focus", focusMarkdown]]) {
    const metadata = parseGuideMarkdown(markdown).nodes.some((item) => isProductionMetadataNode(item.node));
    if (metadata) throw new Error(`${filename}: ${mode} mode retained production metadata`);
  }

  metrics.fullBytes += fullBuffer.length;
  metrics.focusBytes += focusBuffer.length;
  metrics.quickBytes += quickBuffer.length;
  metrics.quickVisibleUnits.push(visibleUnits);
  for (const key of Object.keys(metrics.headingCounts)) metrics.headingCounts[key] += afterCounts[key];
  prepared.push({ chapter, filename, fullBuffer, focusBuffer, quickBuffer });
}

fs.mkdirSync(focusRoot, { recursive: true });
fs.mkdirSync(quickRoot, { recursive: true });

for (const entry of prepared) {
  fs.writeFileSync(path.join(fullRoot, entry.filename), entry.fullBuffer);
  fs.writeFileSync(path.join(focusRoot, entry.filename), entry.focusBuffer);
  fs.writeFileSync(path.join(quickRoot, entry.filename), entry.quickBuffer);

  const current = entry.chapter.contents?.[packId];
  if (!current?.available) throw new Error(`Chapter ${entry.chapter.id} has no available ${packId} manifest entry`);
  current.modes = {
    quick: {
      markdownPath: `/guides/packs/${packId}/quick/${entry.filename}`,
      contentHash: digest(entry.quickBuffer).slice(0, 16),
      sourceSha256: digest(entry.quickBuffer),
      bytes: entry.quickBuffer.length,
    },
    focus: {
      markdownPath: `/guides/packs/${packId}/key-points/${entry.filename}`,
      contentHash: digest(entry.focusBuffer).slice(0, 16),
      sourceSha256: digest(entry.focusBuffer),
      bytes: entry.focusBuffer.length,
    },
    full: {
      markdownPath: `/guides/packs/${packId}/full/${entry.filename}`,
      contentHash: digest(entry.fullBuffer).slice(0, 16),
      sourceSha256: digest(entry.fullBuffer),
      bytes: entry.fullBuffer.length,
    },
  };
  if (packId === catalog.defaultPackId) {
    entry.chapter.markdownPath = current.modes.full.markdownPath;
    entry.chapter.contentHash = current.modes.full.contentHash;
  }
}

catalog.schemaVersion = 3;
fs.writeFileSync(manifestPath, `${JSON.stringify(catalog, null, 2)}\n`);

const sortedUnits = metrics.quickVisibleUnits.toSorted((left, right) => left - right);
console.log(JSON.stringify({
  manifest: manifestPath,
  packId,
  chapters: prepared.length,
  fullBytes: metrics.fullBytes,
  focusBytes: metrics.focusBytes,
  quickBytes: metrics.quickBytes,
  focusRatio: Number((metrics.focusBytes / metrics.fullBytes).toFixed(3)),
  quickRatio: Number((metrics.quickBytes / metrics.fullBytes).toFixed(3)),
  quickVisibleUnits: {
    min: sortedUnits[0],
    median: sortedUnits[Math.floor(sortedUnits.length / 2)],
    average: Math.round(sortedUnits.reduce((sum, value) => sum + value, 0) / sortedUnits.length),
    max: sortedUnits.at(-1),
    withinIdeal1400To2200: sortedUnits.filter((value) => value <= 2_200).length,
  },
  normalizedImplicitHeadings: metrics.normalizedImplicitHeadings,
  headingCounts: metrics.headingCounts,
}, null, 2));

