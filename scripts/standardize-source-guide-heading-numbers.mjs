import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import remarkParse from "remark-parse";
import { unified } from "unified";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = [path.resolve(projectRoot, ".."), path.resolve(projectRoot, "..", "..")]
  .find((candidate) => fs.existsSync(path.join(candidate, "outputs", "02_learning_guides")))
  ?? path.resolve(projectRoot, "..");
const options = parseArguments(process.argv.slice(2));
const sourceDefinitions = [
  {
    name: "tintinalli-concise",
    count: 303,
    directory: path.join(options.sourceRoot, "outputs", "02_learning_guides", "tintinalli-concise"),
    filenamePattern: /^tintinalli-CH\d{3}-concise-full\.md$/u,
  },
  {
    name: "tintinalli-detailed",
    count: 303,
    directory: path.join(options.sourceRoot, "outputs", "02_learning_guides", "tintinalli-detailed"),
    filenamePattern: /^tintinalli-CH\d{3}-detailed-full\.md$/u,
  },
  {
    name: "rosens",
    count: 208,
    directory: path.join(options.sourceRoot, "outputs", "02_learning_guides", "rosens"),
    filenamePattern: /^rosens-CH\d{3}-full\.md$/u,
  },
];

const ZH_ENUM = /^[零〇○一二三四五六七八九十百千萬兩两壹貳贰參叁肆伍陸陆柒捌玖拾佰仟]+[、．.][\t \u3000]*/u;
const HIER_ENUM = /^\d+(?:\.\d+){1,3}(?:[.．、)]?[\t \u3000]+|[.．、)])/u;
const AR_ENUM = /^(?:\(\d+\)|\d+[.．、])[\t \u3000]+/u;
const PART_ENUM = /^Part[\t \u3000]+(?:\d+|[A-G]|VIII|VII|VI|IV|V|III|II|I)(?=[\t \u3000｜|:：—–-])[\t \u3000]*(?:[｜|:：—–-][\t \u3000]*)?/iu;
const STEP_ENUM = /^Step[\t \u3000]+\d+(?=[\t \u3000｜|:：—–-])[\t \u3000]*(?:[｜|:：—–-][\t \u3000]*)?/iu;
const ZH_STEP = /^第[\t \u3000]*(?:\d+|[零〇○一二三四五六七八九十百千萬兩两]+)[\t \u3000]*步[\t \u3000]*(?:[：:、.．—–-][\t \u3000]*)?/u;
const LETTER_ENUM = /^([A-Z])[.．、)]([\t \u3000]+)(.+)$/u;
const MNEMONIC_LETTER_ENUM = /^([A-Z])[\t \u3000]*[—–-][\t \u3000]+(.+)$/u;
const SEMANTIC_TAXON = /^(?:C\.[\t \u3000]*difficile|E\.[\t \u3000]*coli|H\.[\t \u3000]*pylori|K\.[\t \u3000]*kingae|M\.[\t \u3000]*tuberculosis|N\.[\t \u3000]*meningitidis|P\.[\t \u3000]*(?:vivax|ovale)|S\.[\t \u3000]*(?:aureus|pneumoniae))\b/iu;
const SEMANTIC_DECIMAL_VALUE = /^\d+(?:\.\d+)+(?:[\t \u3000]*%|[\t \u3000]+(?:mg|mcg|g|kg|mL|L|mEq|mmol|mol|mm|cm|m|°C|°F|°|Hz|kPa|mmHg|cells?|days?|hours?|minutes?|分鐘|小時|天)(?![\p{L}\p{M}]))/u;

const report = {
  mode: options.write ? "write" : "dry-run",
  files: 0,
  changedFiles: 0,
  headings: 0,
  changedHeadings: 0,
  releveledHeadings: 0,
  h1: 0,
  h2: 0,
  h3: 0,
  h4: 0,
  hierarchyCorrections: {
    promotedOuterSequence: 0,
    demotedNestedRun: 0,
    demotedLeadingSequenceItem: 0,
    demotedTrailingRun: 0,
    demotedDecimalChild: 0,
    suppressedUnsafePromotion: 0,
  },
  hierarchyChanges: [],
  removedPrefixes: {
    chinese: 0,
    arabic: 0,
    hierarchical: 0,
    letter: 0,
    part: 0,
    step: 0,
    chineseStep: 0,
  },
  protectedSemanticPrefixes: {
    taxon: 0,
    decimalValue: 0,
  },
  ambiguous: [],
  directories: {},
  previews: [],
  rewrites: [],
};

