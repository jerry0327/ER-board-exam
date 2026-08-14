const horizontalRule = /^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/;
const optionPrefix = /^(\s*(?:[-+*]\s+)?(?:[A-Fa-f]|[1-9]\d*)[.)、]\s+)(.*)$/;
const boldLabelWithExtraMarker = /^(\s*(?:[-+*]\s+)?\*\*[^*\n]{1,64}[：:]\*\*)\s*\*\*\s*(.*)$/;
const referenceHeading = /^(#{1,6})\s+(?:\d+[.)、．]?\s*)?(?:(?:ref(?:erences?)?[\s:：/–—-]*)?(?:參考資料|參考文獻)|(?:textbook\s+)?references?)\s*$/iu;
const tintinalliReferenceContext = /Tintinalli|back\s+index/iu;
const textbookLocatorContext = /\b(?:Section\s+\d{1,2}|CH\.?\s*\d{1,3}[A-Z]?|Chapter\s+\d{1,3}[A-Z]?)\b/iu;
const printPageLocator = /\bprint\s+(?:pp?\.?|pages?)\b/iu;
const pageColonLocator = /\bpages?\s*[:：]\s*\d/iu;
const tableSeparatorCell = /^:?-{3,}:?$/;
const protectedSpanStart = 0xe000;

type ProtectedLine = {
  value: string;
  restore: (value: string) => string;
};

function backtickRunLength(value: string, start: number) {
  let end = start;
  while (value[end] === "`") end += 1;
  return end - start;
}

function findClosingBacktickRun(value: string, start: number, length: number) {
  let cursor = start;
  while (cursor < value.length) {
    const position = value.indexOf("`", cursor);
    if (position < 0) return -1;
    const candidateLength = backtickRunLength(value, position);
    if (candidateLength === length) return position;
    cursor = position + candidateLength;
  }
  return -1;
}

function maskProtectedSpans(line: string): ProtectedLine {
  const protectedValues: string[] = [];
  let value = "";
  let cursor = 0;

  const protect = (source: string) => {
    if (protectedValues.length >= 0xf8ff - protectedSpanStart) return source;
    const token = String.fromCodePoint(protectedSpanStart + protectedValues.length);
    protectedValues.push(source);
    return token;
  };

  while (cursor < line.length) {
    if (line.startsWith("https://", cursor) || line.startsWith("http://", cursor)) {
      let end = cursor;
      while (end < line.length && !/\s/u.test(line[end])) end += 1;
      value += protect(line.slice(cursor, end));
      cursor = end;
      continue;
    }

    if (line[cursor] === "`") {
      const length = backtickRunLength(line, cursor);
      const closing = findClosingBacktickRun(line, cursor + length, length);
      if (closing >= 0) {
        const end = closing + length;
        value += protect(line.slice(cursor, end));
        cursor = end;
        continue;
      }
    }

    value += line[cursor];
    cursor += 1;
  }

  return {
    value,
    restore: (masked) => masked.replace(/[\uE000-\uF8FF]/gu, (token) => {
      const index = token.codePointAt(0)! - protectedSpanStart;
      return protectedValues[index] ?? token;
    }),
  };
}

function repairUnmatchedBackticks(line: string) {
  return line.replace(/`+/g, (marker, offset: number, source: string) => {
    if (marker.length !== 1) return "";
    const previous = source.slice(offset - 1, offset);
    const following = source.slice(offset + 1, offset + 2);
    return previous && following && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(following)
      ? "'"
      : "";
  });
}

function collapseOverlongBoldMarkers(line: string) {
  if (horizontalRule.test(line)) return line;
  return line.replace(/\*{4}\s*([^*\n]*?\S)\s*\*{4}/g, "**$1**");
}

function repairOddBoldMarkers(line: string) {
  if (horizontalRule.test(line)) return line;
  const markerCount = line.match(/\*\*/g)?.length ?? 0;
  if (markerCount % 2 === 0) return line;

  // A frequent source artifact is `**判斷：** ** 文字`, where the third
  // marker is neither an opener nor a closer. Keep the label bold and remove
  // only that redundant token.
  const redundant = line.match(boldLabelWithExtraMarker);
  if (redundant) return `${redundant[1]}${redundant[2] ? ` ${redundant[2]}` : ""}`;

  const trimmed = line.trimStart();
  const prefixed = line.match(optionPrefix);
  if (markerCount === 1 && /^\*\*[^*\n]{1,64}[：:]\s*$/u.test(trimmed)) return `${line}**`;

  // Option-analysis text often lost its opening marker while retaining the
  // closing one: `A. diagnosis**。`. Restore the opener after the option key.
  if (markerCount === 1 && prefixed) {
    const marker = prefixed[2].indexOf("**");
    const following = prefixed[2].slice(marker + 2, marker + 3);
    if (!following || /[\s。；，、,.!?！？）)\]】]/u.test(following)) return `${prefixed[1]}**${prefixed[2]}`;
  }

  // Leave ambiguous unmatched markers untouched. The AST repair layer removes
  // them without inventing a large, medically misleading bold span.
  return line;
}

function separateAfterPairedDelimiter(line: string, delimiter: "**") {
  const positions: number[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    const position = line.indexOf(delimiter, cursor);
    if (position < 0) break;
    positions.push(position);
    cursor = position + delimiter.length;
  }

  const insertions = new Set<number>();
  // Treat delimiters in source order as opener/closer pairs, then edit from
  // right to left so offsets remain stable. Boundaries are needed on both
  // sides for intraword forms such as `文字是**「重點」**。`.
  for (let index = 0; index + 1 < positions.length; index += 2) {
    const opening = positions[index];
    const beforeOpening = line.slice(opening - 1, opening);
    const afterOpening = line.slice(opening + delimiter.length, opening + delimiter.length + 1);
    if (beforeOpening && /[\p{L}\p{N}]/u.test(beforeOpening) && afterOpening && !/[\p{L}\p{N}]/u.test(afterOpening)) insertions.add(opening);

    const afterClosing = positions[index + 1] + delimiter.length;
    const following = line.slice(afterClosing, afterClosing + 1);
    if (following && /[\p{L}\p{N}]/u.test(following)) insertions.add(afterClosing);
  }

  let result = line;
  for (const insertionPoint of [...insertions].sort((a, b) => b - a)) {
    result = `${result.slice(0, insertionPoint)} ${result.slice(insertionPoint)}`;
  }
  return result;
}

function separateAdjacentEmphasis(line: string) {
  // CommonMark cannot close emphasis before another letter/number. Insert a
  // word boundary for patterns such as `**本題：**無神經缺損`.
  // Double underscores are intentionally not normalized because they are
  // common inside external guideline URLs.
  return separateAfterPairedDelimiter(line, "**");
}

function normalizeInlineSyntax(line: string) {
  const protectedLine = maskProtectedSpans(line);
  const normalized = separateAdjacentEmphasis(
    repairOddBoldMarkers(
      collapseOverlongBoldMarkers(
        repairUnmatchedBackticks(protectedLine.value),
      ),
    ),
  );
  return protectedLine.restore(normalized);
}

function fencedLineMask(lines: string[]) {
  const masked = new Set<number>();
  let fenceCharacter = "";
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!fenceCharacter) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!opening) continue;
      fenceCharacter = opening[1][0];
      fenceLength = opening[1].length;
      masked.add(index);
      continue;
    }

    masked.add(index);
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (closing && closing[1][0] === fenceCharacter && closing[1].length >= fenceLength) {
      fenceCharacter = "";
      fenceLength = 0;
    }
  }

  return masked;
}

function unescapedPipePositions(line: string) {
  const positions: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "|") continue;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashCount += 1;
    if (slashCount % 2 === 0) positions.push(index);
  }
  return positions;
}

function tableCells(line: string) {
  const positions = unescapedPipePositions(line);
  if (!positions.length) return null;

  const trimmed = line.trim();
  const cells: string[] = [];
  let cursor = 0;
  for (const position of positions) {
    cells.push(line.slice(cursor, position));
    cursor = position + 1;
  }
  cells.push(line.slice(cursor));

  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|")) cells.pop();
  return cells;
}

function isTableSeparator(line: string) {
  const cells = tableCells(line);
  return Boolean(cells && cells.length >= 2 && cells.every((cell) => tableSeparatorCell.test(cell.trim())));
}

function isTableRow(line: string) {
  const cells = tableCells(line);
  return Boolean(cells && cells.length >= 2 && line.trim());
}

function neutralTableHeader(separator: string) {
  const columnCount = tableCells(separator)?.length ?? 2;
  return `| ${Array.from({ length: columnCount }, (_, index) => `欄位 ${index + 1}`).join(" | ")} |`;
}

function normalizeTableSpacing(lines: string[]) {
  const fenced = fencedLineMask(lines);
  const blankBefore = new Set<number>();
  const blankAfter = new Set<number>();
  const syntheticHeaders = new Map<number, string>();
  const emptyTables = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index) || !isTableSeparator(lines[index])) continue;

    const previous = index - 1;
    const hasHeader = previous >= 0
      && !fenced.has(previous)
      && isTableRow(lines[previous])
      && !isTableSeparator(lines[previous]);
    const headerIndex = hasHeader ? previous : index;

    let tableEnd = index;
    while (
      tableEnd + 1 < lines.length
      && !fenced.has(tableEnd + 1)
      && isTableRow(lines[tableEnd + 1])
      && !isTableSeparator(lines[tableEnd + 1])
    ) {
      tableEnd += 1;
    }
    if (!hasHeader && tableEnd === index) {
      emptyTables.add(index);
      continue;
    }
    if (headerIndex > 0 && lines[headerIndex - 1].trim()) blankBefore.add(headerIndex);
    if (!hasHeader) syntheticHeaders.set(index, neutralTableHeader(lines[index]));
    if (tableEnd + 1 < lines.length && lines[tableEnd + 1].trim()) blankAfter.add(tableEnd);
  }

  const result: string[] = [];
  const pushBlank = () => {
    if (result.length && result[result.length - 1] !== "") result.push("");
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (emptyTables.has(index)) continue;
    if (blankBefore.has(index)) pushBlank();
    const syntheticHeader = syntheticHeaders.get(index);
    if (syntheticHeader) result.push(syntheticHeader);
    result.push(lines[index]);
    if (blankAfter.has(index)) pushBlank();
  }
  return result;
}

function isLegacyLatexBlock(content: string[]) {
  const text = content.join("\n").trim();
  if (!text || /\p{Script=Han}/u.test(text)) return false;
  if (!/(?:\\[A-Za-z]+|[_^{}]|=)/u.test(text)) return false;
  return content.every((line) => !/^\s*(?:#{1,6}\s|[-+*]\s|>\s?|\|)/u.test(line));
}

function convertLegacyLatexBlocks(lines: string[]) {
  const fenced = fencedLineMask(lines);
  const result = [...lines];

  for (let index = 0; index < result.length; index += 1) {
    if (fenced.has(index) || result[index].trim() !== "[") continue;
    let closing = index + 1;
    while (closing < result.length && !fenced.has(closing) && result[closing].trim() !== "]") closing += 1;
    if (closing >= result.length || fenced.has(closing)) continue;
    const content = result.slice(index + 1, closing);
    if (!isLegacyLatexBlock(content)) continue;

    const openingIndent = result[index].match(/^\s*/)?.[0] ?? "";
    const closingIndent = result[closing].match(/^\s*/)?.[0] ?? openingIndent;
    result[index] = `${openingIndent}$$`;
    result[closing] = `${closingIndent}$$`;
    index = closing;
  }

  return result;
}

function referenceUrls(line: string) {
  return line.match(/https?:\/\/[^\s]+/g) ?? [];
}

function canonicalReferenceUrl(url: string) {
  return url.replace(/[.,;，。；]+$/u, "");
}

function referenceTextWithoutUrl(line: string) {
  return line
    .replace(/^\s*[-+*]\s+/, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu, (_match, label: string) => /^(?:link|source|url|連結|全文)$/iu.test(label.trim()) ? "" : label)
    .replace(/https?:\/\/[^\s]+/g, "")
    .trim();
}

function canonicalReferenceTitle(line: string) {
  const tokens = referenceTextWithoutUrl(line)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(tokens)].sort();
  return unique.join("").length >= 12 ? unique.join("\u001f") : "";
}

function citationTitleBeforeUrl(line: string) {
  const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/iu.exec(line);
  if (markdownLink?.index !== undefined) {
    const label = /^(?:link|source|url|連結|全文)$/iu.test(markdownLink[1].trim()) ? "" : markdownLink[1];
    return canonicalReferenceTitle(`${line.slice(0, markdownLink.index)} ${label}`);
  }
  const urlStart = line.search(/https?:\/\//u);
  return canonicalReferenceTitle(urlStart >= 0 ? line.slice(0, urlStart) : line);
}

function isExplanatoryReferenceLine(line: string) {
  return /(?:補充|說明|注意|限制|不取代|僅供|作為外部|作外部|主要是|備註|註[：:]|解讀|適用於)/u.test(line);
}

function isReferenceListLine(line: string) {
  return /^\s*[-+*]\s+\S/u.test(line);
}

function stripTextbookPageLocators(line: string) {
  const protectedLine = maskProtectedSpans(line);
  const hasTextbookContext = tintinalliReferenceContext.test(protectedLine.value)
    || printPageLocator.test(protectedLine.value)
    || pageColonLocator.test(protectedLine.value)
    || (
      textbookLocatorContext.test(protectedLine.value)
      && /(?:(?<![\p{L}\p{N}_])pp?\.?\s*\d|\bpages?\s+\d)/iu.test(protectedLine.value)
    );
  if (!hasTextbookContext) return line;

  const range = String.raw`\d{1,4}(?:\s*(?:[-–—~～]|to|至)\s*(?:pp?\.?\s*)?\d{1,4})?`;
  const value = protectedLine.value
    .replace(new RegExp(
      String.raw`\b(?:relevant\s+)?print\s+pages?\s*:\s*(?:pp?\.\s*)?${range}(?:\s*[,，、]\s*${range})+\.?`,
      "giu",
    ), "")
    .replace(
      /(?:位於\s*)?\bprint\s+page\s+range\s+beginning\s+around\s+p?\.?\s*\d{1,4}(?:\s*起)?/giu,
      "",
    )
    .replace(new RegExp(
      String.raw`(?:位於\s*)?\bprint\s+(?:pp?\.?|pages?)\s*(?:(?:approximately|approx(?:imately)?\.?|around|about|circa|starts?\s+at|約)\s*)?(?:pp?\.?\s*)?${range}(?:\s*起)?`,
      "giu",
    ), "")
    .replace(new RegExp(String.raw`\bpages?\s*[:：]\s*${range}`, "giu"), "")
    .replace(new RegExp(String.raw`(?<![\p{L}\p{N}_])pp?\.\s*${range}`, "giu"), "")
    .replace(new RegExp(
      String.raw`\bpages?\s+(?:(?:approximately|approx(?:imately)?\.?|around|about|circa|約)\s*)?(?:pp?\.?\s*)?${range}`,
      "giu",
    ), "")
    .replace(/\b(?:relevant\s+)?print\s+(?:pp?\.?|pages?)\b\.?/giu, "")
    .replace(/\s+([,，;；:：])/gu, "$1")
    .replace(/([,，;；])(?:\s*[,，;；])+/gu, "$1")
    .replace(/^(\s*[-+*]\s*)[,，;；:]\s*/u, "$1")
    .replace(/[,，;；:]\s*(?=\.?\s*$)/u, "")
    .replace(/\(\s*\)/gu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .trimEnd();
  return protectedLine.restore(value);
}

function hideTextbookPageLocatorsInReferences(lines: string[]) {
  const fenced = fencedLineMask(lines);
  const result: string[] = [];

  for (let index = 0; index < lines.length;) {
    const reference = fenced.has(index) ? null : lines[index].match(referenceHeading);
    if (!reference) {
      result.push(lines[index]);
      index += 1;
      continue;
    }

    result.push(lines[index]);
    const depth = reference[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const heading = fenced.has(end) ? null : lines[end].match(/^(#{1,6})\s+/u);
      if (heading && heading[1].length <= depth) break;
      end += 1;
    }
    for (const line of lines.slice(index + 1, end)) {
      const cleaned = stripTextbookPageLocators(line);
      if (!/^\s*[-+*]\s*$/u.test(cleaned)) result.push(cleaned);
    }
    index = end;
  }
  return result;
}

function cleanReferenceBlock(lines: string[]) {
  const removed = new Set<number>();
  const urlGroups = new Map<string, Array<{ index: number; score: number }>>();
  const urlTitles: Array<{ index: number; title: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const urls = referenceUrls(line);
    if (urls.length !== 1) continue;
    if (isReferenceListLine(line)) {
      const title = citationTitleBeforeUrl(line);
      if (title) urlTitles.push({ index, title });
    }
    if (isTableRow(line) && !isReferenceListLine(line)) continue;
    // Explanatory notes attached to a citation must be preserved. They still
    // participate in title-only deduplication above, but not URL-line dedupe.
    if (isExplanatoryReferenceLine(line)) continue;
    const url = canonicalReferenceUrl(urls[0]);
    const score = referenceTextWithoutUrl(line).length;
    const group = urlGroups.get(url) ?? [];
    group.push({ index, score });
    urlGroups.set(url, group);
  }

  for (const group of urlGroups.values()) {
    if (group.length < 2) continue;
    const keeper = group.reduce((best, candidate) => candidate.score > best.score ? candidate : best);
    for (const candidate of group) if (candidate.index !== keeper.index) removed.add(candidate.index);
  }

  // A title-only citation is redundant when another list item carries the
  // exact same token set plus its URL. This intentionally avoids fuzzy or
  // substring matching, so editions and Children/Adults variants stay apart.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      removed.has(index)
      || referenceUrls(line).length
      || !isReferenceListLine(line)
    ) continue;
    const title = canonicalReferenceTitle(line);
    if (!title) continue;
    if (urlTitles.some((candidate) => candidate.index !== index && candidate.title === title && !removed.has(candidate.index))) {
      removed.add(index);
    }
  }

  const seenExact = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (removed.has(index)) continue;
    const line = lines[index];
    const eligibleForExactDedupe = line.trim()
      && isReferenceListLine(line)
      && !isExplanatoryReferenceLine(line)
      && !isTableRow(line);
    if (eligibleForExactDedupe) {
      if (seenExact.has(line)) continue;
      seenExact.add(line);
    }
    result.push(line);
  }
  return result;
}

function deduplicateReferenceLines(lines: string[]) {
  const fenced = fencedLineMask(lines);
  const result: string[] = [];

  for (let index = 0; index < lines.length;) {
    const reference = fenced.has(index) ? null : lines[index].match(referenceHeading);
    if (!reference) {
      result.push(lines[index]);
      index += 1;
      continue;
    }

    result.push(lines[index]);
    const depth = reference[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const heading = fenced.has(end) ? null : lines[end].match(/^(#{1,6})\s+/);
      if (heading && heading[1].length <= depth) break;
      end += 1;
    }
    result.push(...cleanReferenceBlock(lines.slice(index + 1, end)));
    index = end;
  }
  return result;
}

function collapseExcessBlankLines(lines: string[]) {
  const fenced = fencedLineMask(lines);
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!fenced.has(index) && !line.trim() && result[result.length - 1] === "") continue;
    result.push(line);
  }
  return result;
}

function normalizeExplanationStructure(lines: string[]) {
  const result = [...lines];
  const firstContent = result.findIndex((line) => line.trim());

  // Every source explanation opens with a duplicated answer wrapper. The
  // answer is already visible in the question UI, so remove that exact block
  // and begin with the first substantive section.
  if (firstContent >= 0 && /^##\s+3[.)、．]\s*官方答案\s*$/u.test(result[firstContent])) {
    let nestedAnswer = firstContent + 1;
    while (nestedAnswer < result.length && !result[nestedAnswer].trim()) nestedAnswer += 1;
    if (/^###\s+官方答案\s*$/u.test(result[nestedAnswer] ?? "")) {
      let nextSubheading = nestedAnswer + 1;
      while (nextSubheading < result.length && !/^###\s+/.test(result[nextSubheading])) nextSubheading += 1;
      if (/^###\s+題型\s*$/u.test(result[nextSubheading] ?? "")) {
        let firstSubstantiveSection = nextSubheading + 1;
        while (firstSubstantiveSection < result.length && !/^#{2,3}\s+/.test(result[firstSubstantiveSection])) {
          firstSubstantiveSection += 1;
        }
        // The question card already carries the question type. Keeping the
        // imported answer and type preamble above the explanation only repeats
        // metadata, so start at the first real teaching section instead.
        result.splice(firstContent, firstSubstantiveSection - firstContent);
      }
    }
  }

  // One legacy explanation (095-Q074) contains a second imported answer
  // template inside its exam-path section. Remove that block only when its
  // complete, distinctive heading sequence is present; legitimate prose that
  // mentions the official answer is never touched.
  const pathStart = result.findIndex((line) => /^##\s+4[.)、．]\s*考場解題路徑\s*$/u.test(line));
  if (pathStart >= 0) {
    const pathEnd = result.findIndex((line, index) => index > pathStart && /^##\s+5[.)、．]\s*/u.test(line));
    const boundary = pathEnd >= 0 ? pathEnd : result.length;
    const officialHeadings = result
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => index > pathStart && index < boundary && /^###\s+官方答案\s*$/u.test(line))
      .map(({ index }) => index);
    const optionHeading = result.findIndex((line, index) => index > pathStart && index < boundary && /^###\s+選項\s*$/u.test(line));
    const quickJudgement = result.findIndex((line, index) => index > pathStart && index < boundary && /^###\s+秒殺判斷\s*$/u.test(line));
    if (
      officialHeadings.length === 2
      && optionHeading > officialHeadings[0]
      && optionHeading < officialHeadings[1]
      && quickJudgement > officialHeadings[1]
    ) {
      result.splice(officialHeadings[0], quickJudgement - officialHeadings[0]);
    }
  }

  // A small set of legacy records pasted a second explanation template at the
  // end of the exam-path section. It always begins with a nested question-type
  // heading and runs to the next numbered section; remove that duplicate tail.
  const duplicatedPathStart = result.findIndex((line) => /^##\s+4[.)、．]\s*考場解題路徑\s*$/u.test(line));
  if (duplicatedPathStart >= 0) {
    const duplicatedPathEnd = result.findIndex((line, index) => index > duplicatedPathStart && /^##\s+5[.)、．]\s*/u.test(line));
    const boundary = duplicatedPathEnd >= 0 ? duplicatedPathEnd : result.length;
    const duplicatedType = result.findIndex((line, index) => index > duplicatedPathStart && index < boundary && /^###\s+題型\s*$/u.test(line));
    if (duplicatedType >= 0) result.splice(duplicatedType, boundary - duplicatedType);
  }

  // Source numbering starts at 3 because sections 1–2 are stored separately
  // as the stem and options. Hiding those authoring numbers gives the reader a
  // coherent hierarchy without changing the raw source or heading ranks.
  return result.map((line) => line
    .replace(/^###\s+核心理由\s*$/u, "## 核心理由")
    .replace(/^##\s+\d+[.)、．]\s+(.+)$/u, "## $1")
    .replace(/^##\s+(?:(?:ref(?:erences?)?[\s:：/–—-]*)?(?:參考資料|參考文獻)|(?:textbook\s+)?references?)\s*$/iu, "## 參考資料"));
}

export function normalizeMarkdown(markdown: string) {
  const sourceLines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const fenced = fencedLineMask(sourceLines);
  const normalizedLines = sourceLines.map((line, index) => fenced.has(index) ? line : normalizeInlineSyntax(line));
  return collapseExcessBlankLines(
    deduplicateReferenceLines(
      hideTextbookPageLocatorsInReferences(
        normalizeTableSpacing(
          convertLegacyLatexBlocks(
            normalizeExplanationStructure(normalizedLines),
          ),
        ),
      ),
    ),
  ).join("\n");
}
