import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = [path.resolve(projectRoot, ".."), path.resolve(projectRoot, "..", "..")]
  .find((candidate) => fs.existsSync(path.join(candidate, "outputs", "02_learning_guides")))
  ?? path.resolve(projectRoot, "..");
const write = process.argv.includes("--write");
const previewLabels = new Set(process.argv
  .filter((argument) => argument.startsWith("--preview="))
  .map((argument) => argument.slice("--preview=".length).replaceAll("\\", "/")));
const sourceDirectories = [
  path.join(workspaceRoot, "outputs", "02_learning_guides", "tintinalli-concise"),
  path.join(workspaceRoot, "outputs", "02_learning_guides", "tintinalli-detailed"),
  path.join(workspaceRoot, "outputs", "02_learning_guides", "rosens"),
];
const targetedLabels = new Set([
  "tintinalli-concise/tintinalli-CH028-concise-full.md",
  "tintinalli-concise/tintinalli-CH084-concise-full.md",
  "tintinalli-detailed/tintinalli-CH001-detailed-full.md",
  "tintinalli-detailed/tintinalli-CH044-detailed-full.md",
  "tintinalli-detailed/tintinalli-CH302-detailed-full.md",
  "rosens/rosens-CH001-full.md",
  "rosens/rosens-CH012-full.md",
  "rosens/rosens-CH079-full.md",
  "rosens/rosens-CH103-full.md",
  "rosens/rosens-CH127-full.md",
]);
const referenceDefinitionPattern = /^\s*\[[^\]]+\]:\s+\S+/u;

const report = {
  mode: write ? "write" : "check",
  files: 0,
  changedFiles: 0,
  targetedFiles: 0,
  targetedLineChanges: 0,
  legacyVocabularyChanges: 0,
  changesByDirectory: {},
  previews: [],
};