for (const definition of sourceDefinitions) {
  if (!fs.existsSync(definition.directory)) {
    throw new Error(`Source directory does not exist: ${definition.directory}`);
  }
  const files = fs.readdirSync(definition.directory)
    .filter((name) => definition.filenamePattern.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (files.length !== definition.count) {
    throw new Error(
      `${definition.name}: expected ${definition.count} chapter files, found ${files.length}`,
    );
  }

  const directoryReport = {
    files: files.length,
    changedFiles: 0,
    headings: 0,
    changedHeadings: 0,
  };
  report.directories[definition.name] = directoryReport;

  for (const filename of files) {
    const sourcePath = path.join(definition.directory, filename);
    const label = `${definition.name}/${filename}`;
    const beforeBuffer = fs.readFileSync(sourcePath);
    const before = decodeUtf8(beforeBuffer, sourcePath);
    const transformed = transformMarkdown(before, label);

    verifyTransformation({
      sourcePath,
      before,
      beforeBuffer,
      after: transformed.after,
      beforeHeadings: transformed.beforeHeadings,
      expected: transformed.expected,
    });

    const changed = transformed.after !== before;
    report.files += 1;
    report.headings += transformed.beforeHeadings.length;
    report.changedHeadings += transformed.changedHeadings;
    directoryReport.headings += transformed.beforeHeadings.length;
    directoryReport.changedHeadings += transformed.changedHeadings;
    if (changed) {
      report.changedFiles += 1;
      directoryReport.changedFiles += 1;
    }
    report.releveledHeadings += transformed.releveledHeadings;
    for (const heading of transformed.expected) {
      report[`h${heading.depth}`] += 1;
    }
    for (const [reason, count] of Object.entries(transformed.hierarchyCorrections)) {
      report.hierarchyCorrections[reason] += count;
    }
    report.hierarchyChanges.push(...transformed.hierarchyChanges.map((change) => ({
      file: label,
      ...change,
    })));
    for (const [reason, count] of Object.entries(transformed.removedPrefixes)) {
      report.removedPrefixes[reason] += count;
    }
    for (const [reason, count] of Object.entries(transformed.protectedSemanticPrefixes)) {
      report.protectedSemanticPrefixes[reason] += count;
    }
    report.ambiguous.push(...transformed.ambiguous);
    report.rewrites.push(...transformed.rewrites.map((rewrite) => ({
      file: label,
      ...rewrite,
    })));

    if (options.previews.has(label)) {
      report.previews.push({
        file: label,
        headings: transformed.expected.map((heading) => ({
          line: heading.line,
          depth: heading.depth,
          before: heading.beforeTitle,
          after: heading.afterTitle,
          removed: heading.removedReason,
        })),
      });
    }
    if (options.write && changed) atomicWrite(sourcePath, Buffer.from(transformed.after, "utf8"));
  }
}

if (report.files !== 814) throw new Error(`Expected 814 source guides, found ${report.files}`);
if (report.h1 !== 814) throw new Error(`Expected exactly one H1 per guide, found ${report.h1}`);
if (report.ambiguous.length) {
  throw new Error(
    `Refusing to ${options.write ? "write" : "approve"} ${report.ambiguous.length} ambiguous heading prefixes. `
    + `Run with --json to inspect them.`,
  );
}

const output = options.json
  ? JSON.stringify(report, null, 2)
  : formatReport(report);
console.log(output);
if (options.reportPath) {
  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function parseArguments(argumentsList) {
  const sourceRootArgument = argumentsList.find((argument) => argument.startsWith("--source-root="));
  const reportArgument = argumentsList.find((argument) => argument.startsWith("--report="));
  const previews = new Set(argumentsList
    .filter((argument) => argument.startsWith("--preview="))
    .map((argument) => argument.slice("--preview=".length).replaceAll("\\", "/")));
  return {
    write: argumentsList.includes("--write"),
    json: argumentsList.includes("--json"),
    sourceRoot: sourceRootArgument
      ? path.resolve(projectRoot, sourceRootArgument.slice("--source-root=".length))
      : workspaceRoot,
    reportPath: reportArgument
      ? path.resolve(projectRoot, reportArgument.slice("--report=".length))
      : null,
    previews,
  };
}

function transformMarkdown(markdown, label) {
  const beforeHeadings = parseHeadings(markdown, label);
  const hierarchy = inferIntendedDepths(beforeHeadings, label);
  const workingHeadings = beforeHeadings.map((heading, index) => ({
    ...heading,
    sourceDepth: heading.depth,
    depth: hierarchy.depths[index],
  }));
  const parents = buildParents(workingHeadings, label);
  const letterSequences = findStructuralLetterHeadings(workingHeadings, parents);
  const childCounts = new Map();
  const expected = [];
  const edits = [];
  const rewrites = [];
  const removedPrefixes = emptyReasonCounts();
  const protectedSemanticPrefixes = { taxon: 0, decimalValue: 0 };
  const ambiguous = [];
  let changedHeadings = 0;

  for (let index = 0; index < workingHeadings.length; index += 1) {
    const heading = workingHeadings[index];
    if (heading.depth === 1) {
      expected.push({
        line: heading.line,
        depth: heading.depth,
        beforeTitle: heading.title,
        afterTitle: heading.title,
        removedReason: null,
      });
      continue;
    }

    const stripped = stripStructuralPrefix(heading.title, {
      allowLetter: letterSequences.has(index),
    });
    if (stripped.protectedReason) protectedSemanticPrefixes[stripped.protectedReason] += 1;
    for (const reason of stripped.removedReasons) removedPrefixes[reason] += 1;
    if (!visibleHeadingText(stripped.title)) {
      ambiguous.push({
        file: label,
        line: heading.line,
        depth: heading.depth,
        title: heading.title,
        reason: "prefix removal would leave an empty heading",
      });
      stripped.title = heading.title;
      stripped.removedReason = null;
      stripped.removedReasons = [];
    }

    const parentIndex = parents[index];
    const siblingKey = `${parentIndex ?? "root"}:${heading.depth}`;
    const childNumber = (childCounts.get(siblingKey) ?? 0) + 1;
    childCounts.set(siblingKey, childNumber);

    let displayPrefix = "";
    if (heading.depth === 2) {
      displayPrefix = `${childNumber}. `;
    } else if (heading.depth === 3) {
      const parent = expected[parentIndex];
      if (!parent || parent.depth !== 2 || !parent.path) {
        ambiguous.push({
          file: label,
          line: heading.line,
          depth: heading.depth,
          title: heading.title,
          reason: "H3 has no valid H2 parent",
        });
      } else {
        displayPrefix = `${parent.path}.${childNumber} `;
      }
    }

    const pathValue = heading.depth === 2
      ? `${childNumber}`
      : heading.depth === 3
        ? `${expected[parentIndex]?.path ?? "?"}.${childNumber}`
        : null;
    const afterTitle = `${displayPrefix}${stripped.title}`.trim();
    const rawAfter = formatHeadingLine(heading, heading.depth, afterTitle);
    if (rawAfter !== heading.raw) {
      edits.push({ start: heading.start, end: heading.end, replacement: rawAfter });
      rewrites.push({
        line: heading.line,
        depth: heading.depth,
        before: heading.title,
        after: afterTitle,
      });
      changedHeadings += 1;
    }
    expected.push({
      line: heading.line,
      depth: heading.depth,
      beforeTitle: heading.title,
      afterTitle,
      rawAfter,
      path: pathValue,
      removedReason: stripped.removedReason,
      semanticBase: normalizedSemanticBase(stripped.title),
    });
  }

  return {
    after: applyEdits(markdown, edits),
    beforeHeadings,
    expected,
    changedHeadings,
    releveledHeadings: hierarchy.depths.reduce(
      (count, depth, index) => count + Number(depth !== beforeHeadings[index].depth),
      0,
    ),
    hierarchyCorrections: hierarchy.corrections,
    hierarchyChanges: hierarchy.changes,
    removedPrefixes,
    protectedSemanticPrefixes,
    ambiguous,
    rewrites,
  };
}

function parseHeadings(markdown, label) {
  const tree = unified().use(remarkParse).parse(markdown);
  const headings = [];
  visit(tree, (node) => {
    if (node.type !== "heading") return;
    if (node.depth < 1 || node.depth > 4) {
      throw new Error(`${label}: unsupported H${node.depth}`);
    }
    const start = node.position?.start;
    const end = node.position?.end;
    if (
      typeof start?.offset !== "number"
      || typeof end?.offset !== "number"
      || start.line !== end.line
    ) {
      throw new Error(`${label}: heading at line ${start?.line ?? "unknown"} is not a one-line ATX heading`);
    }
    const raw = markdown.slice(start.offset, end.offset);
    const parts = /^( {0,3})(#{1,4})([\t ]+)(.*?)([\t ]+#+[\t ]*)?$/u.exec(raw);
    if (!parts || parts[2].length !== node.depth) {
      throw new Error(`${label}: unsupported heading syntax at line ${start.line}`);
    }
    const title = parts[4].trim();
    if (!visibleHeadingText(title)) throw new Error(`${label}: empty heading at line ${start.line}`);
    headings.push({
      depth: node.depth,
      line: start.line,
      start: start.offset,
      end: end.offset,
      raw,
      indentation: parts[1],
      hashes: parts[2],
      spacing: parts[3],
      title,
      closing: parts[5] ?? "",
    });
  });
  if (!headings.length) throw new Error(`${label}: no headings found`);
  if (headings[0].depth !== 1) throw new Error(`${label}: first heading must be H1`);
  if (headings.filter((heading) => heading.depth === 1).length !== 1) {
    throw new Error(`${label}: expected exactly one H1`);
  }
  return headings;
}

function buildParents(headings, label) {
  const parents = new Array(headings.length).fill(null);
  const stack = [];
  for (let index = 0; index < headings.length; index += 1) {
    const depth = headings[index].depth;
    while (stack.length && headings[stack.at(-1)].depth >= depth) stack.pop();
    parents[index] = stack.length ? stack.at(-1) : null;
    if (index > 0) {
      const parentIndex = parents[index];
      if (parentIndex === null || headings[parentIndex].depth !== depth - 1) {
        throw new Error(
          `${label}: H${depth} at line ${headings[index].line} has no direct H${depth - 1} parent`,
        );
      }
    }
    stack.push(index);
  }
  return parents;
}

function inferIntendedDepths(headings, label) {
  const depths = headings.map((heading) => heading.depth);
  const reasons = headings.map(() => new Set());
  const corrections = {
    promotedOuterSequence: 0,
    demotedNestedRun: 0,
    demotedLeadingSequenceItem: 0,
    demotedTrailingRun: 0,
    demotedDecimalChild: 0,
    suppressedUnsafePromotion: 0,
  };

  let previousDepths = [...depths];
  promoteMisleveledOuterItems(headings, depths, corrections, label);
  recordHierarchyReasons(previousDepths, depths, reasons, "promotedOuterSequence");
  previousDepths = [...depths];
  demoteBracketedNestedRuns(headings, depths, corrections, label);
  recordHierarchyReasons(previousDepths, depths, reasons, "demotedNestedRun");
  previousDepths = [...depths];
  demoteMisleveledLeadingSequenceItems(headings, depths, corrections);
  recordHierarchyReasons(previousDepths, depths, reasons, "demotedLeadingSequenceItem");
  previousDepths = [...depths];
  demoteTrailingNestedRuns(headings, depths, corrections);
  recordHierarchyReasons(previousDepths, depths, reasons, "demotedTrailingRun");
  previousDepths = [...depths];
  demoteMisleveledDecimalChildren(headings, depths, corrections);
  recordHierarchyReasons(previousDepths, depths, reasons, "demotedDecimalChild");

  const projected = headings.map((heading, index) => ({ ...heading, depth: depths[index] }));
  buildParents(projected, label);
  const changes = headings.flatMap((heading, index) => (
    heading.depth === depths[index]
      ? []
      : [{
          line: heading.line,
          beforeDepth: heading.depth,
          afterDepth: depths[index],
          title: heading.title,
          reasons: [...reasons[index]],
        }]
  ));
  return { depths, corrections, changes };
}

function recordHierarchyReasons(beforeDepths, afterDepths, reasons, reason) {
  for (let index = 0; index < afterDepths.length; index += 1) {
    if (beforeDepths[index] !== afterDepths[index]) reasons[index].add(reason);
  }
}

function promoteMisleveledOuterItems(headings, depths, corrections, label) {
  for (let index = 1; index < headings.length - 1; index += 1) {
    const depth = depths[index];
    if (depth <= 2) continue;
    const token = outlineToken(headings[index].title);
    if (!token || !isSingleSequenceToken(token)) continue;
    if (
      label === "tintinalli-detailed/tintinalli-CH012-detailed-full.md"
      && headings[index].line === 432
    ) {
      corrections.suppressedUnsafePromotion += 1;
      continue;
    }

    const previousIndex = findPreviousAtDepth(depths, index, depth - 1);
    const nextIndex = findNextAtOrAboveDepth(depths, index, depth - 1);
    if (
      previousIndex === null
      || nextIndex === null
      || depths[nextIndex] !== depth - 1
    ) {
      continue;
    }
    const previousToken = outlineToken(headings[previousIndex].title);
    const nextToken = outlineToken(headings[nextIndex].title);
    if (
      !sameSequenceKind(previousToken, token)
      || !sameSequenceKind(nextToken, token)
      || previousToken.value + 1 !== token.value
      || token.value + 1 !== nextToken.value
    ) {
      continue;
    }

    depths[index] -= 1;
    for (let child = index + 1; child < headings.length && depths[child] > depth; child += 1) {
      depths[child] -= 1;
    }
    corrections.promotedOuterSequence += 1;
  }
}

function demoteBracketedNestedRuns(headings, depths, corrections, label) {
  for (let depth = 2; depth <= 3; depth += 1) {
    let changed = true;
    while (changed) {
      changed = false;
      const projected = headings.map((heading, index) => ({ ...heading, depth: depths[index] }));
      const parents = buildParents(projected, label);
      const siblingGroups = new Map();
      for (let index = 1; index < headings.length; index += 1) {
        if (depths[index] !== depth) continue;
        const key = `${parents[index] ?? "root"}:${depth}`;
        const group = siblingGroups.get(key) ?? [];
        group.push(index);
        siblingGroups.set(key, group);
      }

      groupLoop:
      for (const siblings of siblingGroups.values()) {
        for (let leftPosition = 0; leftPosition < siblings.length - 3; leftPosition += 1) {
          const leftIndex = siblings[leftPosition];
          const leftToken = outlineToken(headings[leftIndex].title);
          if (!leftToken || !isSingleSequenceToken(leftToken)) continue;

          for (
            let rightPosition = leftPosition + 3;
            rightPosition < siblings.length;
            rightPosition += 1
          ) {
            const rightIndex = siblings[rightPosition];
            const rightToken = outlineToken(headings[rightIndex].title);
            if (!sameSequenceKind(leftToken, rightToken)) continue;
            if (rightToken.value !== leftToken.value + 1) break;

            const innerIndexes = siblings.slice(leftPosition + 1, rightPosition);
            const innerTokens = innerIndexes.map((index) => outlineToken(headings[index].title));
            if (!isNestedSequence(innerTokens, leftToken.kind)) break;

            const regionStart = innerIndexes[0];
            const regionEnd = rightIndex;
            const affected = [];
            for (let index = regionStart; index < regionEnd; index += 1) {
              if (depths[index] < depth) break;
              if (depths[index] >= depth) affected.push(index);
            }
            if (affected.some((index) => depths[index] >= 4)) {
              throw new Error(
                `${label}: nested outline run at line ${headings[regionStart].line} would exceed H4`,
              );
            }
            for (const index of affected) depths[index] += 1;
            corrections.demotedNestedRun += innerIndexes.length;
            changed = true;
            break groupLoop;
          }
        }
      }
    }
  }
}

function demoteMisleveledLeadingSequenceItems(headings, depths, corrections) {
  for (let index = 1; index < headings.length - 1; index += 1) {
    const depth = depths[index];
    if (depth >= 4) continue;
    const token = outlineToken(headings[index].title);
    if (!token || !isSingleSequenceToken(token) || token.value !== 1) continue;

    const previousIndex = findPreviousAtDepthUntilShallower(depths, index, depth);
    const nextBoundaryIndex = findNextAtOrAboveDepth(depths, index, depth);
    if (
      previousIndex === null
      || nextBoundaryIndex === null
      || depths[nextBoundaryIndex] !== depth
    ) {
      continue;
    }
    const previousToken = outlineToken(headings[previousIndex].title);
    const nextBoundaryToken = outlineToken(headings[nextBoundaryIndex].title);
    if (
      !sameSequenceKind(previousToken, nextBoundaryToken)
      || previousToken.value + 1 !== nextBoundaryToken.value
    ) {
      continue;
    }

    const followingTokens = [];
    for (let child = index + 1; child < nextBoundaryIndex; child += 1) {
      if (depths[child] === depth + 1) {
        followingTokens.push(outlineToken(headings[child].title));
      }
    }
    if (
      followingTokens.length < 1
      || followingTokens.some((candidate, position) => (
        !candidate
        || !isSingleSequenceToken(candidate)
        || candidate.kind !== token.kind
        || candidate.value !== position + 2
      ))
    ) {
      continue;
    }

    depths[index] += 1;
    corrections.demotedLeadingSequenceItem += 1;
  }
}

function demoteTrailingNestedRuns(headings, depths, corrections) {
  for (let index = 1; index < headings.length - 1; index += 1) {
    const depth = depths[index];
    if (depth >= 4) continue;
    const marker = outlineToken(headings[index].title);
    if (!marker || (marker.kind !== "letter" && marker.kind !== "mnemonicLetter")) continue;

    const nextBoundaryIndex = findNextShallowerDepth(depths, index, depth);
    if (nextBoundaryIndex === null) continue;
    const regionIndexes = [];
    let hasDeeperHeading = false;
    for (let candidate = index + 1; candidate < nextBoundaryIndex; candidate += 1) {
      if (depths[candidate] > depth) hasDeeperHeading = true;
      if (depths[candidate] === depth) regionIndexes.push(candidate);
    }
    if (hasDeeperHeading || regionIndexes.length < 2) continue;

    const tokens = regionIndexes.map((candidate) => outlineToken(headings[candidate].title));
    if (
      tokens.some((candidate, position) => (
        !candidate
        || (candidate.kind !== "arabic" && candidate.kind !== "chinese")
        || candidate.kind !== tokens[0]?.kind
        || candidate.value !== position + 1
      ))
    ) {
      continue;
    }

    for (const candidate of regionIndexes) depths[candidate] += 1;
    corrections.demotedTrailingRun += regionIndexes.length;
  }
}

function demoteMisleveledDecimalChildren(headings, depths, corrections) {
  for (let index = 1; index < headings.length; index += 1) {
    const depth = depths[index];
    if (depth >= 4) continue;
    const token = outlineToken(headings[index].title);
    if (!token || token.kind !== "hierarchical" || token.parts.length < 2) continue;

    const parentIndex = findPreviousAtDepth(depths, index, depth - 1);
    const parentToken = parentIndex === null ? null : outlineToken(headings[parentIndex].title);
    if (numericTokenMatches(parentToken, token.parts.slice(0, -1))) continue;

    const previousSiblingIndex = findPreviousAtDepthUntilShallower(depths, index, depth);
    if (previousSiblingIndex === null) continue;
    const previousToken = outlineToken(headings[previousSiblingIndex].title);
    if (!numericTokenMatches(previousToken, token.parts.slice(0, -1))) continue;

    depths[index] += 1;
    corrections.demotedDecimalChild += 1;
  }
}

function outlineToken(title) {
  const value = withoutLeadingMarkup(title);
  if (SEMANTIC_TAXON.test(value) || SEMANTIC_DECIMAL_VALUE.test(value)) return null;

  const hierarchical = /^(\d+(?:\.\d+){1,3})(?:[.．、)]?[\t \u3000]+|[.．、)])/u.exec(value);
  if (hierarchical) {
    return {
      kind: "hierarchical",
      parts: hierarchical[1].split(".").map((part) => Number.parseInt(part, 10)),
    };
  }
  const chinese = /^([零〇○一二三四五六七八九十百千萬兩两壹貳贰參叁肆伍陸陆柒捌玖拾佰仟]+)[、．.][\t \u3000]*/u.exec(value);
  if (chinese) {
    const parsed = parseChineseOrdinal(chinese[1]);
    return parsed === null ? null : { kind: "chinese", value: parsed };
  }
  const arabic = /^(?:\((\d+)\)|(\d+)[.．、])[\t \u3000]+/u.exec(value);
  if (arabic) {
    return { kind: "arabic", value: Number.parseInt(arabic[1] ?? arabic[2], 10) };
  }
  const letter = LETTER_ENUM.exec(value);
  if (letter && !SEMANTIC_TAXON.test(value)) {
    return { kind: "letter", value: letter[1].charCodeAt(0) - 64 };
  }
  const mnemonicLetter = MNEMONIC_LETTER_ENUM.exec(value);
  if (mnemonicLetter) {
    return { kind: "mnemonicLetter", value: mnemonicLetter[1].charCodeAt(0) - 64 };
  }
  return null;
}

function parseChineseOrdinal(value) {
  const normalized = value
    .replaceAll("〇", "零")
    .replaceAll("○", "零")
    .replaceAll("兩", "二")
    .replaceAll("两", "二")
    .replaceAll("壹", "一")
    .replaceAll("貳", "二")
    .replaceAll("贰", "二")
    .replaceAll("參", "三")
    .replaceAll("叁", "三")
    .replaceAll("肆", "四")
    .replaceAll("伍", "五")
    .replaceAll("陸", "六")
    .replaceAll("陆", "六")
    .replaceAll("柒", "七")
    .replaceAll("捌", "八")
    .replaceAll("玖", "九")
    .replaceAll("拾", "十")
    .replaceAll("佰", "百")
    .replaceAll("仟", "千");
  const digit = new Map([
    ["零", 0], ["一", 1], ["二", 2], ["三", 3], ["四", 4],
    ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9],
  ]);
  if ([...normalized].every((character) => digit.has(character))) {
    return Number.parseInt([...normalized].map((character) => digit.get(character)).join(""), 10);
  }

  let total = 0;
  let current = 0;
  const units = new Map([["十", 10], ["百", 100], ["千", 1000], ["萬", 10000]]);
  for (const character of normalized) {
    if (digit.has(character)) {
      current = digit.get(character);
      continue;
    }
    const unit = units.get(character);
    if (!unit) return null;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function isSingleSequenceToken(token) {
  return (
    token.kind === "chinese"
    || token.kind === "arabic"
    || token.kind === "letter"
    || token.kind === "mnemonicLetter"
  );
}

function sameSequenceKind(left, right) {
  return Boolean(
    left
    && right
    && isSingleSequenceToken(left)
    && left.kind === right.kind,
  );
}

function isNestedSequence(tokens, outerKind) {
  if (tokens.length < 2 || tokens.some((token) => !token || !isSingleSequenceToken(token))) {
    return false;
  }
  if (tokens[0].kind === outerKind || tokens[0].value !== 1) return false;
  return tokens.every((token, index) => (
    token.kind === tokens[0].kind
    && token.value === index + 1
  ));
}

function numericTokenMatches(token, parts) {
  if (!token || !parts.length) return false;
  if (token.kind === "chinese" || token.kind === "arabic") {
    return parts.length === 1 && token.value === parts[0];
  }
  return token.kind === "hierarchical"
    && token.parts.length === parts.length
    && token.parts.every((part, index) => part === parts[index]);
}

function findPreviousAtDepth(depths, startIndex, depth) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (depths[index] === depth) return index;
    if (depths[index] < depth) return null;
  }
  return null;
}

