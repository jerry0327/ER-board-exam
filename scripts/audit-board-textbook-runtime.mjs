import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { logicalContentEntries } from "./lib/static-content-codec.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = path.join(projectRoot, "public");
const boardRoot = path.join(publicRoot, "guides", "board");
const unitRoot = path.join(boardRoot, "units");
const routeRoot = path.join(publicRoot, "data", "board-trace", "routes");
const markerPattern = /^\s*<!--board-trace:([^:>]+):(\d+):(\d+)-->\s*$/u;
const canonicalQuestionPattern = /^ROC\d{3}-[QP]\d{3}$/u;
const canonicalAtomPattern = /^(ROC\d{3}-[QP]\d{3})(?:-OPT-([A-E]))?$/u;
const siteQuestionPattern = /^\d{3}[AB]?-Q\d{3}$/u;
let packedContent = null;

function logicalPath(target) {
  return path.relative(publicRoot, target).split(path.sep).join("/");
}

function readBytes(target) {
  if (fs.existsSync(target)) return fs.readFileSync(target);
  if (!packedContent) packedContent = new Map(logicalContentEntries(publicRoot));
  const bytes = packedContent.get(logicalPath(target));
  assert.ok(bytes, `找不到 runtime 內容：${logicalPath(target)}`);
  return bytes;
}

function readJson(target) {
  return JSON.parse(readBytes(target).toString("utf8"));
}

function jsonFilenames(directory) {
  const raw = fs.existsSync(directory) ? fs.readdirSync(directory).filter((filename) => filename.endsWith(".json")).sort() : [];
  if (raw.length) return raw;
  if (!packedContent) packedContent = new Map(logicalContentEntries(publicRoot));
  const prefix = `${logicalPath(directory)}/`;
  return [...packedContent.keys()]
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json") && !entry.slice(prefix.length).includes("/"))
    .map((entry) => entry.slice(prefix.length))
    .sort();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function visibleText(node) {
  if (!node || typeof node !== "object") return "";
  if (["text", "inlineCode", "code", "yaml", "toml"].includes(node.type)) return node.value ?? "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (node.type === "break") return " ";
  if (node.type === "html") return String(node.value ?? "").replace(/<[^>]+>/gu, " ");
  const children = Array.isArray(node.children) ? node.children : [];
  if (["list", "listItem", "blockquote", "table", "tableRow", "root"].includes(node.type)) {
    return children.map(visibleText).filter(Boolean).join(" ");
  }
  if (node.type === "tableCell") return children.map(visibleText).join("");
  return children.map(visibleText).join("");
}

function comparableTitle(value) {
  return value
    .normalize("NFKC")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function leadingDocumentHeading(markdown) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const heading = tree.children.find((node) => node.type === "heading");
  return heading ? { depth: heading.depth, title: visibleText(heading) } : null;
}

function markedParagraphText(markdown, unitCode) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const result = new Map();
  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index];
    if (node.type !== "html") continue;
    const match = markerPattern.exec(node.value ?? "");
    if (!match) continue;
    const target = tree.children[index + 1];
    assert.ok(target, `${unitCode}/${match[1]} marker 沒有正文節點`);
    assert.ok(!result.has(match[1]), `${unitCode}/${match[1]} marker 重複`);
    result.set(match[1], {
      direct: Number(match[2]),
      related: Number(match[3]),
      text: visibleText(target),
    });
  }
  return result;
}

function atomIds(trace) {
  return [...(trace?.direct ?? []), ...(trace?.related ?? [])];
}

function assertUniqueTrace(trace, label) {
  assert.ok(Array.isArray(trace.direct) && Array.isArray(trace.related), `${label} trace 格式錯誤`);
  assert.equal(new Set(trace.direct).size, trace.direct.length, `${label} direct atom 重複`);
  assert.equal(new Set(trace.related).size, trace.related.length, `${label} related atom 重複`);
  const direct = new Set(trace.direct);
  assert.equal(trace.related.some((atomId) => direct.has(atomId)), false, `${label} direct/related atom 重疊`);
}

const manifest = readJson(path.join(boardRoot, "manifest.json"));
const siteIndex = readJson(path.join(publicRoot, "data", "index.json"));
const expectedQuestionIds = new Set(siteIndex.questions.map((question) => question.id));

