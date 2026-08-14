import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = [path.resolve(projectRoot, ".."), path.resolve(projectRoot, "..", "..")]
  .find((candidate) => fs.existsSync(path.join(candidate, "outputs", "02_learning_guides")))
  ?? path.resolve(projectRoot, "..");
const write = process.argv.includes("--write");
const json = process.argv.includes("--json");
const previewLabels = new Set(process.argv
  .filter((argument) => argument.startsWith("--preview="))
  .map((argument) => argument.slice("--preview=".length).replaceAll("\\", "/")));
const requestedDirectories = process.argv
  .filter((argument) => argument.startsWith("--directory="))
  .map((argument) => path.resolve(workspaceRoot, argument.slice("--directory=".length)));
const sourceDirectories = requestedDirectories.length
  ? requestedDirectories
  : [
      path.join(workspaceRoot, "outputs", "02_learning_guides", "tintinalli-concise"),
      path.join(workspaceRoot, "outputs", "02_learning_guides", "tintinalli-detailed"),
      path.join(workspaceRoot, "outputs", "02_learning_guides", "rosens"),
    ];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const simpleLetterPattern = /^\s*(?:\(?[A-Z]\)?[.．、:：)]|[A-Z]\s*[：:])\s*/u;
const stagedMarkerPattern = /^\s*(Phase|Step)\s+(?:\d+|[IVXLCDM]+)\b/iu;

const report = {
  mode: write ? "write" : "check",
  files: 0,
  changedFiles: 0,
  headings: 0,
  changedHeadings: 0,
  blockquoteHeadings: 0,
  normalizedBlockquoteHeadings: 0,
  before: emptyLevelCounts(),
  after: emptyLevelCounts(),
  filesWithMultipleH1Before: [],
  filesWithMultipleH1After: [],
  filesWithJumpsBefore: [],
  filesWithJumpsAfter: [],
  maxLevelBefore: 0,
  maxLevelAfter: 0,
  changesByDirectory: {},
  semanticReparents: [],
  previews: [],
};

