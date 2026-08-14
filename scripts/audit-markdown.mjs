import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { normalizeMarkdown } from "../app/lib/normalize-markdown.ts";
import { parseDecisionTree } from "../app/lib/decision-tree.ts";
import remarkRepairLiterals from "../app/lib/remark-repair-literals.ts";
import remarkStructuredFields from "../app/lib/remark-structured-fields.ts";
import { readTextbookLocator } from "./lib/textbook-locator-codec.mjs";

const questionDirectory = new URL("../public/data/questions/", import.meta.url);
const questionDirectoryPath = fileURLToPath(questionDirectory);
const manifestPath = new URL("../public/data/manifest.json", import.meta.url);
const indexPath = new URL("../public/data/index.json", import.meta.url);
const searchPath = new URL("../public/data/search.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const textbookLocatorData = readTextbookLocator();
const publicTagLocator = /(?:\bprint\s+(?:pp?\.?|pages?)\b|\bpages?\s*[:：]\s*\d|(?<![\p{L}\p{N}_])pp?\.\s*\d|\bpages?\s+(?:(?:approximately|approx(?:imately)?\.?|around|about|starts?\s+at|約)\s*)?(?:pp?\.?\s*)?\d)/iu;
const pureNumericLocator = /^\d{1,4}(?:\s*[-–—~～]\s*\d{1,4})?$/u;
const referenceLocatorContext = /Tintinalli|back\s+index|\bprint\s+(?:pp?\.?|pages?)|\b(?:Section\s+\d|CH\.?\s*\d|Chapter\s+\d)/iu;
const visibleReferenceLocator = /(?:\bprint\s+(?:pp?\.?|pages?)|\bpages?\s*[:：]\s*\d|(?<![\p{L}\p{N}_])pp?\.\s*\d|\bpages?\s+\d)/iu;
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRepairLiterals)
  .use(remarkBreaks)
  .use(remarkStructuredFields);

const summary = {
  questions: 0,
  literalBoldTextNodes: 0,
  mergedStructuredFields: 0,
  emptyInlineCodeNodes: 0,
  changedUrlSets: 0,
  tables: 0,
  referenceDuplicates: 0,
  referenceTitleUrlDuplicates: 0,
  quarantinedQuestions: 0,
  nestedOfficialAnswerHeadings: 0,
  numberedLevelTwoHeadings: 0,
  prefixedReferenceHeadings: 0,
  redundantOrientationHeadings: 0,
  leadingOfficialAnswerHeadings: 0,
  leadingQuestionTypeHeadings: 0,
  coreReasonHeadings: 0,
  nonIdempotentNormalizations: 0,
  decisionTrees: 0,
  unhandledDecisionTrees: 0,
  arrowFlows: 0,
  codeBlocks: 0,
  mathBlocks: 0,
  inlineMathNodes: 0,
  markdownImages: 0,
  questionImages: 0,
  longUrls: 0,
  veryWideTables: 0,
  longUnbrokenTokens: 0,
  publicTagLocators: 0,
  publicTextbookFields: 0,
  visibleReferencePageLocators: 0,
};

const extremes = {};

function noteExtreme(name, value, questionId, detail = {}) {
  if (!extremes[name] || value > extremes[name].value) {
    extremes[name] = { value, questionId, ...detail };
  }
}

const nodeText = (node) => node?.type === "text"
  ? node.value ?? ""
  : node?.type === "break" ? "\n"
  : (node?.children ?? []).map(nodeText).join("");