assert.equal(manifest.schemaVersion, 1, "題庫教科書 manifest schema 不符");
assert.equal(manifest.traceVersion, "R2-GLOBAL-FINAL-v2.43", "題庫教科書追溯版本不符");
assert.equal(manifest.unitCount, 39, "題庫教科書單元數不符");
assert.equal(manifest.questionCount, 2_920, "canonical 題數不符");
assert.equal(manifest.siteQuestionCount, 3_320, "站內題數不符");
assert.equal(manifest.optionCount, 13_199, "canonical 選項數不符");
assert.equal(manifest.canonicalAtomCount, 16_119, "canonical atom 數不符");
assert.equal(manifest.siteExpandedOptionCount, 14_799, "站內展開選項數不符");
assert.equal(manifest.siteExpandedAtomCount, 18_119, "站內展開 atom 數不符");
assert.equal(manifest.paragraphCount, 2_847, "段落數不符");
assert.equal(manifest.sentenceCount, 12_252, "句子數不符");
assert.ok(Number.isSafeInteger(manifest.traceableSentenceCount) && manifest.traceableSentenceCount > 0 && manifest.traceableSentenceCount <= manifest.sentenceCount, "可追溯句子數不符");
assert.equal(manifest.traceableParagraphCount, 2_588, "可追溯段落數不符");
assert.equal(manifest.units.length, manifest.unitCount, "manifest units 數量不符");
assert.equal(new Set(manifest.units.map((unit) => unit.unitCode)).size, manifest.unitCount, "單元代碼重複");

const unitData = new Map();
const referencedCanonicalQuestions = new Set();
let paragraphCount = 0;
let sentenceCount = 0;
let markedParagraphCount = 0;
let matchingDocumentTitleCount = 0;
let markdownBytes = 0;
let traceBytes = 0;

