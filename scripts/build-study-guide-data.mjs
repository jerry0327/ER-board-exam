import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readTextbookLocator } from "./lib/textbook-locator-codec.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tocPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const guideRoot = path.join(projectRoot, "public", "guides");
const chapterRoot = path.join(guideRoot, "chapters");
const catalogPath = path.join(guideRoot, "manifest.json");
const linksPath = path.join(guideRoot, "links.json");

if (!tocPath || !fs.existsSync(tocPath)) {
  throw new Error("Usage: node scripts/build-study-guide-data.mjs <00_Master_Index_TOC.md>");
}

const toc = fs.readFileSync(tocPath, "utf8");
const locators = readTextbookLocator();
const sections = new Map();
const chapters = new Map();
let currentSection = null;

for (const line of toc.split(/\r?\n/u)) {
  const section = line.match(/^\|\s*1\s*\|\s*SECTION\s+(\d+)\s+(.+?)\s*\|\s*(\d+)?\s*\|\s*`([^`]+)`\s*\|/u);
  if (section) {
    currentSection = Number(section[1]);
    sections.set(currentSection, { id: currentSection, title: section[2].trim() });
    continue;
  }

  const chapter = line.match(/^\|\s*2\s*\|\s*(\d{1,3})([AB])?\s+(.+?)\s*\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|/u);
  if (!chapter || currentSection === null) continue;
  const id = Number(chapter[1]);
  if (id < 1 || id > 303) continue;
  const part = chapter[2] || null;
  const existing = chapters.get(id) ?? {
    id,
    title: "",
    sectionId: currentSection,
    sectionTitle: sections.get(currentSection)?.title ?? `Section ${currentSection}`,
    printPage: Number(chapter[4]),
    parts: [],
  };
  existing.parts.push({ part, title: chapter[3].trim(), printPage: Number(chapter[4]) });
  existing.title = existing.parts.map((entry) => entry.title).join(" / ");
  existing.printPage = Math.min(existing.printPage, Number(chapter[4]));
  chapters.set(id, existing);
}

const missingChapters = Array.from({ length: 303 }, (_, index) => index + 1).filter((id) => !chapters.has(id));
if (missingChapters.length) throw new Error(`TOC is missing chapters: ${missingChapters.join(", ")}`);

const questionToChapters = {};
const chapterToQuestions = Object.fromEntries(Array.from({ length: 303 }, (_, index) => [String(index + 1), []]));
let ambiguousOnlyQuestions = 0;

for (const [questionId, entries] of Object.entries(locators.questions)) {
  const exact = [...new Set(entries.map((entry) => entry.chapter).filter((id) => Number.isInteger(id) && id >= 1 && id <= 303))].sort((left, right) => left - right);
  if (!exact.length) {
    if (entries.some((entry) => Array.isArray(entry.candidateChapters) && entry.candidateChapters.length > 0)) ambiguousOnlyQuestions += 1;
    continue;
  }
  questionToChapters[questionId] = exact;
  for (const chapterId of exact) chapterToQuestions[String(chapterId)].push(questionId);
}

for (const ids of Object.values(chapterToQuestions)) ids.sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

fs.mkdirSync(chapterRoot, { recursive: true });
const catalogChapters = [...chapters.values()].sort((left, right) => left.id - right.id).map((chapter) => {
  const filename = `chapter-${String(chapter.id).padStart(3, "0")}.md`;
  const absoluteMarkdown = path.join(chapterRoot, filename);
  const available = fs.existsSync(absoluteMarkdown);
  const contentHash = available ? createHash("sha256").update(fs.readFileSync(absoluteMarkdown)).digest("hex").slice(0, 16) : null;
  return {
    ...chapter,
    available,
    markdownPath: available ? `/guides/chapters/${filename}` : null,
    contentHash,
    linkedQuestionCount: chapterToQuestions[String(chapter.id)].length,
  };
});

const catalog = {
  schemaVersion: 1,
  title: "Tintinalli 急診醫學學習指引",
  totalChapters: 303,
  importedChapters: catalogChapters.filter((chapter) => chapter.available).length,
  sections: [...sections.values()].sort((left, right) => left.id - right.id),
  chapters: catalogChapters,
};

const linkPayload = {
  schemaVersion: 1,
  sourceHash: locators.sourceHash,
  questionToChapters,
  chapterToQuestions,
  validation: {
    exactLinkedQuestions: Object.keys(questionToChapters).length,
    ambiguousQuestionsExcluded: ambiguousOnlyQuestions,
    questionChapterLinks: Object.values(questionToChapters).reduce((sum, ids) => sum + ids.length, 0),
    linkedChapters: Object.values(chapterToQuestions).filter((ids) => ids.length > 0).length,
  },
};

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
fs.writeFileSync(linksPath, `${JSON.stringify(linkPayload, null, 2)}\n`);
console.log(JSON.stringify({ catalog: catalogPath, links: linksPath, ...linkPayload.validation }, null, 2));
