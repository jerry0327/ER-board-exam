import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStudyGuideMarkdown } from "../app/lib/study-guide-markdown.ts";
import {
  goldfrankProductionLanguagePattern,
  sanitizeGoldfrankGuideMarkdown,
} from "./lib/goldfrank-guide-markdown.mjs";
import { parseGuideMarkdown } from "./lib/study-guide-reading-modes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = [path.resolve(projectRoot, ".."), path.resolve(projectRoot, "..", "..")]
  .find((candidate) => existsSync(path.join(candidate, "outputs", "02_learning_guides")))
  ?? path.resolve(projectRoot, "..");
const outputRoot = path.join(workspaceRoot, "outputs", "02_learning_guides");
const corpora = [
  {
    id: "tintinalli-detailed",
    directory: path.join(outputRoot, "tintinalli-detailed"),
    filenamePattern: /^tintinalli-CH\d{3}-detailed-full\.md$/u,
    expected: 303,
  },
  {
    id: "tintinalli-concise",
    directory: path.join(outputRoot, "tintinalli-concise"),
    filenamePattern: /^tintinalli-CH\d{3}-concise-full\.md$/u,
    expected: 303,
  },
  {
    id: "rosens",
    directory: path.join(outputRoot, "rosens"),
    filenamePattern: /^rosens-CH\d{3}-full\.md$/u,
    expected: 208,
  },
  {
    id: "goldfrank",
    directory: path.join(outputRoot, "goldfrank"),
    filenamePattern: /^goldfrank-CH\d{3}-full\.md$/u,
    expected: 140,
    sanitize: sanitizeGoldfrankGuideMarkdown,
  },
];

const suspiciousOpeningPattern = /(?:資料來源|來源(?:定位|範圍|與(?:完整性|視覺|審閱)|限制|品質)|原始\s*PDF|提供的\s*PDF|上傳\s*PDF|print\s+p|PDF\s+pages?|逐頁|視覺審閱|審閱範圍|版本(?:提醒|警示|提示|定位|界線|警語|注意|註記|安全|與)|出版年代|source-era|臨床更新重點|臨床時效|時效(?:提醒|警示)|疑似[^。]{0,40}(?:已在|標示)|完整(?:性檢查|審閱範圍)|章節(?:識別|定位|可見性))/iu;

function openingThroughFirstMajorSection(markdown) {
  const { nodes } = parseGuideMarkdown(markdown);
  const opening = [];
  let majorHeadings = 0;
  let nodesAfterFirstMajorHeading = 0;
  let firstMajorHeading = "";
  for (const item of nodes) {
    if (item.heading?.depth === 2) {
      majorHeadings += 1;
      if (!firstMajorHeading) firstMajorHeading = item.heading.label;
      if (majorHeadings > 1) break;
    }
    if (majorHeadings === 1 && item.heading?.depth >= 3) break;
    if (majorHeadings === 1 && item.heading?.depth !== 2) {
      nodesAfterFirstMajorHeading += 1;
      if (nodesAfterFirstMajorHeading > 8) break;
    }
    opening.push(item.raw);
  }
  return { firstMajorHeading, markdown: opening.join("\n\n") };
}

const suspicious = [];
const invalidFirstMajorHeadings = [];
const counts = {};

for (const corpus of corpora) {
  const files = (await readdir(corpus.directory))
    .filter((file) => corpus.filenamePattern.test(file))
    .sort();
  if (files.length !== corpus.expected) {
    throw new Error(`${corpus.id} expected ${corpus.expected} guides, found ${files.length}`);
  }
  counts[corpus.id] = files.length;

  for (const file of files) {
    const raw = await readFile(path.join(corpus.directory, file), "utf8");
    const learner = corpus.sanitize ? corpus.sanitize(raw) : sanitizeStudyGuideMarkdown(raw);
    const opening = openingThroughFirstMajorSection(learner);
    if (!/^1\.\s+\S/u.test(opening.firstMajorHeading)) {
      invalidFirstMajorHeadings.push({ corpus: corpus.id, file, heading: opening.firstMajorHeading });
    }
    if (corpus.id !== "goldfrank" && suspiciousOpeningPattern.test(opening.markdown)) {
      suspicious.push({
        corpus: corpus.id,
        file,
        heading: opening.firstMajorHeading,
        excerpt: opening.markdown.replace(/\s+/gu, " ").trim().slice(0, 500),
      });
    }
    if (corpus.id === "goldfrank" && goldfrankProductionLanguagePattern.test(learner)) {
      suspicious.push({
        corpus: corpus.id,
        file,
        heading: opening.firstMajorHeading,
        excerpt: "Goldfrank learner guide still contains source-file or production-review language.",
      });
    }
  }
}

const report = {
  reviewed: Object.values(counts).reduce((sum, count) => sum + count, 0),
  counts,
  suspicious,
  invalidFirstMajorHeadings,
};
console.log(JSON.stringify(report, null, 2));

if (suspicious.length || invalidFirstMajorHeadings.length) process.exitCode = 1;