function findNextAtOrAboveDepth(depths, startIndex, depth) {
  for (let index = startIndex + 1; index < depths.length; index += 1) {
    if (depths[index] <= depth) return index;
  }
  return null;
}

function findNextShallowerDepth(depths, startIndex, depth) {
  for (let index = startIndex + 1; index < depths.length; index += 1) {
    if (depths[index] < depth) return index;
  }
  return null;
}

function findPreviousAtDepthUntilShallower(depths, startIndex, depth) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (depths[index] === depth) return index;
    if (depths[index] < depth) return null;
  }
  return null;
}

function findStructuralLetterHeadings(headings, parents) {
  const groups = new Map();
  for (let index = 1; index < headings.length; index += 1) {
    const heading = headings[index];
    const visible = withoutLeadingMarkup(heading.title);
    if (SEMANTIC_TAXON.test(visible)) continue;
    const match = LETTER_ENUM.exec(visible);
    if (!match) continue;
    const key = `${parents[index]}:${heading.depth}`;
    const group = groups.get(key) ?? [];
    group.push({ index, code: match[1].charCodeAt(0) });
    groups.set(key, group);
  }

  const structural = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const consecutive = group.every((candidate, index) => (
      index === 0 || candidate.code === group[index - 1].code + 1
    ));
    if (!consecutive) continue;
    for (const candidate of group) structural.add(candidate.index);
  }
  return structural;
}