function inspectTree(node, questionId, context = { insideLink: false, listDepth: 0 }) {
  if (node.type === "text" && node.value?.includes("**")) summary.literalBoldTextNodes += 1;
  if ((node.type === "text" || node.type === "inlineCode") && !context.insideLink) {
    for (const token of (node.value ?? "").split(/\s+/u)) {
      if (token.length <= 240) continue;
      summary.longUnbrokenTokens += 1;
      noteExtreme("unbrokenToken", token.length, questionId, { sample: token.slice(0, 160) });
      console.error(`超長無斷點文字：${questionId}`);
    }
  }
  if (node.type === "inlineCode" && !node.value?.trim()) summary.emptyInlineCodeNodes += 1;
  if (node.type === "table") {
    summary.tables += 1;
    const columns = node.children?.[0]?.children?.length ?? 0;
    const rows = node.children?.length ?? 0;
    if (columns >= 7) summary.veryWideTables += 1;
    noteExtreme("tableColumns", columns, questionId, { rows });
    noteExtreme("tableRows", rows, questionId, { columns });
    for (const row of node.children ?? []) {
      for (const cell of row.children ?? []) {
        const content = nodeText(cell);
        noteExtreme("tableCellCharacters", content.length, questionId, { sample: content.slice(0, 160) });
      }
    }
  }
  if (node.type === "code") {
    summary.codeBlocks += 1;
    const longestLine = Math.max(0, ...(node.value ?? "").split("\n").map((line) => line.length));
    noteExtreme("codeLineCharacters", longestLine, questionId);
  }
  if (node.type === "math") {
    summary.mathBlocks += 1;
    noteExtreme("mathCharacters", node.value?.length ?? 0, questionId);
  }
  if (node.type === "inlineMath") {
    summary.inlineMathNodes += 1;
    noteExtreme("inlineMathCharacters", node.value?.length ?? 0, questionId);
  }
  if (node.type === "image") summary.markdownImages += 1;
  if (node.type === "link") {
    const length = node.url?.length ?? 0;
    if (length > 240) summary.longUrls += 1;
    noteExtreme("urlCharacters", length, questionId, { host: (() => { try { return new URL(node.url).hostname; } catch { return ""; } })() });
  }
  if (node.type === "list") noteExtreme("listDepth", context.listDepth + 1, questionId);
  if (node.type === "paragraph") {
    const content = nodeText(node);
    const branchCount = content.match(/[├└]─/gu)?.length ?? 0;
    if (branchCount >= 2) {
      const decisionTree = parseDecisionTree(content);
      if (decisionTree) {
        summary.decisionTrees += 1;
        noteExtreme("decisionTreeRows", decisionTree.length, questionId);
      }
      else {
        summary.unhandledDecisionTrees += 1;
        console.error(`無法解析的決策樹：${questionId}`);
      }
    } else if (/\n\s*[↓⇩]\s*\n/u.test(content)) {
      summary.arrowFlows += 1;
      noteExtreme("verticalFlowArrows", content.match(/[↓⇩]/gu)?.length ?? 0, questionId);
    }
    for (let index = 1; index < (node.children?.length ?? 0); index += 1) {
      const child = node.children[index];
      const label = nodeText(child).trim();
      if (child.type === "strong" && label.length <= 32 && /[：:]$/u.test(label) && node.children[index - 1].type !== "break") {
        summary.mergedStructuredFields += 1;
        console.error(`欄位未分行：${questionId} ${label}`);
      }
    }
  }
  const childContext = {
    insideLink: context.insideLink || node.type === "link",
    listDepth: context.listDepth + (node.type === "list" ? 1 : 0),
  };
  for (const child of node.children ?? []) inspectTree(child, questionId, childContext);
}

