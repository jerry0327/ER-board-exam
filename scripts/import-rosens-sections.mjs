import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { rosensSections } from "../app/lib/rosens-catalog.ts";
import {
  rosensSupplementalSectionId,
  rosensSupplementalSectionKeys,
} from "../app/lib/supplemental-guide-ids.ts";
import { normalizeStudyGuideSource } from "./lib/study-guide-reading-modes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const explicitSourceVersion = process.argv[3] ?? null;
const guideRoot = path.join(projectRoot, "public", "guides", "rosens");
const sectionRoot = path.join(guideRoot, "sections");
const manifestPath = path.join(guideRoot, "supplemental-manifest.json");
const rosensTitle = "Rosen’s Emergency Medicine: Concepts and Clinical Practice";
const wholeBookOverviewTitle = "Whole-Book Overview";

if (!zipPath || !fs.existsSync(zipPath)) {
  throw new Error("Usage: node --experimental-strip-types scripts/import-rosens-sections.mjs <rosens-sections.zip> [source-version]");
}
if (!fs.existsSync(manifestPath)) throw new Error("Rosen’s supplemental manifest is missing");

const digest = (value) => createHash("sha256").update(value).digest("hex");
const archive = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
const archiveNames = Object.keys(archive).filter((name) => !name.endsWith("/"));

function archiveEntry(suffix) {
  const matches = archiveNames.filter((name) => name.replaceAll("\\", "/").endsWith(`/${suffix}`));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${suffix} in the Rosen’s Sections archive`);
  return archive[matches[0]];
}

const report = JSON.parse(strFromU8(archiveEntry("harvest_report.json")));
const failedBuckets = ["invalid", "missing", "failed", "duplicates", "requiresUserSupplement"];
if (report.complete !== true || report.totalSections !== rosensSupplementalSectionKeys.length) {
  throw new Error("Rosen’s Sections archive is not marked complete");
}
for (const bucket of failedBuckets) {
  if (!Array.isArray(report[bucket]) || report[bucket].length !== 0) {
    throw new Error(`Rosen’s Sections archive has unresolved ${bucket} entries`);
  }
}
if (!Array.isArray(report.archived) || report.archived.length !== rosensSupplementalSectionKeys.length) {
  throw new Error("Rosen’s Sections archive report is incomplete");
}

const catalogKeys = rosensSections.map((section) => section.id.replace(/^p/u, "").replace("-s", "-"));
if (catalogKeys.some((key, index) => key !== rosensSupplementalSectionKeys[index])) {
  throw new Error("Rosen’s catalog and supplemental Section order disagree");
}

const reportedByKey = new Map(report.archived.map((entry) => [entry.key, entry]));
const unexpectedMarkdown = archiveNames
  .map((name) => path.posix.basename(name.replaceAll("\\", "/")))
  .filter((name) => /^section_\d{2}-\d{2}\.md$/u.test(name) && !rosensSupplementalSectionKeys.some((key) => name === `section_${key.split("-").map((part) => part.padStart(2, "0")).join("-")}.md`));
if (unexpectedMarkdown.length) throw new Error(`Unexpected Rosen’s Section files: ${unexpectedMarkdown.join(", ")}`);

function contentEntry(markdownPath, buffer) {
  const sourceSha256 = digest(buffer);
  return {
    markdownPath,
    contentHash: sourceSha256.slice(0, 16),
    sourceSha256,
    bytes: buffer.length,
  };
}

function normalizeSectionHeadingHierarchy(markdown, key, title) {
  const lines = markdown.split("\n");
  const bookHeading = lines.findIndex((line) => /^#\s+Rosen(?:’|'|’)s?\b/iu.test(line));
  if (bookHeading >= 0) lines.splice(bookHeading, 1);
  const firstHeading = lines.findIndex((line) => /^#{1,6}\s+\S/u.test(line));
  if (firstHeading < 0) throw new Error(`Rosen’s Section ${key} has no heading`);
  const [part, section] = key.split("-");
  lines[firstHeading] = `# Part ${part} · Section ${section}：${title}`;
  for (let index = firstHeading + 1; index < lines.length; index += 1) {
    if (/^#\s+\S/u.test(lines[index])) lines[index] = `#${lines[index]}`;
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const outputs = rosensSections.map((section, index) => {
  const key = rosensSupplementalSectionKeys[index];
  const canonicalId = rosensSupplementalSectionId(key);
  if (!canonicalId) throw new Error(`Invalid Rosen’s Section key: ${key}`);
  const filename = `section_${key.split("-").map((part) => part.padStart(2, "0")).join("-")}.md`;
  const sourceBytes = archiveEntry(filename);
  const sourceMarkdown = strFromU8(sourceBytes);
  if (sourceMarkdown.includes("\uFFFD") || sourceMarkdown.includes("\0")) throw new Error(`${filename} is not valid UTF-8 Markdown`);

  const reported = reportedByKey.get(key);
  if (!reported || reported.file !== filename) throw new Error(`${filename} is missing from the archive report`);
  const reportMarkdown = sourceMarkdown.replace(/\r?\n$/u, "");
  if (digest(Buffer.from(reportMarkdown, "utf8")) !== reported.sha256 || reportMarkdown.length !== reported.characters) {
    throw new Error(`${filename} does not match its archive report`);
  }

  const normalizedSource = normalizeStudyGuideSource(sourceMarkdown.replace(/^\uFEFF/u, ""));
  const normalized = normalizeSectionHeadingHierarchy(normalizedSource, key, section.title);
  const buffer = Buffer.from(normalized, "utf8");
  if (!/^#\s+\S/mu.test(normalized) || buffer.length < 1_000) throw new Error(`${filename} is not a valid Section guide`);

  const outputName = `${canonicalId}.md`;
  return {
    outputName,
    buffer,
    manifest: {
      id: canonicalId,
      section: key,
      title: section.title,
      partId: section.id,
      sectionLabel: section.sectionLabel,
      volume: section.volume,
      chapterIds: section.chapterIds,
      ...contentEntry(`/guides/rosens/sections/${outputName}`, buffer),
    },
  };
});

const sourceVersion = explicitSourceVersion
  ?? (typeof report.generatedAt === "string" && /^\d{4}-\d{2}-\d{2}/u.test(report.generatedAt) ? report.generatedAt.slice(0, 10) : null);
if (!sourceVersion) throw new Error("Rosen’s Sections source version is missing");

const existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (existingManifest.schemaVersion !== 1 || existingManifest.textbookId !== "rosens" || !existingManifest.overview) {
  throw new Error("Existing Rosen’s supplemental manifest is invalid");
}
const manifest = {
  ...existingManifest,
  title: rosensTitle,
  overview: {
    ...existingManifest.overview,
    title: wholeBookOverviewTitle,
  },
  sourceVersion,
  sectionsSourceVersion: sourceVersion,
  sections: outputs.map((output) => output.manifest),
};

// Write only after the archive, report, catalog mapping, and all 27 guides
// have passed validation, so a malformed upload cannot leave a partial import.
fs.mkdirSync(sectionRoot, { recursive: true });
for (const output of outputs) fs.writeFileSync(path.join(sectionRoot, output.outputName), output.buffer);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  sourceVersion,
  sections: outputs.length,
  bytes: outputs.reduce((total, output) => total + output.buffer.length, 0),
  first: outputs[0].manifest.id,
  last: outputs.at(-1).manifest.id,
}, null, 2));