for (const directory of sourceDirectories) {
  const directoryName = path.basename(directory);
  const files = fs.readdirSync(directory)
    .filter((name) => /^(?:tintinalli-CH\d{3}-(?:concise|detailed)|rosens-CH\d{3})-full\.md$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const directoryReport = {
    files: files.length,
    changedFiles: 0,
    targetedFiles: 0,
    legacyVocabularyChanges: 0,
  };
  report.changesByDirectory[directoryName] = directoryReport;

  for (const filename of files) {
    const sourcePath = path.join(directory, filename);
    const before = fs.readFileSync(sourcePath, "utf8");
    const label = `${directoryName}/${filename}`;
    const metrics = {
      targetedLineChanges: 0,
      legacyVocabularyChanges: 0,
    };
    const after = refineDocument(before, label, metrics);

    verifyProtectedContent(before, after, label);
    const secondPass = refineDocument(after, label, {
      targetedLineChanges: 0,
      legacyVocabularyChanges: 0,
    });
    if (secondPass !== after) {
      throw new Error(`${label}: refinement is not idempotent`);
    }
    if (!targetedLabels.has(label)) {
      if (after !== before) {
        throw new Error(`${label}: non-targeted file changed`);
      }
    }

    report.files += 1;
    report.targetedLineChanges += metrics.targetedLineChanges;
    report.legacyVocabularyChanges += metrics.legacyVocabularyChanges;
    directoryReport.legacyVocabularyChanges += metrics.legacyVocabularyChanges;
    if (metrics.targetedLineChanges) {
      report.targetedFiles += 1;
      directoryReport.targetedFiles += 1;
    }
    if (after !== before) {
      report.changedFiles += 1;
      directoryReport.changedFiles += 1;
      if (write) atomicWrite(sourcePath, after);
    }
    if (previewLabels.has(label)) {
      report.previews.push({
        file: label,
        before: previewExcerpt(before),
        after: previewExcerpt(after),
      });
    }
  }
}

if (report.files !== 814) throw new Error(`Expected 814 source guides, found ${report.files}`);

console.log([
  `${write ? "Refined" : "Would refine"} ${report.changedFiles}/${report.files} files.`,
  `Targeted editorial changes: ${report.targetedLineChanges} lines in ${report.targetedFiles} files.`,
  `Reader-facing legacy vocabulary replacements: ${report.legacyVocabularyChanges}.`,
  ...Object.entries(report.changesByDirectory).map(
    ([directory, metrics]) => `${directory}: ${metrics.changedFiles}/${metrics.files} files; ${metrics.targetedFiles} targeted; ${metrics.legacyVocabularyChanges} vocabulary replacements.`,
  ),
  ...report.previews.flatMap((preview) => [
    "",
    `${preview.file} BEFORE`,
    preview.before,
    `${preview.file} AFTER`,
    preview.after,
  ]),
].join("\n"));

function refineDocument(markdown, label, metrics) {
  if (!targetedLabels.has(label)) return markdown;
  const newline = markdown.includes("\r\n") ? "\r\n" : markdown.includes("\r") ? "\r" : "\n";
  const endedWithNewline = markdown.endsWith("\n") || markdown.endsWith("\r");
  let lines = markdown.split(/\r\n|\n|\r/u);
  if (endedWithNewline && lines.at(-1) === "") lines.pop();

  lines = applyTargetedOverrides(lines, label, metrics);
  if (targetedLabels.has(label)) lines = cleanTargetedSpacing(lines);
  return lines.join(newline) + (endedWithNewline ? newline : "");
}

function applyTargetedOverrides(lines, label, metrics) {
  if (label === "tintinalli-detailed/tintinalli-CH001-detailed-full.md") {
    return lines.map((line) => {
      if (/^>\s*\*\*來源定位\*\*/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return "> **核心重點**：EMS 系統的 15 項必要功能（Table 1-1）。";
      }
      if (/^>\s*\*\*適用性提醒\*\*/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return "> **制度適用範圍**：9-1-1、NHTSA provider levels、EMTALA、HIPAA、Medicare／Medicaid／Affordable Care Act 與 ABEM subspecialty 屬美國制度；法定職權、轉送規範與復甦流程依所在地現行規範執行。";
      }
      return line;
    });
  }

  if (label === "tintinalli-concise/tintinalli-CH028-concise-full.md") {
    return removeExactSection(lines, "第 28 章來源與審閱紀錄", metrics);
  }

  if (label === "tintinalli-concise/tintinalli-CH084-concise-full.md") {
    return removeExactSection(lines, "來源、頁界與視覺審閱紀錄", metrics);
  }

  if (label === "tintinalli-detailed/tintinalli-CH044-detailed-full.md") {
    return lines.flatMap((line) => {
      if (/^本章涵蓋 \*\*Tintinalli’s Emergency Medicine, 9th ed\./u.test(line)) {
        const rewritten = line.replace(/^本章涵蓋 \*\*Tintinalli’s Emergency Medicine, 9th ed\.，Section 6，Chapter 44，print pp\.299–307\*\*。\s*/u, "");
        metrics.targetedLineChanges += 1;
        return [rewritten];
      }
      if (/^ {0,3}#{1,6}\s+原章圖表整合與完整性紀錄\s*$/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [line.replace(/原章圖表整合與完整性紀錄/u, "圖像解剖與臨床意義")];
      }
      if (/^本章 print pp\.299–307 已逐頁檢視/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [];
      }
      return [line];
    });
  }

  if (label === "tintinalli-detailed/tintinalli-CH302-detailed-full.md") {
    return lines.flatMap((line) => {
      if (/^\*\*來源範圍[：:]\*\*/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [];
      }
      if (/^>\s*\*\*版本定位[：:]\*\*/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return ["> **臨床更新重點**：Needle decompression 規格與位置、TXA regimen、whole-blood logistics、Hextend、抗生素包及其他 operational protocols，依現行 CoTCCC／Joint Trauma System protocol、指揮體系及產品說明執行。"];
      }
      return [line];
    });
  }

  if (label === "rosens/rosens-CH001-full.md") {
    return lines.flatMap((line) => {
      if (/^>\s*以下統計、器材選擇與治療建議/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return ["> 藥物劑量依病人體重、hemodynamics、器官功能與院內 protocol 個別化。"];
      }
      if (/^ {0,3}#{1,6}\s+來源影像與排印校勘\s*$/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [line.replace(/來源影像與排印校勘/u, "圖表重點與內容校正")];
      }
      if (/^\s*[*+-]\s+Figures 1\.1–1\.16/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [];
      }
      if (/^\s*[*+-]\s+原章正文對Figures 1\.17–1\.19/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return ["* **圖像對照**：Figures 1.17–1.19 依 caption 的正確對照為："];
      }
      if (/^\s*[*+-]\s+原章未附actual reference list/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [];
      }
      return [line];
    });
  }

  if (label === "rosens/rosens-CH012-full.md") {
    return lines.map((line) => {
      if (!/^>\s*\*\*版本提醒[：:]\*\*/u.test(line)) return line;
      metrics.targetedLineChanges += 1;
      return "> **臨床更新重點**：Table 12.1 是「辨識線索＋初始處置」摘要，並非完整治療 protocol；antidote、dialysis、vasopressor、high-dose insulin、thrombolysis 與 temperature control，依病人狀況及現行 local guideline 調整。疑似單位錯誤、文字矛盾或版本敏感內容已在相應段落標示。";
    });
  }

  if (label === "rosens/rosens-CH079-full.md") {
    return lines.flatMap((line) => {
      if (/^\*Acute Appendicitis — Rosen’s Emergency Medicine, Chapter 79\*$/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [];
      }
      if (/^ {0,3}#{1,6}\s+來源限制與實務提醒\s*$/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return [line.replace(/來源限制與實務提醒/u, "內容校正與臨床更新")];
      }
      if (/^本章輸出 PDF 中，表 79\.2/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return ["AIR score 的 CRP 單位顯示為 g/L，疑似單位或排印錯誤。"];
      }
      if (/^以上數據與藥物方案反映本章及其引用年代/u.test(line)) {
        metrics.targetedLineChanges += 1;
        return ["Antibiotic selection、NOM criteria、radiation protocol、pregnancy imaging 與 operative timing，應依現行院內及相關專科指引調整。"];
      }
      return [line];
    });
  }

  if (label === "rosens/rosens-CH103-full.md") {
    return lines.map((line) => {
      if (!/^>\s*本章中的 diagnostic-performance values/u.test(line)) return line;
      metrics.targetedLineChanges += 1;
      return "> Diagnostic-performance values、relative risks、antibiotic regimens 與治療效果受研究族群、年代及制度差異影響，應結合個別臨床情境與現行指引判讀。";
    });
  }

  if (label === "rosens/rosens-CH127-full.md") {
    const withoutLimitations = removeExactSection(lines, "十四、PDF 可及性限制", metrics);
    return withoutLimitations.map((line) => {
      if (!/^13\.\s+原鑑別表將/u.test(line)) return line;
      metrics.targetedLineChanges += 1;
      return line.replace(/^13\.\s+原鑑別表將/u, "13. 鑑別表將");
    });
  }

  return lines;
}

function cleanTargetedSpacing(lines) {
  const output = [];
  for (const line of lines) {
    if (!line.trim() && !output.at(-1)?.trim()) continue;
    output.push(line);
  }
  while (output.length && !output.at(-1).trim()) output.pop();
  while (output.length && /^\s*(?:---+|\*\*\*+|___+)\s*$/u.test(output.at(-1))) {
    output.pop();
    while (output.length && !output.at(-1).trim()) output.pop();
  }
  return output;
}

function removeExactSection(lines, title, metrics) {
  const sectionIndex = findExactHeading(lines, title);
  if (sectionIndex < 0) return lines;
  const end = findSectionEnd(lines, sectionIndex);
  metrics.targetedLineChanges += end - sectionIndex;
  return [...lines.slice(0, sectionIndex), ...lines.slice(end)];
}

function findExactHeading(lines, title) {
  return lines.findIndex((line) => {
    const heading = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)\s*$/u);
    return heading?.[1] === title;
  });
}