function stripStructuralPrefix(title, { allowLetter }) {
  const leadingMarkup = leadingInlineMarkup(title);
  let remainder = title.slice(leadingMarkup.length);
  const result = {
    title,
    removedReason: null,
    removedReasons: [],
    protectedReason: null,
  };

  const candidates = [
    ["chinese", ZH_ENUM],
    ["hierarchical", HIER_ENUM],
    ["arabic", AR_ENUM],
    ["part", PART_ENUM],
    ["step", STEP_ENUM],
    ["chineseStep", ZH_STEP],
  ];

  for (let pass = 0; pass < 4; pass += 1) {
    if (SEMANTIC_TAXON.test(remainder)) {
      result.protectedReason = "taxon";
      break;
    }
    if (SEMANTIC_DECIMAL_VALUE.test(remainder)) {
      result.protectedReason = "decimalValue";
      break;
    }

    let removed = false;
    for (const [reason, pattern] of candidates) {
      if (!pattern.test(remainder)) continue;
      remainder = remainder.replace(pattern, "");
      result.removedReasons.push(reason);
      removed = true;
      break;
    }
    if (!removed && allowLetter) {
      const letter = LETTER_ENUM.exec(remainder);
      if (letter) {
        remainder = letter[3];
        result.removedReasons.push("letter");
        removed = true;
      }
    }
    if (!removed) break;
  }
  result.title = `${leadingMarkup}${remainder}`.trim();
  result.removedReason = result.removedReasons.join("+") || null;
  return result;
}

