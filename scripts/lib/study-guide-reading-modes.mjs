import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const productionMetadataPattern = /^(?:來源與視覺審閱|來源定位|視覺審閱確認|完整性檢查|審閱範圍|章節識別|來源與審閱|臨床時效警示)/u;
const productionMetadataHeadingPattern = /^(?:(?:第\s*\d+\s*章|本章|原章)?(?:來源|圖表|表格|視覺|頁界)[^\n]*(?:紀錄|核對|稽核|檢視限制|適用限制)|(?:來源、頁界與視覺審閱|來源與視覺內容稽核|視覺內容核對紀錄|表格與視覺內容核對))$/u;
const highYieldPattern = /核心|重點|考點|陷阱|濃縮|摘要|底線|急診決策|處置|流程|演算法|禁忌|紅旗|警示|注意|disposition|board\s+trap|pearl|pitfall|bottom\s+line|warning|caution/iu;
const cautionPattern = /陷阱|禁忌|紅旗|警示|注意|不可|不要|避免|危險|disposition|board\s+trap|pitfall|warning|caution|do\s+not|avoid/iu;

function stripStructuralOutlinePrefix(value) {
  return value.replace(/^\d+(?:\.\d+){0,3}\.?\s+/u, "");
}

function normalizeLineEndings(markdown) {
  return `${markdown.replace(/\r\n?/gu, "\n").trimEnd()}\n`;
}

/**
 * Some source exports use a line containing only `[` / `]` around display
 * equations. Those characters are not recognized as math delimiters by
 * remark-math, so the learner would see literal brackets instead of a
 * rendered formula. Convert only balanced, standalone pairs outside fenced
 * code blocks and leave inline square brackets untouched.
 */