function findSectionEnd(lines, sectionIndex) {
  const heading = lines[sectionIndex].match(/^ {0,3}(#{1,6})[ \t]+/u);
  if (!heading) return sectionIndex + 1;
  const level = heading[1].length;
  let end = sectionIndex + 1;
  while (end < lines.length) {
    const nextHeading = lines[end].match(/^ {0,3}(#{1,6})[ \t]+/u);
    if (nextHeading && nextHeading[1].length <= level) break;
    end += 1;
  }
  return end;
}

function verifyProtectedContent(before, after, label) {
  const beforeFences = extractFencedBlocks(before);
  const afterFences = extractFencedBlocks(after);
  if (JSON.stringify(beforeFences) !== JSON.stringify(afterFences)) {
    throw new Error(`${label}: fenced code block changed`);
  }

  const beforeDefinitions = extractReferenceDefinitions(before);
  const afterDefinitions = extractReferenceDefinitions(after);
  if (JSON.stringify(beforeDefinitions) !== JSON.stringify(afterDefinitions)) {
    throw new Error(`${label}: link reference definition changed`);
  }
}

function extractFencedBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r\n|\n|\r/u);
  let openFence = null;
  let block = [];
  for (const line of lines) {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (!openFence && opening) {
      openFence = { character: opening[1][0], length: opening[1].length };
      block = [line];
      continue;
    }
    if (!openFence) continue;
    block.push(line);
    const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/u);
    if (closing && closing[1][0] === openFence.character && closing[1].length >= openFence.length) {
      blocks.push(block.join("\n"));
      openFence = null;
      block = [];
    }
  }
  if (openFence) blocks.push(block.join("\n"));
  return blocks;
}

function extractReferenceDefinitions(markdown) {
  return markdown
    .split(/\r\n|\n|\r/u)
    .filter((line) => referenceDefinitionPattern.test(line));
}

function previewExcerpt(markdown) {
  const lines = markdown.split(/\r\n|\n|\r/u);
  return [
    ...lines.slice(0, 12),
    ...(lines.length > 24 ? ["…"] : []),
    ...lines.slice(-12),
  ].join("\n");
}

function atomicWrite(targetPath, markdown) {
  const temporaryPath = `${targetPath}.tmp-editorial-refine-${process.pid}`;
  fs.writeFileSync(temporaryPath, markdown, "utf8");
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(temporaryPath, targetPath);
}