function normalizedSemanticBase(title) {
  return visibleHeadingText(title).replace(/[\t \u3000]+/gu, " ").trim().normalize("NFC");
}

function visibleHeadingText(title) {
  return title
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_~]/gu, "")
    .trim();
}

function leadingInlineMarkup(title) {
  return /^((?:(?:\*\*|__|~~|`|\*|_)[\t \u3000]*)*)/u.exec(title)?.[1] ?? "";
}

function withoutLeadingMarkup(title) {
  return title.slice(leadingInlineMarkup(title).length);
}

function formatHeadingLine(heading, depth, title) {
  return `${heading.indentation}${"#".repeat(depth)}${heading.spacing}${title}${heading.closing}`;
}

function applyEdits(markdown, edits) {
  let output = "";
  let cursor = 0;
  for (const edit of edits.sort((left, right) => left.start - right.start)) {
    if (edit.start < cursor) throw new Error("Overlapping heading edits");
    output += markdown.slice(cursor, edit.start);
    output += edit.replacement;
    cursor = edit.end;
  }
  return output + markdown.slice(cursor);
}

function verifyTransformation({
  sourcePath,
  before,
  beforeBuffer,
  after,
  beforeHeadings,
  expected,
}) {
  const afterHeadings = parseHeadings(after, sourcePath);
  if (afterHeadings.length !== beforeHeadings.length) {
    throw new Error(`${sourcePath}: heading count changed`);
  }
  if (afterHeadings[0].raw !== beforeHeadings[0].raw) {
    throw new Error(`${sourcePath}: H1 changed`);
  }

  for (let index = 0; index < beforeHeadings.length; index += 1) {
    const beforeHeading = beforeHeadings[index];
    const afterHeading = afterHeadings[index];
    const expectation = expected[index];
    if (
      expectation.depth !== afterHeading.depth
      || beforeHeading.line !== afterHeading.line
      || afterHeading.title !== expectation.afterTitle
    ) {
      throw new Error(`${sourcePath}: heading structure changed at index ${index}`);
    }
    if (afterHeading.depth === 2 && !new RegExp(`^${escapeRegExp(expectation.path)}\\. `, "u").test(afterHeading.title)) {
      throw new Error(`${sourcePath}: invalid H2 number at line ${afterHeading.line}`);
    }
    if (afterHeading.depth === 3 && !new RegExp(`^${escapeRegExp(expectation.path)} `, "u").test(afterHeading.title)) {
      throw new Error(`${sourcePath}: invalid H3 number at line ${afterHeading.line}`);
    }
    if (afterHeading.depth === 4) {
      const stripped = stripStructuralPrefix(afterHeading.title, { allowLetter: false });
      if (stripped.removedReason) {
        throw new Error(`${sourcePath}: H4 retains a structural prefix at line ${afterHeading.line}`);
      }
    }
  }

  if (maskHeadingRanges(before, beforeHeadings) !== maskHeadingRanges(after, afterHeadings)) {
    throw new Error(`${sourcePath}: bytes outside headings changed`);
  }
  if (newlineStyle(before) !== newlineStyle(after)) {
    throw new Error(`${sourcePath}: newline style changed`);
  }
  if (before.endsWith("\n") !== after.endsWith("\n")) {
    throw new Error(`${sourcePath}: final newline changed`);
  }
  const hadBom = beforeBuffer.length >= 3
    && beforeBuffer[0] === 0xef
    && beforeBuffer[1] === 0xbb
    && beforeBuffer[2] === 0xbf;
  if (hadBom !== (after.charCodeAt(0) === 0xfeff)) {
    throw new Error(`${sourcePath}: BOM state changed`);
  }
}

function maskHeadingRanges(markdown, headings) {
  let output = "";
  let cursor = 0;
  for (const heading of headings) {
    output += markdown.slice(cursor, heading.start);
    output += "\u0000";
    cursor = heading.end;
  }
  return output + markdown.slice(cursor);
}

function decodeUtf8(buffer, sourcePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch (error) {
    throw new Error(`${sourcePath}: invalid UTF-8`, { cause: error });
  }
}

function atomicWrite(targetPath, buffer) {
  const temporaryPath = `${targetPath}.tmp-heading-number-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, buffer);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function emptyReasonCounts() {
  return {
    chinese: 0,
    arabic: 0,
    hierarchical: 0,
    letter: 0,
    part: 0,
    step: 0,
    chineseStep: 0,
  };
}

function visit(node, callback) {
  callback(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) visit(child, callback);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function newlineStyle(markdown) {
  if (markdown.includes("\r\n")) return "crlf";
  if (markdown.includes("\r")) return "cr";
  return "lf";
}

function formatReport(value) {
  return [
    `${value.mode === "write" ? "Standardized" : "Would standardize"} ${value.changedHeadings.toLocaleString("en")} headings in ${value.changedFiles.toLocaleString("en")} of ${value.files.toLocaleString("en")} guides.`,
    `Headings: H1 ${value.h1.toLocaleString("en")}, H2 ${value.h2.toLocaleString("en")}, H3 ${value.h3.toLocaleString("en")}, H4 ${value.h4.toLocaleString("en")}.`,
    `Hierarchy corrections: ${value.releveledHeadings.toLocaleString("en")} headings; ${Object.entries(value.hierarchyCorrections).map(([key, count]) => `${key} ${count.toLocaleString("en")}`).join(", ")}.`,
    `Removed prefixes: ${Object.entries(value.removedPrefixes).map(([key, count]) => `${key} ${count.toLocaleString("en")}`).join(", ")}.`,
    `Protected semantic prefixes: ${Object.entries(value.protectedSemanticPrefixes).map(([key, count]) => `${key} ${count.toLocaleString("en")}`).join(", ")}.`,
    ...Object.entries(value.directories).map(
      ([directory, metrics]) => `${directory}: ${metrics.changedHeadings.toLocaleString("en")} headings in ${metrics.changedFiles}/${metrics.files} guides.`,
    ),
    ...value.previews.flatMap((preview) => [
      "",
      preview.file,
      ...preview.headings.map(
        (heading) => `L${heading.line} H${heading.depth} ${heading.before} -> ${heading.after}${heading.removed ? ` [${heading.removed}]` : ""}`,
      ),
    ]),
  ].join("\n");
}