for (const directory of sourceDirectories) {
  if (!fs.existsSync(directory)) throw new Error(`Source directory does not exist: ${directory}`);
  const files = fs.readdirSync(directory)
    .filter((name) => /^(?:tintinalli-CH\d{3}-(?:concise|detailed)|rosens-CH\d{3})-full\.md$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!files.length) throw new Error(`No chapter Markdown files found: ${directory}`);

  const directoryName = path.basename(directory);
  const directoryReport = {
    files: files.length,
    changedFiles: 0,
    headings: 0,
    changedHeadings: 0,
    blockquoteHeadings: 0,
    normalizedBlockquoteHeadings: 0,
  };
  report.changesByDirectory[directoryName] = directoryReport;

  for (const filename of files) {
    const sourcePath = path.join(directory, filename);
    const beforeBuffer = fs.readFileSync(sourcePath);
    const before = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(beforeBuffer);
    const parsed = parseMarkdown(before);
    const normalized = normalizeHierarchy(parsed.headings);
    const after = applyHeadingLevels(
      before,
      parsed.headings,
      normalized.levels,
      parsed.blockquoteHeadings,
    );

    verifyInvariant({
      sourcePath,
      before,
      after,
      beforeBuffer,
      headings: parsed.headings,
      expectedLevels: normalized.levels,
      fences: parsed.fences,
      blockquoteHeadings: parsed.blockquoteHeadings,
    });

    const beforeLevels = parsed.headings.map((heading) => heading.level);
    const afterLevels = normalized.levels;
    const changedHeadings = afterLevels.reduce(
      (count, level, index) => count + Number(level !== beforeLevels[index]),
      0,
    );
    const beforeH1 = beforeLevels.filter((level) => level === 1).length;
    const afterH1 = afterLevels.filter((level) => level === 1).length;
    const beforeJumps = countForwardJumps(beforeLevels);
    const afterJumps = countForwardJumps(afterLevels);
    const label = `${directoryName}/${filename}`;
    if (previewLabels.has(label)) {
      report.previews.push({
        file: label,
        headings: parsed.headings.map((heading, index) => ({
          line: heading.line,
          before: heading.level,
          after: afterLevels[index],
          title: heading.title,
        })),
      });
    }

    report.files += 1;
    report.headings += parsed.headings.length;
    report.changedHeadings += changedHeadings;
    report.blockquoteHeadings += parsed.blockquoteHeadings.length;
    report.normalizedBlockquoteHeadings += parsed.blockquoteHeadings.length;
    directoryReport.headings += parsed.headings.length;
    directoryReport.changedHeadings += changedHeadings;
    directoryReport.blockquoteHeadings += parsed.blockquoteHeadings.length;
    directoryReport.normalizedBlockquoteHeadings += parsed.blockquoteHeadings.length;
    if (changedHeadings || parsed.blockquoteHeadings.length) {
      report.changedFiles += 1;
      directoryReport.changedFiles += 1;
    }
    if (beforeH1 > 1) report.filesWithMultipleH1Before.push({ file: label, count: beforeH1 });
    if (afterH1 > 1) report.filesWithMultipleH1After.push({ file: label, count: afterH1 });
    if (beforeJumps) report.filesWithJumpsBefore.push({ file: label, count: beforeJumps });
    if (afterJumps) report.filesWithJumpsAfter.push({ file: label, count: afterJumps });

    for (const level of beforeLevels) {
      report.before[`h${level}`] += 1;
      report.maxLevelBefore = Math.max(report.maxLevelBefore, level);
    }
    for (const level of afterLevels) {
      report.after[`h${level}`] += 1;
      report.maxLevelAfter = Math.max(report.maxLevelAfter, level);
    }

    for (const reparent of normalized.semanticReparents) {
      report.semanticReparents.push({
        file: label,
        line: parsed.headings[reparent.index].line,
        title: parsed.headings[reparent.index].title,
        kind: reparent.kind,
        parentLine: reparent.parentIndex === null
          ? null
          : parsed.headings[reparent.parentIndex].line,
        targetLevel: afterLevels[reparent.index],
      });
    }

    if (write && after !== before) atomicWrite(sourcePath, Buffer.from(after, "utf8"));
  }
}

if (report.filesWithMultipleH1After.length) {
  throw new Error(`Normalization left files with multiple H1: ${JSON.stringify(report.filesWithMultipleH1After)}`);
}
if (report.filesWithJumpsAfter.length) {
  throw new Error(`Normalization left heading jumps: ${JSON.stringify(report.filesWithJumpsAfter)}`);
}
if (report.maxLevelAfter > 4) throw new Error(`Normalization exceeded H4: H${report.maxLevelAfter}`);

const output = json
  ? JSON.stringify(report, null, 2)
  : [
      `${write ? "Normalized" : "Would normalize"} ${report.changedHeadings.toLocaleString("en")} headings in ${report.changedFiles.toLocaleString("en")} of ${report.files.toLocaleString("en")} files.`,
      `Before H1–H6: ${formatCounts(report.before)}.`,
      `After H1–H6: ${formatCounts(report.after)}.`,
      `Multiple-H1 files: ${report.filesWithMultipleH1Before.length} → ${report.filesWithMultipleH1After.length}.`,
      `Files with forward jumps: ${report.filesWithJumpsBefore.length} → ${report.filesWithJumpsAfter.length}.`,
      `Maximum level: H${report.maxLevelBefore} → H${report.maxLevelAfter}.`,
      `Semantic H1 reparents: ${report.semanticReparents.length}.`,
      `Blockquote headings converted to callouts: ${report.normalizedBlockquoteHeadings}.`,
      ...Object.entries(report.changesByDirectory).map(
        ([directory, metrics]) => `${directory}: ${metrics.changedHeadings} structural headings and ${metrics.normalizedBlockquoteHeadings} callouts in ${metrics.changedFiles}/${metrics.files} files.`,
      ),
      ...report.previews.flatMap((preview) => [
        "",
        preview.file,
        ...preview.headings.map(
          (heading) => `L${heading.line} H${heading.before}→H${heading.after} ${heading.title}`,
        ),
      ]),
    ].join("\n");