export function normalizeStandaloneMathDelimiters(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence || !/^\s*\[\s*$/u.test(lines[index])) continue;

    let closingIndex = index + 1;
    while (closingIndex < lines.length && closingIndex - index <= 24 && !/^\s*\]\s*$/u.test(lines[closingIndex])) {
      // Another opener, a heading, or a code fence means this is not a compact
      // source-exported equation block. Blank lines inside aligned equations
      // are valid and intentionally retained.
      if (/^\s*\[\s*$/u.test(lines[closingIndex]) || /^\s*(?:#{1,6}\s|`{3,}|~{3,})/u.test(lines[closingIndex])) break;
      closingIndex += 1;
    }
    if (closingIndex >= lines.length || !/^\s*\]\s*$/u.test(lines[closingIndex]) || closingIndex === index + 1) continue;

    const indent = lines[index].match(/^\s*/u)?.[0] ?? "";
    for (let contentIndex = index + 1; contentIndex < closingIndex; contentIndex += 1) {
      if (/^\s*={3,}\s*$/u.test(lines[contentIndex])) lines[contentIndex] = `${indent}=`;
      lines[contentIndex] = lines[contentIndex].replace(/(^|[^\\])%/gu, "$1\\%");
    }
    lines[index] = `${indent}$$`;
    lines[closingIndex] = `${indent}$$`;
    index = closingIndex;
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function normalizeStudyGuideSource(markdown) {
  const repaired = markdown
    .replace(/\r\n?/gu, "\n")
    // Protect currency without touching legitimate `$...$` / `$$...$$`
    // math in future packs. The current source uses US$ amounts, one bare
    // dollar amount, and $, $$, $$$ as table cost tiers.
    .replace(/US\$(?=\d)/gu, "US\\$")
    .replace(/(?<![\\\p{L}\p{N}_])\$(?=\d)/gu, "\\$")
    .replace(/(\|\s*)(\${1,3})(\s*\|)/gu, (_match, before, dollars, after) => `${before}${dollars.replace(/\$/gu, "\\$")}${after}`)
    .replace(/\\text\{PP\}\*\{(max|min)\}/gu, "\\text{PP}_{$1}")
    .replace(
      /\[\nOsmolal\\ gap\n=+\n\s*##\s*Measured\\ serum\\ osmolality\n\s*Calculated\\ osmolality\n\]/gu,
      "[\nOsmolal\\ gap = Measured\\ serum\\ osmolality - Calculated\\ osmolality\n]",
    );
  return normalizeStandaloneMathDelimiters(repaired)
    .replace(/\?utm_source=chatgpt\.com&/giu, "?")
    .replace(/\?utm_source=chatgpt\.com(?=[\s)'"<>\]]|$)/giu, "")
    .replace(/&utm_source=chatgpt\.com(?=[\s)'"<>\]]|&|$)/giu, "");
}

export function markdownNodeText(node) {
  if (!node) return "";
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code" || node.type === "math" || node.type === "inlineMath") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(markdownNodeText).join(" ").replace(/\s+/gu, " ").trim();
}

function sourceSlice(markdown, node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error(`Markdown node ${node.type} is missing source offsets`);
  return markdown.slice(start, end).trimEnd();
}

function isBoldNumberedParagraph(node) {
  if (node.type !== "paragraph" || node.children?.length !== 1 || node.children[0].type !== "strong") return null;
  const label = markdownNodeText(node).trim();
  const match = label.match(/^(\d{1,2})[.)、]\s+\S/u);
  return match ? { number: Number(match[1]), label } : null;
}

/**
 * Convert only a proven sequence of three or more bold-only, consecutively
 * numbered paragraphs into headings. A real Markdown heading closes the
 * candidate run, so ordinary bold numbered callouts elsewhere remain intact.
 */
export function normalizeImplicitHeadingSequences(markdown) {
  // Preserve source whitespace byte-for-byte unless an implicit heading is
  // actually normalized. Parsing uses normalized line endings internally,
  // while the returned full guide keeps its original terminal whitespace.
  const source = markdown.replace(/\r\n?/gu, "\n");
  const tree = parser.parse(source);
  const replacements = [];
  let precedingHeadingDepth = 2;
  let candidates = [];

  const flush = () => {
    const isSequence = candidates.length >= 3
      && candidates[0].number === 1
      && candidates.every((candidate, index) => candidate.number === index + 1);
    if (isSequence) {
      const depth = Math.min(6, precedingHeadingDepth + 1);
      for (const candidate of candidates) {
        replacements.push({
          start: candidate.node.position.start.offset,
          end: candidate.node.position.end.offset,
          value: `${"#".repeat(depth)} ${candidate.label}`,
        });
      }
    }
    candidates = [];
  };

  for (const node of tree.children) {
    if (node.type === "heading") {
      flush();
      precedingHeadingDepth = node.depth;
      continue;
    }
    const candidate = isBoldNumberedParagraph(node);
    if (candidate) candidates.push({ ...candidate, node });
  }
  flush();

  let normalized = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    normalized = `${normalized.slice(0, replacement.start)}${replacement.value}${normalized.slice(replacement.end)}`;
  }
  return normalized;
}

export function parseGuideMarkdown(markdown) {
  const source = normalizeLineEndings(markdown);
  const tree = parser.parse(source);
  const nodes = tree.children.map((node, index) => ({
    index,
    node,
    raw: sourceSlice(source, node),
    text: markdownNodeText(node),
    heading: node.type === "heading" ? { depth: node.depth, label: markdownNodeText(node).trim() } : null,
  }));
  return { source, tree, nodes };
}

export function headingCategory(label) {
  const value = label.trim();
  if (/^\d{1,3}(?:[.)、．：:]|\s*[-–—])\s*/u.test(value)) return "numeric";
  if (/^[一二三四五六七八九十百零〇兩]+[、.)．：:]\s*/u.test(value)) return "chinese-number";
  if (/^[A-Z](?:[.)、．：:]|\s*[-–—])\s*/u.test(value)) return "letter";
  if (/^Part\s+(?:[A-Z]|\d+|[IVXLCDM]+)\b/iu.test(value)) return "part";
  return null;
}

export function isProductionMetadataNode(node) {
  const text = markdownNodeText(node).trim();
  return (node.type === "blockquote" && productionMetadataPattern.test(text))
    || (node.type === "heading" && productionMetadataHeadingPattern.test(stripStructuralOutlinePrefix(text)));
}

function isContentNode(node) {
  return !["heading", "thematicBreak", "html", "definition"].includes(node.type);
}

function isSemanticSectionBoundary(sourceHeading, candidateHeading) {
  if (candidateHeading.depth < sourceHeading.depth) return true;
  if (candidateHeading.depth > sourceHeading.depth) return false;
  const sourceCategory = headingCategory(sourceHeading.label);
  if (!sourceCategory) return true;
  return headingCategory(candidateHeading.label) === sourceCategory;
}

function productionMetadataIndices(nodes) {
  const indices = new Set();
  for (let index = 0; index < nodes.length; index += 1) {
    const item = nodes[index];
    if (item.node.type === "blockquote" && isProductionMetadataNode(item.node)) {
      indices.add(index);
      continue;
    }
    if (!item.heading || !isProductionMetadataNode(item.node)) continue;
    indices.add(index);
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      if (nodes[cursor].heading && nodes[cursor].heading.depth <= item.heading.depth) break;
      indices.add(cursor);
    }
  }
  return indices;
}

function firstSectionContent(nodes, headingIndex, metadataIndices) {
  const heading = nodes[headingIndex].heading;
  for (let index = headingIndex + 1; index < nodes.length; index += 1) {
    const current = nodes[index];
    if (current.heading && isSemanticSectionBoundary(heading, current.heading)) break;
    if (metadataIndices.has(index)) continue;
    if (isContentNode(current.node)) return index;
  }
  return null;
}

function sectionContentIndices(nodes, headingIndex, metadataIndices) {
  const heading = nodes[headingIndex].heading;
  const indices = [];
  for (let index = headingIndex + 1; index < nodes.length; index += 1) {
    const current = nodes[index];
    if (current.heading && isSemanticSectionBoundary(heading, current.heading)) break;
    if (!metadataIndices.has(index) && isContentNode(current.node)) indices.push(index);
  }
  return indices;
}

export function buildFocusMarkdown(markdown) {
  const normalized = normalizeImplicitHeadingSequences(markdown);
  const { nodes } = parseGuideMarkdown(normalized);
  if (!nodes.length || !nodes[0].heading) throw new Error("Guide must begin with a Markdown heading");

  const selected = new Set([0]);
  const metadataIndices = productionMetadataIndices(nodes);

  // Retain a short source-authored opening when one exists.
  let openingBlocks = 0;
  for (let index = 1; index < nodes.length && !nodes[index].heading; index += 1) {
    if (metadataIndices.has(index) || !isContentNode(nodes[index].node)) continue;
    selected.add(index);
    openingBlocks += 1;
    if (openingBlocks === 2) break;
  }

  for (let index = 1; index < nodes.length; index += 1) {
    const item = nodes[index];
    if (!item.heading) continue;
    if (metadataIndices.has(index)) continue;
    const classified = headingCategory(item.heading.label) !== null;
    const major = item.heading.depth <= 2;
    const highYield = highYieldPattern.test(item.heading.label);
    if (!classified && !major && !highYield) continue;

    selected.add(index);
    const firstContent = firstSectionContent(nodes, index, metadataIndices);
    if (firstContent !== null) selected.add(firstContent);

    // High-yield sections get one additional whole source node when possible.
    if (highYield) {
      const contents = sectionContentIndices(nodes, index, metadataIndices);
      const extra = contents.find((contentIndex) => contentIndex !== firstContent);
      if (extra !== undefined) selected.add(extra);
    }
  }

  const extracted = nodes
    .filter((item) => selected.has(item.index) && !metadataIndices.has(item.index))
    .map((item) => item.raw);
  return `${extracted.join("\n\n")}\n`;
}

function nodeVisibleUnits(node) {
  return Array.from(markdownNodeText(node).replace(/\s+/gu, "")).length;
}

export function visibleMarkdownUnits(markdown) {
  const { tree } = parseGuideMarkdown(markdown);
  return Array.from(markdownNodeText(tree).replace(/\s+/gu, "")).length;
}

function buildChapterMap(nodes, metadataIndices) {
  const mainHeadings = nodes
    .slice(1)
    .filter((item) => item.heading?.depth <= 2 && !metadataIndices.has(item.index))
    .map((item) => item.heading.label);
  const fallback = nodes
    .slice(1)
    .filter((item) => item.heading?.depth === 3 && !metadataIndices.has(item.index))
    .map((item) => item.heading.label);
  const labels = mainHeadings.length ? mainHeadings : fallback;
  const kept = [];
  let units = 0;
  for (const label of labels) {
    const nextUnits = Array.from(label.replace(/\s+/gu, "")).length + (kept.length ? 1 : 0);
    if (kept.length >= 18 || units + nextUnits > 460) break;
    kept.push(label);
    units += nextUnits;
  }
  const remainder = labels.length - kept.length;
  return `${kept.join(" · ")}${remainder > 0 ? ` · （另有 ${remainder} 節）` : ""}`;
}

function quickCandidates(nodes, metadataIndices) {
  const candidates = [];
  for (let headingIndex = 1; headingIndex < nodes.length; headingIndex += 1) {
    const headingItem = nodes[headingIndex];
    if (!headingItem.heading) continue;
    if (metadataIndices.has(headingIndex)) continue;
    const contentIndices = sectionContentIndices(nodes, headingIndex, metadataIndices);
    if (!contentIndices.length) continue;

    const eligible = contentIndices
      .map((contentIndex) => {
        const contentItem = nodes[contentIndex];
        const units = nodeVisibleUnits(contentItem.node);
        let contentScore = 0;
        if (highYieldPattern.test(contentItem.text)) contentScore += 80;
        if (cautionPattern.test(contentItem.text)) contentScore += 90;
        if (["list", "table", "code"].includes(contentItem.node.type)) contentScore += 35;
        if (units >= 90 && units <= 560) contentScore += 35;
        if (units > 800) contentScore -= 160;
        return { contentIndex, contentItem, units, contentScore };
      })
      .filter((entry) => entry.units >= 35 && entry.units <= 900)
      .sort((left, right) => right.contentScore - left.contentScore || left.contentIndex - right.contentIndex);
    if (!eligible.length) continue;

    const best = eligible[0];
    let score = best.contentScore;
    if (highYieldPattern.test(headingItem.heading.label)) score += 150;
    if (cautionPattern.test(headingItem.heading.label)) score += 190;
    if (headingCategory(headingItem.heading.label)) score += 30;
    if (headingItem.heading.depth <= 2) score += 25;
    score += Math.max(0, 30 - headingIndex / 20);

    candidates.push({
      headingIndex,
      contentIndex: best.contentIndex,
      headingRaw: headingItem.raw,
      contentRaw: best.contentItem.raw,
      headingLabel: headingItem.heading.label,
      caution: cautionPattern.test(headingItem.heading.label) || cautionPattern.test(best.contentItem.text),
      score,
    });
  }

  // The same source content can be the first descendant of multiple ancestor
  // headings. Keep the most specific/highest-scoring context only.
  const byContent = new Map();
  for (const candidate of candidates) {
    const current = byContent.get(candidate.contentIndex);
    if (!current || candidate.score > current.score || (candidate.score === current.score && candidate.headingIndex > current.headingIndex)) {
      byContent.set(candidate.contentIndex, candidate);
    }
  }
  return [...byContent.values()];
}

function renderQuick(nodes, chapterMap, selected, cautionCandidate) {
  const pieces = [
    nodes[0].raw,
    "> **5 分鐘速讀**：先掌握本章核心概念、關鍵處置與常見考題陷阱。",
    "## 本章地圖",
    chapterMap,
    "## 高產重點",
  ];
  for (const candidate of [...selected].sort((left, right) => left.headingIndex - right.headingIndex)) {
    pieces.push(candidate.headingRaw, candidate.contentRaw);
  }
  pieces.push("## 注意事項與考題陷阱", cautionCandidate.headingRaw, cautionCandidate.contentRaw);
  return `${pieces.filter(Boolean).join("\n\n")}\n`;
}

export function buildQuickMarkdown(markdown) {
  const normalized = normalizeImplicitHeadingSequences(markdown);
  const { nodes } = parseGuideMarkdown(normalized);
  if (!nodes.length || !nodes[0].heading) throw new Error("Guide must begin with a Markdown heading");

  const metadataIndices = productionMetadataIndices(nodes);
  const chapterMap = buildChapterMap(nodes, metadataIndices);
  const candidates = quickCandidates(nodes, metadataIndices);
  if (!candidates.length) throw new Error("Guide has no eligible exact-source blocks for quick mode");

  const compactCautions = candidates
    .filter((candidate) => candidate.caution)
    .sort((left, right) => {
      const leftUnits = visibleMarkdownUnits(`${left.headingRaw}\n\n${left.contentRaw}`);
      const rightUnits = visibleMarkdownUnits(`${right.headingRaw}\n\n${right.contentRaw}`);
      const leftPenalty = leftUnits > 720 ? leftUnits - 720 : 0;
      const rightPenalty = rightUnits > 720 ? rightUnits - 720 : 0;
      return (right.score - rightPenalty) - (left.score - leftPenalty) || right.headingIndex - left.headingIndex;
    });
  const cautionCandidate = compactCautions[0] ?? candidates.sort((left, right) => right.score - left.score)[0];

  const ranked = candidates
    .filter((candidate) => candidate !== cautionCandidate)
    .sort((left, right) => right.score - left.score || left.headingIndex - right.headingIndex);
  const selected = [];
  let output = renderQuick(nodes, chapterMap, selected, cautionCandidate);

  // Prefer diverse sections before taking a second extract from the same label.
  const seenLabels = new Set([cautionCandidate.headingLabel]);
  const ordered = [
    ...ranked.filter((candidate) => !seenLabels.has(candidate.headingLabel)),
    ...ranked.filter((candidate) => seenLabels.has(candidate.headingLabel)),
  ];
  for (const candidate of ordered) {
    if (visibleMarkdownUnits(output) >= 1_400) break;
    const trial = renderQuick(nodes, chapterMap, [...selected, candidate], cautionCandidate);
    if (visibleMarkdownUnits(trial) <= 2_200) {
      selected.push(candidate);
      seenLabels.add(candidate.headingLabel);
      output = trial;
    }
  }

  // Whole-node extraction can leave a gap near the ideal ceiling. Permit a
  // final exact block up to the hard ceiling rather than truncating a node.
  if (visibleMarkdownUnits(output) < 1_400) {
    for (const candidate of ordered) {
      if (selected.includes(candidate)) continue;
      const trial = renderQuick(nodes, chapterMap, [...selected, candidate], cautionCandidate);
      if (visibleMarkdownUnits(trial) <= 2_600) {
        selected.push(candidate);
        output = trial;
        if (visibleMarkdownUnits(output) >= 1_400) break;
      }
    }
  }

  return output;
}

export function auditHeadingCategories(markdown) {
  const { nodes } = parseGuideMarkdown(markdown);
  const counts = {
    h1: 0,
    h2: 0,
    h3: 0,
    h4: 0,
    h5: 0,
    h6: 0,
    numeric: 0,
    "chinese-number": 0,
    letter: 0,
    part: 0,
  };
  for (const item of nodes) {
    if (!item.heading) continue;
    counts[`h${item.heading.depth}`] += 1;
    const category = headingCategory(item.heading.label);
    if (category) counts[category] += 1;
  }
  return counts;
}