for (const unit of manifest.units) {
  assert.match(unit.unitCode, /^\d{1,2}[A-Z]\d?$/u, `單元代碼無效：${unit.unitCode}`);
  const markdownPath = path.join(publicRoot, unit.markdownPath.replace(/^\//u, ""));
  const tracePath = path.join(publicRoot, unit.tracePath.replace(/^\//u, ""));
  assert.equal(markdownPath, path.join(unitRoot, `${unit.unitCode}.md`), `${unit.unitCode} Markdown 路徑不符`);
  assert.equal(tracePath, path.join(unitRoot, `${unit.unitCode}.json`), `${unit.unitCode} trace 路徑不符`);
  const markdownBytesValue = readBytes(markdownPath);
  const markdown = markdownBytesValue.toString("utf8");
  const trace = readJson(tracePath);
  markdownBytes += markdownBytesValue.length;
  traceBytes += readBytes(tracePath).length;
  assert.equal(digest(markdownBytesValue), unit.contentHash, `${unit.unitCode} 正文摘要不符`);
  assert.equal(trace.schemaVersion, manifest.schemaVersion, `${unit.unitCode} schema 不符`);
  assert.equal(trace.traceVersion, manifest.traceVersion, `${unit.unitCode} trace 版本不符`);
  assert.equal(trace.unitCode, unit.unitCode, `${unit.unitCode} trace 單元代碼不符`);
  const leadingHeading = leadingDocumentHeading(markdown);
  assert.ok(leadingHeading, `${unit.unitCode} 缺少文件標題`);
  assert.ok([1, 2, 3, 4].includes(leadingHeading.depth), `${unit.unitCode} 文件標題層級不符`);
  assert.equal(comparableTitle(leadingHeading.title), comparableTitle(unit.title), `${unit.unitCode} 文件標題與單元標題不符`);
  matchingDocumentTitleCount += 1;

  for (const [canonicalQuestionId, aliasesValue] of Object.entries(trace.questionRefs)) {
    assert.match(canonicalQuestionId, canonicalQuestionPattern, `${unit.unitCode} canonical question ID 無效`);
    const aliases = typeof aliasesValue === "string" ? [aliasesValue] : aliasesValue;
    assert.ok(Array.isArray(aliases) && aliases.length > 0, `${unit.unitCode}/${canonicalQuestionId} aliases 為空`);
    assert.equal(new Set(aliases).size, aliases.length, `${unit.unitCode}/${canonicalQuestionId} alias 重複`);
    for (const alias of aliases) {
      assert.match(alias, siteQuestionPattern, `${unit.unitCode}/${canonicalQuestionId} 站內題號無效`);
      assert.ok(expectedQuestionIds.has(alias), `${unit.unitCode}/${canonicalQuestionId} 指向未知站內題號 ${alias}`);
    }
    referencedCanonicalQuestions.add(canonicalQuestionId);
  }

  const marked = markedParagraphText(markdown, unit.unitCode);
  const paragraphEntries = Object.entries(trace.paragraphs);
  assert.equal(paragraphEntries.length, unit.paragraphCount, `${unit.unitCode} paragraphCount 不符`);
  paragraphCount += paragraphEntries.length;
  for (const [paragraphId, paragraphTrace] of paragraphEntries) {
    assertUniqueTrace(paragraphTrace, `${unit.unitCode}/${paragraphId}`);
    for (const atomId of atomIds(paragraphTrace)) {
      const atom = canonicalAtomPattern.exec(atomId);
      assert.ok(atom, `${unit.unitCode}/${paragraphId} canonical atom 無效：${atomId}`);
      assert.ok(Object.hasOwn(trace.questionRefs, atom[1]), `${unit.unitCode}/${paragraphId} 缺少 ${atom[1]} questionRef`);
    }
    const marker = marked.get(paragraphId);
    if (atomIds(paragraphTrace).length) {
      assert.ok(marker, `${unit.unitCode}/${paragraphId} 有映射但缺少正文 marker`);
      assert.equal(marker.direct, paragraphTrace.direct.length, `${unit.unitCode}/${paragraphId} marker direct 計數不符`);
      assert.equal(marker.related, paragraphTrace.related.length, `${unit.unitCode}/${paragraphId} marker related 計數不符`);
      markedParagraphCount += 1;
    } else {
      assert.equal(marker, undefined, `${unit.unitCode}/${paragraphId} 空映射不應產生 marker`);
    }
  }
  assert.equal(marked.size, paragraphEntries.filter(([, value]) => atomIds(value).length).length, `${unit.unitCode} marker 數不符`);

  const sentenceEntries = Object.entries(trace.sentences);
  sentenceCount += sentenceEntries.length;
  for (const [sentenceId, sentence] of sentenceEntries) {
    const parentTrace = trace.paragraphs[sentence.paragraphId];
    const parent = marked.get(sentence.paragraphId);
    assert.ok(parentTrace, `${unit.unitCode}/${sentenceId} 指向未知段落 ${sentence.paragraphId}`);
    assert.ok(parent, `${unit.unitCode}/${sentenceId} 的父段落沒有可定位 marker`);
    assert.ok(typeof sentence.exact === "string" && sentence.exact.length > 0, `${unit.unitCode}/${sentenceId} selector exact 為空`);
    assert.ok(parent.text.includes(sentence.exact), `${unit.unitCode}/${sentenceId} selector 無法在實際 Markdown 段落中定位`);
    assertUniqueTrace(sentence, `${unit.unitCode}/${sentenceId}`);
    assert.ok(atomIds(sentence).length > 0, `${unit.unitCode}/${sentenceId} 不應部署沒有題目映射的 selector`);
    const parentAtoms = new Set(atomIds(parentTrace));
    for (const atomId of atomIds(sentence)) {
      assert.ok(parentAtoms.has(atomId), `${unit.unitCode}/${sentenceId} atom 未回捲至父段落：${atomId}`);
    }
  }
  unitData.set(unit.unitCode, trace);
}

assert.equal(paragraphCount, manifest.paragraphCount, "全書 paragraph 數不符");
assert.equal(sentenceCount, manifest.traceableSentenceCount, "全書可追溯 sentence 數不符");
assert.equal(markedParagraphCount, manifest.traceableParagraphCount, "全書可追溯 paragraph 數不符");

const routeFiles = jsonFilenames(routeRoot);
assert.equal(routeFiles.length, 24, "題目 route shard 數不符");
const routedSiteQuestions = new Set();
const canonicalRoutes = new Map();
let forwardLocationCount = 0;

for (const filename of routeFiles) {
  const shard = readJson(path.join(routeRoot, filename));
  assert.equal(filename, `${shard.exam}.json`, `${filename} exam 欄位不符`);
  assert.equal(shard.schemaVersion, manifest.schemaVersion, `${shard.exam} schema 不符`);
  assert.equal(shard.traceVersion, manifest.traceVersion, `${shard.exam} trace 版本不符`);
  for (const [siteQuestionId, canonicalQuestionId] of Object.entries(shard.questionRoutes)) {
    assert.ok(expectedQuestionIds.has(siteQuestionId), `${shard.exam} route 指向未知站內題號 ${siteQuestionId}`);
    assert.ok(!routedSiteQuestions.has(siteQuestionId), `站內題號 route 重複：${siteQuestionId}`);
    assert.ok(Object.hasOwn(shard.routes, canonicalQuestionId), `${siteQuestionId} 缺少 canonical route ${canonicalQuestionId}`);
    routedSiteQuestions.add(siteQuestionId);
  }
  for (const [canonicalQuestionId, route] of Object.entries(shard.routes)) {
    assert.equal(route.canonicalQuestionId, canonicalQuestionId, `${shard.exam}/${canonicalQuestionId} canonical ID 不符`);
    assert.ok(Array.isArray(route.aliases) && route.aliases.includes(route.questionId), `${canonicalQuestionId} aliases 缺少代表題號`);
    const previous = canonicalRoutes.get(canonicalQuestionId);
    if (previous) assert.deepEqual(route, previous, `${canonicalQuestionId} 在不同分卷的 route 不一致`);
    else canonicalRoutes.set(canonicalQuestionId, route);

    const traceGroups = [[canonicalQuestionId, route.stem]];
    for (const [optionKey, locations] of Object.entries(route.options)) {
      assert.match(optionKey, /^[A-E]$/u, `${canonicalQuestionId} 選項代碼無效`);
      traceGroups.push([`${canonicalQuestionId}-OPT-${optionKey}`, locations]);
    }
    for (const [atomId, locations] of traceGroups) {
      assert.ok(Array.isArray(locations) && locations.length > 0, `${atomId} 沒有 forward location`);
      assert.equal(locations.filter((location) => location.relation === "primary").length, 1, `${atomId} primary location 數不符`);
      for (const location of locations) {
        const trace = unitData.get(location.unitCode);
        assert.ok(trace, `${atomId} 指向未知單元 ${location.unitCode}`);
        const paragraphTrace = trace.paragraphs[location.paragraphId];
        assert.ok(paragraphTrace, `${atomId} 指向未知段落 ${location.unitCode}/${location.paragraphId}`);
        assert.ok(atomIds(paragraphTrace).includes(atomId), `${atomId} forward/reverse 映射不對稱：${location.unitCode}/${location.paragraphId}`);
        if (location.nodeId !== location.paragraphId) {
          const sentence = trace.sentences[location.nodeId];
          assert.ok(sentence, `${atomId} 指向未知句子 ${location.unitCode}/${location.nodeId}`);
          assert.equal(sentence.paragraphId, location.paragraphId, `${atomId} 句子父段落不符`);
        }
        forwardLocationCount += 1;
      }
    }
  }
}

assert.deepEqual(routedSiteQuestions, expectedQuestionIds, "仍有站內題目缺少 forward route");
assert.equal(canonicalRoutes.size, manifest.questionCount, "canonical route 題數不符");
assert.equal(referencedCanonicalQuestions.size, manifest.questionCount, "reverse index 未覆蓋所有 canonical 題目");
for (const canonicalQuestionId of referencedCanonicalQuestions) {
  assert.ok(canonicalRoutes.has(canonicalQuestionId), `reverse index 缺少可回跳 route：${canonicalQuestionId}`);
}

console.log(JSON.stringify({
  traceVersion: manifest.traceVersion,
  units: manifest.unitCount,
  matchingDocumentTitles: matchingDocumentTitleCount,
  siteQuestions: routedSiteQuestions.size,
  canonicalQuestions: canonicalRoutes.size,
  canonicalAtoms: manifest.canonicalAtomCount,
  forwardLocations: forwardLocationCount,
  paragraphs: paragraphCount,
  traceableParagraphs: markedParagraphCount,
  sourceSentences: manifest.sentenceCount,
  traceableSentences: sentenceCount,
  markdownBytes,
  traceBytes,
}, null, 2));