console.log(output);

function parseMarkdown(markdown) {
  const headings = [];
  const blockquoteHeadings = [];
  const fences = [];
  let offset = 0;
  let lineNumber = 1;
  let openFence = null;
  let previousLine = null;
  const linePattern = /.*(?:\r\n|\n|\r|$)/gu;

  for (const match of markdown.matchAll(linePattern)) {
    const rawLine = match[0];
    if (!rawLine) continue;
    const content = rawLine.replace(/(?:\r\n|\n|\r)$/u, "");
    const opening = content.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (!openFence && opening) {
      openFence = {
        character: opening[1][0],
        length: opening[1].length,
        start: offset,
      };
      previousLine = null;
      offset += rawLine.length;
      lineNumber += 1;
      continue;
    }
    if (openFence) {
      const closing = content.match(/^ {0,3}(`+|~+)[ \t]*$/u);
      if (
        closing
        && closing[1][0] === openFence.character
        && closing[1].length >= openFence.length
      ) {
        fences.push({ start: openFence.start, end: offset + rawLine.length });
        openFence = null;
      }
      previousLine = null;
      offset += rawLine.length;
      lineNumber += 1;
      continue;
    }

    const blockquoteHeading = content.match(/^( {0,3}>[ \t]?)(#{1,6})(?:[ \t]+(.*)|$)/u);
    if (blockquoteHeading) {
      blockquoteHeadings.push({
        line: lineNumber,
        start: offset,
        end: offset + content.length,
        containerPrefix: blockquoteHeading[1],
        body: blockquoteHeading[3] ?? "",
      });
    }
    const heading = content.match(/^( {0,3})(#{1,6})(?:([ \t]+)(.*)|$)/u);
    if (heading) {
      const title = (heading[4] ?? "")
        .replace(/[ \t]+#+[ \t]*$/u, "")
        .trim();
      headings.push({
        kind: "atx",
        line: lineNumber,
        offset: offset + heading[1].length,
        level: heading[2].length,
        prefixLength: heading[2].length,
        prefix: heading[2],
        suffix: content.slice(heading[1].length + heading[2].length),
        title,
      });
    }
    const setext = content.match(/^ {0,3}(=+)[ \t]*$/u);
    if (
      setext
      && previousLine
      && previousLine.content.trim()
      && !previousLine.isAtx
    ) {
      const indentation = previousLine.content.match(/^ {0,3}/u)?.[0] ?? "";
      headings.push({
        kind: "setext",
        line: previousLine.line,
        underlineLine: lineNumber,
        offset: previousLine.offset + indentation.length,
        underlineOffset: offset,
        underlineLength: content.length,
        level: 1,
        prefixLength: 0,
        prefix: "",
        suffix: previousLine.content.slice(indentation.length),
        title: previousLine.content.trim(),
      });
    }
    previousLine = content.trim()
      ? {
          content,
          line: lineNumber,
          offset,
          isAtx: Boolean(heading),
        }
      : null;
    offset += rawLine.length;
    lineNumber += 1;
  }
  if (openFence) fences.push({ start: openFence.start, end: markdown.length });
  if (!headings.length) throw new Error("Markdown file has no ATX headings");
  return { headings, blockquoteHeadings, fences };
}

function normalizeHierarchy(headings) {
  const originalParents = buildOriginalParents(headings);
  const parents = [...originalParents];
  const semanticReparents = [];
  let latestMajor = null;
  let latestIntermediate = null;

  parents[0] = null;
  for (let index = 1; index < headings.length; index += 1) {
    const heading = headings[index];
    if (heading.kind === "setext") {
      let parentIndex = index - 1;
      while (parentIndex > 0 && headings[parentIndex].kind === "setext") parentIndex -= 1;
      parents[index] = parentIndex;
      semanticReparents.push({ index, parentIndex, kind: "setext-detail" });
      continue;
    }
    if (heading.level === 1) {
      const kind = semanticRootKind(heading.title);
      if (kind === "letter") {
        const parentIndex = latestIntermediate ?? latestMajor ?? 0;
        parents[index] = parentIndex;
        semanticReparents.push({ index, parentIndex, kind });
        continue;
      }
      if (kind === "staged") {
        const latestMajorKind = latestMajor === null
          ? null
          : semanticRootKind(headings[latestMajor].title);
        if (latestMajor !== null && latestMajorKind === "major" && headings[latestMajor].level === 1) {
          parents[index] = latestMajor;
          latestIntermediate = index;
          semanticReparents.push({ index, parentIndex: latestMajor, kind });
        } else {
          parents[index] = 0;
          latestMajor = index;
          latestIntermediate = null;
          semanticReparents.push({ index, parentIndex: 0, kind: "major" });
        }
        continue;
      }

      parents[index] = 0;
      latestMajor = index;
      latestIntermediate = null;
      semanticReparents.push({ index, parentIndex: 0, kind: "major" });
      continue;
    }

    if (originalParents[index] === 0) {
      latestMajor = index;
      latestIntermediate = null;
    }
  }

  const levels = new Array(headings.length).fill(1);
  for (let index = 1; index < headings.length; index += 1) {
    const parentIndex = parents[index] ?? 0;
    if (parentIndex >= index) throw new Error(`Invalid heading parent at index ${index}`);
    levels[index] = Math.min(4, levels[parentIndex] + 1);
  }
  return { levels, parents, semanticReparents };
}

function buildOriginalParents(headings) {
  const parents = new Array(headings.length).fill(null);
  const stack = [];
  for (let index = 0; index < headings.length; index += 1) {
    const level = hierarchyInputLevel(headings[index]);
    while (stack.length && hierarchyInputLevel(headings[stack.at(-1)]) >= level) stack.pop();
    parents[index] = stack.length ? stack.at(-1) : null;
    stack.push(index);
  }
  return parents;
}

function hierarchyInputLevel(heading) {
  return heading.kind === "setext" ? 4 : heading.level;
}

function semanticRootKind(title) {
  if (simpleLetterPattern.test(title)) return "letter";
  if (stagedMarkerPattern.test(title)) return "staged";
  return "major";
}

function applyHeadingLevels(markdown, headings, levels, blockquoteHeadings) {
  const edits = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (heading.kind === "setext") {
      edits.push({
        start: heading.offset,
        end: heading.offset,
        replacement: `${"#".repeat(levels[index])} `,
      });
      edits.push({
        start: heading.underlineOffset,
        end: heading.underlineOffset + heading.underlineLength,
        replacement: "",
      });
    } else {
      edits.push({
        start: heading.offset,
        end: heading.offset + heading.prefixLength,
        replacement: "#".repeat(levels[index]),
      });
    }
  }
  for (const callout of blockquoteHeadings) {
    edits.push({
      start: callout.start,
      end: callout.end,
      replacement: formatBlockquoteCallout(callout),
    });
  }
  return applyEdits(markdown, edits);
}

function formatBlockquoteCallout(callout) {
  const body = callout.body
    .replace(/[ \t]+#+[ \t]*$/u, "")
    .trim();
  const formattedBody = /^\*\*[\s\S]+\*\*$/u.test(body) ? body : `**${body}**`;
  return `${callout.containerPrefix}${formattedBody}`;
}

function applyEdits(markdown, edits) {
  let output = "";
  let cursor = 0;
  for (const edit of edits.sort((left, right) => left.start - right.start || left.end - right.end)) {
    if (edit.start < cursor) throw new Error("Overlapping heading syntax edits");
    output += markdown.slice(cursor, edit.start);
    output += edit.replacement;
    cursor = edit.end;
  }
  return output + markdown.slice(cursor);
}

function verifyInvariant({
  sourcePath,
  before,
  after,
  beforeBuffer,
  headings,
  expectedLevels,
  fences,
  blockquoteHeadings,
}) {
  const afterBuffer = Buffer.from(after, "utf8");
  const parsedAfter = parseMarkdown(after);
  if (parsedAfter.headings.length !== headings.length) {
    throw new Error(`${sourcePath}: heading count changed`);
  }
  const expectedByteDelta = expectedLevels.reduce((delta, level, index) => {
    const heading = headings[index];
    return heading.kind === "setext"
      ? delta + level + 1 - heading.underlineLength
      : delta + level - heading.level;
  }, 0) + blockquoteHeadings.reduce(
    (delta, callout) => delta + formatBlockquoteCallout(callout).length - (callout.end - callout.start),
    0,
  );
  if (afterBuffer.length - beforeBuffer.length !== expectedByteDelta) {
    throw new Error(`${sourcePath}: byte delta does not match heading-prefix changes`);
  }
  for (let index = 0; index < headings.length; index += 1) {
    const beforeHeading = headings[index];
    const afterHeading = parsedAfter.headings[index];
    if (
      beforeHeading.line !== afterHeading.line
      || beforeHeading.title !== afterHeading.title
      || (beforeHeading.kind === "atx" && beforeHeading.suffix !== afterHeading.suffix)
      || afterHeading.kind !== "atx"
      || afterHeading.level !== expectedLevels[index]
    ) {
      throw new Error(`${sourcePath}: heading text or order changed at index ${index}`);
    }
  }
  if (expectedAfterByLine(before, headings, expectedLevels, blockquoteHeadings) !== after) {
    throw new Error(`${sourcePath}: bytes outside heading syntax changed`);
  }
  if (newlineStyle(before) !== newlineStyle(after)) throw new Error(`${sourcePath}: newline style changed`);
  if (before.charCodeAt(0) !== after.charCodeAt(0)) throw new Error(`${sourcePath}: BOM state changed`);
  if (before.endsWith("\n") !== after.endsWith("\n")) throw new Error(`${sourcePath}: final newline changed`);

  if (fences.length !== parsedAfter.fences.length) throw new Error(`${sourcePath}: fence count changed`);
  for (let index = 0; index < fences.length; index += 1) {
    const beforeFence = fences[index];
    const afterFence = parsedAfter.fences[index];
    if (
      sha256(before.slice(beforeFence.start, beforeFence.end))
      !== sha256(after.slice(afterFence.start, afterFence.end))
    ) {
      throw new Error(`${sourcePath}: fenced block changed`);
    }
  }
}

function expectedAfterByLine(markdown, headings, levels, blockquoteHeadings) {
  const lines = markdown.match(/.*(?:\r\n|\n|\r|$)/gu).filter(Boolean);
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const levelPrefix = "#".repeat(levels[index]);
    if (heading.kind === "setext") {
      lines[heading.line - 1] = lines[heading.line - 1].replace(
        /^( {0,3})/u,
        `$1${levelPrefix} `,
      );
      lines[heading.underlineLine - 1] = lines[heading.underlineLine - 1].replace(
        /^(?:.*?)(\r\n|\n|\r)?$/u,
        "$1",
      );
    } else {
      lines[heading.line - 1] = lines[heading.line - 1].replace(
        /^( {0,3})#{1,6}/u,
        `$1${levelPrefix}`,
      );
    }
  }
  for (const callout of blockquoteHeadings) {
    lines[callout.line - 1] = lines[callout.line - 1].replace(
      /^(.*?)(\r\n|\n|\r)?$/u,
      `${formatBlockquoteCallout(callout)}$2`,
    );
  }
  return lines.join("");
}

function countForwardJumps(levels) {
  let count = 0;
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] - levels[index - 1] > 1) count += 1;
  }
  return count;
}

function newlineStyle(markdown) {
  if (markdown.includes("\r\n")) return "crlf";
  if (markdown.includes("\r")) return "cr";
  return "lf";
}

function emptyLevelCounts() {
  return { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
}

function formatCounts(counts) {
  return Object.entries(counts).map(([level, count]) => `${level.toUpperCase()} ${count}`).join(", ");
}

function atomicWrite(targetPath, buffer) {
  const temporaryPath = `${targetPath}.tmp-heading-normalize-${process.pid}`;
  fs.writeFileSync(temporaryPath, buffer);
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(temporaryPath, targetPath);
}
