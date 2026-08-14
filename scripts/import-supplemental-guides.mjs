import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tintinalliSectionsRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const tintinalliOverviewPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const rosensOverviewPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
const sourceVersion = process.argv[5] ?? new Date().toISOString().slice(0, 10);
const tintinalliTitle = "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide";
const rosensTitle = "Rosen’s Emergency Medicine: Concepts and Clinical Practice";
const wholeBookOverviewTitle = "Whole-Book Overview";

if (!tintinalliSectionsRoot || !tintinalliOverviewPath || !rosensOverviewPath) {
  throw new Error("Usage: node scripts/import-supplemental-guides.mjs <tintinalli-sections-directory> <tintinalli-overview.md> <rosens-overview.md> [source-version]");
}

const textbookSectionsPath = path.join(projectRoot, "app", "data", "textbook-sections.json");
const textbookSections = JSON.parse(fs.readFileSync(textbookSectionsPath, "utf8"));
if (textbookSections.schema !== "em-board-textbook-sections-v1") {
  throw new Error("Unexpected textbook section catalog schema");
}
const sectionTitles = textbookSections.textbooks?.tintinalli?.sections?.map((section) => section.title) ?? [];
if (sectionTitles.length !== 26) throw new Error("Tintinalli section taxonomy must contain 26 sections");

function normalizedMarkdown(sourcePath, label) {
  if (!fs.existsSync(sourcePath)) throw new Error(`${label} is missing: ${sourcePath}`);
  const markdown = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trim();
  if (!/^#\s+/mu.test(markdown) || Buffer.byteLength(markdown, "utf8") < 1_000) {
    throw new Error(`${label} is not a valid Markdown guide`);
  }
  return `${markdown}\n`;
}

function normalizeTintinalliOverviewHeadings(markdown) {
  let withinSection = false;
  return markdown.split("\n").map((line, index) => {
    if (index === 0) return line;
    if (/^#\s+Section\s+\d+/iu.test(line)) {
      withinSection = true;
      return `##${line}`;
    }
    if (/^#\s+/u.test(line)) {
      withinSection = false;
      return `#${line}`;
    }
    if (/^##\s+/u.test(line) && withinSection) return `##${line}`;
    if (/^##\s+/u.test(line) && !/^##\s+使用範圍與版本限制\s*$/u.test(line)) return `#${line}`;
    return line;
  }).join("\n");
}

function normalizeTintinalliSectionHeadings(markdown, section, title) {
  const body = markdown
    .split("\n")
    .map((line) => /^#\s+/u.test(line) ? `#${line}` : line)
    .join("\n")
    .trim();
  return `# Section ${section}｜${title}\n\n${body}\n`;
}

function normalizeWholeBookHeading(markdown, bookTitle) {
  return markdown.replace(/^#\s+\S.*$/mu, `# ${bookTitle} — ${wholeBookOverviewTitle}`);
}

function entry(id, title, markdownPath, markdown) {
  const buffer = Buffer.from(markdown, "utf8");
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    id,
    title,
    markdownPath,
    contentHash: sourceSha256.slice(0, 16),
    sourceSha256,
    bytes: buffer.length,
  };
}

const tintinalliOverview = normalizeWholeBookHeading(
  normalizeTintinalliOverviewHeadings(normalizedMarkdown(tintinalliOverviewPath, "Tintinalli whole-book guide")),
  tintinalliTitle,
);
const rosensOverview = normalizeWholeBookHeading(normalizedMarkdown(rosensOverviewPath, "Rosen's whole-book guide"), rosensTitle);
const sectionSources = sectionTitles.map((title, index) => {
  const section = index + 1;
  const filename = `section_${String(section).padStart(3, "0")}.md`;
  return {
    section,
    filename,
    title,
    markdown: normalizeTintinalliSectionHeadings(
      normalizedMarkdown(path.join(tintinalliSectionsRoot, filename), `Tintinalli Section ${section}`),
      section,
      title,
    ),
  };
});

const unexpectedSectionFiles = fs.readdirSync(tintinalliSectionsRoot)
  .filter((name) => /^section_\d{3}\.md$/u.test(name) && !sectionSources.some((source) => source.filename === name));
if (unexpectedSectionFiles.length) throw new Error(`Unexpected Tintinalli section files: ${unexpectedSectionFiles.join(", ")}`);

const tintinalliRoot = path.join(projectRoot, "public", "guides", "tintinalli");
const tintinalliSectionRoot = path.join(tintinalliRoot, "sections");
const rosensRoot = path.join(projectRoot, "public", "guides", "rosens");
fs.mkdirSync(tintinalliSectionRoot, { recursive: true });
fs.mkdirSync(rosensRoot, { recursive: true });

fs.writeFileSync(path.join(tintinalliRoot, "whole-book.md"), tintinalliOverview);
for (const source of sectionSources) {
  fs.writeFileSync(path.join(tintinalliSectionRoot, source.filename.replace("_", "-")), source.markdown);
}
fs.writeFileSync(path.join(rosensRoot, "whole-book.md"), rosensOverview);

const tintinalliManifest = {
  schemaVersion: 1,
  textbookId: "tintinalli",
  title: tintinalliTitle,
  sourceVersion,
  overview: entry("overview", wholeBookOverviewTitle, "/guides/tintinalli/whole-book.md", tintinalliOverview),
  sections: sectionSources.map((source) => ({
    section: source.section,
    ...entry(
      `section-${String(source.section).padStart(2, "0")}`,
      source.title,
      `/guides/tintinalli/sections/${source.filename.replace("_", "-")}`,
      source.markdown,
    ),
  })),
};
const rosensSupplementalManifestPath = path.join(rosensRoot, "supplemental-manifest.json");
const existingRosensSupplementalManifest = fs.existsSync(rosensSupplementalManifestPath)
  ? JSON.parse(fs.readFileSync(rosensSupplementalManifestPath, "utf8"))
  : null;
const preservedRosensSections = Array.isArray(existingRosensSupplementalManifest?.sections)
  ? existingRosensSupplementalManifest.sections
  : null;
const rosensSupplementalManifest = {
  schemaVersion: 1,
  textbookId: "rosens",
  title: rosensTitle,
  sourceVersion,
  overviewSourceVersion: sourceVersion,
  overview: entry("overview", wholeBookOverviewTitle, "/guides/rosens/whole-book.md", rosensOverview),
  ...(preservedRosensSections ? {
    sectionsSourceVersion: existingRosensSupplementalManifest.sectionsSourceVersion ?? existingRosensSupplementalManifest.sourceVersion,
    sections: preservedRosensSections,
  } : {}),
};

fs.writeFileSync(path.join(tintinalliRoot, "manifest.json"), `${JSON.stringify(tintinalliManifest, null, 2)}\n`);
fs.writeFileSync(rosensSupplementalManifestPath, `${JSON.stringify(rosensSupplementalManifest, null, 2)}\n`);

console.log(JSON.stringify({
  sourceVersion,
  tintinalli: { overviewBytes: Buffer.byteLength(tintinalliOverview), sections: sectionSources.length },
  rosens: { overviewBytes: Buffer.byteLength(rosensOverview) },
}, null, 2));