function inspectReferenceDuplicates(markdown) {
  const lines = markdown.split("\n");
  const referenceIndex = lines.findIndex((line) => /^#{1,6}\s+(?:\d+[.)、．]?\s*)?(?:(?:ref(?:erences?)?[\s:：/–—-]*)?(?:參考資料|參考文獻)|(?:textbook\s+)?references?)\s*$/iu.test(line));
  if (referenceIndex < 0) return;
  const seen = new Set();
  const linkedTitles = new Set();
  const titleOnly = [];
  const titleKey = (line, beforeUrl = false) => {
    const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/iu.exec(line);
    const genericLabel = markdownLink && /^(?:link|source|url|連結|全文)$/iu.test(markdownLink[1].trim());
    const source = beforeUrl
      ? markdownLink?.index !== undefined
        ? `${line.slice(0, markdownLink.index)} ${genericLabel ? "" : markdownLink[1]}`
        : line.slice(0, line.search(/https?:\/\//u))
      : line;
    const tokens = source
      .replace(/^\s*[-+*]\s+/, "")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu, (_match, label) => /^(?:link|source|url|連結|全文)$/iu.test(label.trim()) ? "" : label)
      .replace(/https?:\/\/[^\s]+/gu, "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
    const unique = [...new Set(tokens)].sort();
    return unique.join("").length >= 12 ? unique.join("\u001f") : "";
  };
  for (const line of lines.slice(referenceIndex + 1)) {
    if (/^#{1,2}\s+/.test(line)) break;
    if (!/^\s*[-+*]\s+\S/u.test(line)) continue;
    if (seen.has(line)) summary.referenceDuplicates += 1;
    seen.add(line);
    const urls = line.match(/https?:\/\/[^\s]+/gu) ?? [];
    if (urls.length === 1) {
      const key = titleKey(line, true);
      if (key) linkedTitles.add(key);
    } else if (!urls.length) {
      const key = titleKey(line);
      if (key) titleOnly.push(key);
    }
  }
  summary.referenceTitleUrlDuplicates += titleOnly.filter((key) => linkedTitles.has(key)).length;
}

function inspectVisibleReferenceLocators(markdown, questionId) {
  const lines = markdown.split("\n");
  const referenceIndex = lines.findIndex((line) => /^#{1,6}\s+(?:參考資料|參考文獻|references?)\s*$/iu.test(line));
  if (referenceIndex < 0) return;
  for (const line of lines.slice(referenceIndex + 1)) {
    if (/^#{1,2}\s+/u.test(line)) break;
    if (referenceLocatorContext.test(line) && visibleReferenceLocator.test(line)) {
      summary.visibleReferencePageLocators += 1;
      console.error(`參考資料仍顯示教科書頁碼：${questionId} ${line}`);
    }
  }
}

for (const group of manifest.groups) {
  const directory = path.join(questionDirectoryPath, group.id);
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
  for (const file of files) {
    const question = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    summary.questions += 1;
    summary.publicTextbookFields += ["textbookLocators", "textbookReferences", "bookId", "pageStart", "pageEnd"]
      .filter((key) => Object.hasOwn(question, key)).length;
    for (const tag of question.tags ?? []) {
      if (publicTagLocator.test(tag) || pureNumericLocator.test(tag)) {
        summary.publicTagLocators += 1;
        console.error(`公開標籤仍含頁碼：${question.id} ${tag}`);
      }
    }
    summary.questionImages += question.images?.length ?? 0;
    noteExtreme("questionImages", question.images?.length ?? 0, question.id);
    if (question.qualityStatus === "source-mismatch" || question.excludedFromPractice) summary.quarantinedQuestions += 1;
    const normalized = normalizeMarkdown(question.explanation);
    const headingLines = normalized.split("\n").filter((line) => /^#{2,4}\s+/.test(line));
    summary.nestedOfficialAnswerHeadings += headingLines.filter((line) => /^###\s+官方答案\s*$/u.test(line)).length;
    summary.numberedLevelTwoHeadings += headingLines.filter((line) => /^##\s+\d+[.)、．]\s+/u.test(line)).length;
    summary.prefixedReferenceHeadings += headingLines.filter((line) => /^##\s+(?:ref(?:erences?)?|textbook\s+references?)\b/iu.test(line)).length;
    summary.redundantOrientationHeadings += headingLines.filter((line) => /^##\s+解題定位\s*$/u.test(line)).length;
    summary.leadingOfficialAnswerHeadings += headingLines.filter((line) => /^##\s+官方答案\s*$/u.test(line)).length;
    summary.leadingQuestionTypeHeadings += headingLines.filter((line) => /^###\s+題型\s*$/u.test(line)).length;
    summary.coreReasonHeadings += headingLines.filter((line) => /^##\s+核心理由\s*$/u.test(line)).length;
    if (normalizeMarkdown(normalized) !== normalized) summary.nonIdempotentNormalizations += 1;
    const beforeUrls = [...new Set(question.explanation.match(/https?:\/\/[^\s]+/g) ?? [])].sort();
    const afterUrls = [...new Set(normalized.match(/https?:\/\/[^\s]+/g) ?? [])].sort();
    if (JSON.stringify(beforeUrls) !== JSON.stringify(afterUrls)) summary.changedUrlSets += 1;
    inspectReferenceDuplicates(normalized);
    inspectVisibleReferenceLocators(normalized, question.id);
    inspectTree(processor.runSync(processor.parse(normalized)), question.id);
  }
}

assert.equal(summary.questions, 3320, "題庫題數不符");
assert.equal(manifest.totalQuestions, 3320, "Manifest 題數不符");
assert.equal(manifest.totalExplanations, 3320, "仍有題目缺少完整詳解");
assert.equal(manifest.validation?.quarantined ?? 0, 0, "仍有題目被隔離");
assert.equal(summary.quarantinedQuestions, 0, "題目資料中仍有隔離旗標");
assert.equal(summary.literalBoldTextNodes, 0, "仍有顯示為文字的 ** 粗體標記");
assert.equal(summary.mergedStructuredFields, 0, "仍有未分行的詳解欄位");
assert.equal(summary.emptyInlineCodeNodes, 0, "仍有空白行內程式碼標記");
assert.equal(summary.changedUrlSets, 0, "Markdown 正規化改變了來源網址集合");
assert.equal(summary.referenceDuplicates, 0, "Reference 仍有完全重複列");
assert.equal(summary.referenceTitleUrlDuplicates, 0, "Reference 仍有純標題與同標題連結重複列");
assert.equal(summary.nestedOfficialAnswerHeadings, 0, "詳解仍有重複的官方答案次標題");
assert.equal(summary.numberedLevelTwoHeadings, 0, "詳解大章節仍帶有來源編號");
assert.equal(summary.prefixedReferenceHeadings, 0, "參考資料標題仍有多餘 REF／References 前綴");
assert.equal(summary.redundantOrientationHeadings, 0, "詳解仍有多餘的解題定位包裝標題");
assert.equal(summary.leadingOfficialAnswerHeadings, 0, "詳解仍有重複的官方答案大標題");
assert.equal(summary.leadingQuestionTypeHeadings, 0, "詳解開頭仍有與題卡重複的題型區塊");
assert.equal(summary.coreReasonHeadings, 3320, "每題詳解應恰好保留一個核心理由主區塊");
assert.equal(summary.nonIdempotentNormalizations, 0, "Markdown 正規化不是冪等操作");
assert.equal(summary.unhandledDecisionTrees, 0, "仍有無法由共用元件呈現的決策樹");
assert.equal(summary.longUnbrokenTokens, 0, "仍有可能撐破版面的超長無斷點文字");
assert.equal(summary.publicTagLocators, 0, "公開標籤仍含教科書頁碼定位");
assert.equal(summary.publicTextbookFields, 0, "結構化教科書頁碼誤入單題公開 JSON");
assert.equal(summary.visibleReferencePageLocators, 0, "完整詳解仍顯示教科書頁碼");
assert.equal(textbookLocatorData.schemaVersion, 1, "教科書頁碼 schema 版本不符");
assert.equal(textbookLocatorData.sourceHash, manifest.sourceHash, "教科書頁碼與公開題庫來源版本不同步");
assert.deepEqual(textbookLocatorData.validation, {
  questionsWithLocators: 2278,
  questionsWithoutLocators: 1042,
  explicitEditionQuestions: 1970,
  inferredEditionQuestions: 308,
  approximateOrOpenEndedQuestions: 14,
  wideRangeQuestions: 65,
  minimumPage: 1,
  maximumPage: 2114,
}, "教科書頁碼稽核統計不符");
assert.doesNotMatch(
  fs.readFileSync(indexPath, "utf8"),
  /"(?:bookId|pageStart|pageEnd|textbookLocators|textbookReferences)"/u,
  "教科書頁碼誤入公開 index",
);
assert.doesNotMatch(
  fs.readFileSync(searchPath, "utf8"),
  /"(?:bookId|pageStart|pageEnd|textbookLocators|textbookReferences)"/u,
  "教科書頁碼誤入公開 search",
);

console.log(JSON.stringify({ ...summary, extremes }, null, 2));
