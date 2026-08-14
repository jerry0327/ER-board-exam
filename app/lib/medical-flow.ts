export type MedicalFlowStep = {
  type: "step";
  lines: string[];
  question: boolean;
};

export type MedicalFlowConnector = {
  type: "connector";
  label: string;
};

export type MedicalFlowBranch = {
  depth: number;
  label: string;
  lines: string[];
};

export type MedicalFlowBranches = {
  type: "branches";
  branches: MedicalFlowBranch[];
  nested: boolean;
};

export type MedicalFlowPart = MedicalFlowStep | MedicalFlowConnector | MedicalFlowBranches;

const branchMarkerPattern = /(?:[├└┣┗╠╚][─━═]+|[↳⤷])/u;
const connectorPattern = /^(?:↓|⇩|⇣|⬇)(?:\s+(.+))?$/u;
const connectorRowPattern = /^(?:(?:↓|⇩|⇣|⬇)\s*){2,}$/u;
const horizontalBranchPattern = /^[\s┌┐└┘┬┴├┤─━═]+$/u;
const verticalOnlyPattern = /^[\s│┃║|]+$/u;
const sourceCodePattern = /(?:^|\n)\s*(?:import|export|function|class|const|let|var)\b|<\/?[A-Za-z][^>]*>|[{};]\s*$/mu;

function cleanFlowText(value: string) {
  return value
    .trim()
    .replace(/^(?:→|⇒|⟶)\s*/u, "")
    .trim();
}

function splitBranchContent(value: string) {
  const content = cleanFlowText(value);
  const arrow = content.match(/^(.{1,32}?)\s*(?:→|⇒|⟶)\s*(.+)$/u);
  if (arrow) return { label: arrow[1].trim(), line: arrow[2].trim() };

  const colon = content.match(/^([^：:]{1,16})[：:]\s*(.+)$/u);
  if (colon) return { label: colon[1].trim(), line: colon[2].trim() };

  return { label: "", line: content };
}

export function parseMedicalFlow(value: string): MedicalFlowPart[] | null {
  if (sourceCodePattern.test(value)) return null;

  const sourceLines = value.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trimEnd());
  const meaningfulLines = sourceLines.filter((line) => line.trim());
  const branchColumns = [...new Set(sourceLines
    .map((line) => line.search(branchMarkerPattern))
    .filter((column) => column >= 0))]
    .sort((left, right) => left - right);
  const connectorCount = sourceLines.filter((line) => connectorPattern.test(line.trim()) || connectorRowPattern.test(line.trim())).length;
  const branchCount = sourceLines.filter((line) => branchMarkerPattern.test(line)).length;
  const horizontalBranchCount = sourceLines.filter((line) => (
    horizontalBranchPattern.test(line)
    && /[┌┐└┘┬┴├┤]/u.test(line)
  )).length;
  if (
    meaningfulLines.length < 2
    || (branchCount < 2 && connectorCount < 1 && horizontalBranchCount < 1)
  ) return null;

  const parts: MedicalFlowPart[] = [];
  let pendingStep: string[] = [];
  let pendingBranches: MedicalFlowBranch[] = [];
  let lastBranchColumn = -1;
  let expectHorizontalBranches = false;

  const flushStep = () => {
    const lines = pendingStep.map(cleanFlowText).filter(Boolean);
    if (lines.length) {
      parts.push({
        type: "step",
        lines,
        question: lines.some((line) => /[?？]\s*$/u.test(line)),
      });
    }
    pendingStep = [];
  };

  const flushBranches = () => {
    if (pendingBranches.length) {
      parts.push({
        type: "branches",
        branches: pendingBranches,
        nested: pendingBranches.some((branch) => branch.depth > 0),
      });
    }
    pendingBranches = [];
    lastBranchColumn = -1;
  };

  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trim();
    if (!trimmed) continue;

    const connector = trimmed.match(connectorPattern);
    if (connector || connectorRowPattern.test(trimmed)) {
      flushStep();
      flushBranches();
      const connectorLabel = connector?.[1]?.trim() ?? "";
      const previous = parts.at(-1);
      if (previous?.type === "connector") {
        if (!previous.label && connectorLabel) previous.label = connectorLabel;
      } else {
        parts.push({ type: "connector", label: connectorLabel });
      }
      continue;
    }

    if (horizontalBranchPattern.test(sourceLine) && /[┌┐└┘┬┴├┤]/u.test(sourceLine)) {
      flushStep();
      flushBranches();
      expectHorizontalBranches = true;
      continue;
    }

    if (expectHorizontalBranches) {
      const columns = trimmed.split(/\s{2,}/u).map(cleanFlowText).filter(Boolean);
      expectHorizontalBranches = false;
      if (columns.length >= 2) {
        pendingBranches.push(...columns.map((line) => ({ depth: 0, label: "", lines: [line] })));
        flushBranches();
        continue;
      }
    }

    const markerColumn = sourceLine.search(branchMarkerPattern);
    if (markerColumn >= 0) {
      flushStep();
      const marker = sourceLine.match(branchMarkerPattern)![0];
      const { label, line } = splitBranchContent(sourceLine.slice(markerColumn + marker.length));
      pendingBranches.push({
        depth: Math.max(0, branchColumns.indexOf(markerColumn)),
        label,
        lines: line ? [line] : [],
      });
      lastBranchColumn = markerColumn;
      continue;
    }

    if (verticalOnlyPattern.test(sourceLine)) continue;

    const leadingSpaces = sourceLine.length - sourceLine.trimStart().length;
    const continuation = pendingBranches.length > 0 && (
      /^[│┃║|]/u.test(trimmed)
      || leadingSpaces > lastBranchColumn
      || /^(?:→|⇒|⟶)/u.test(trimmed)
    );
    if (continuation) {
      const line = cleanFlowText(trimmed.replace(/^[│┃║|]\s*/u, ""));
      if (line) pendingBranches.at(-1)!.lines.push(line);
      continue;
    }

    flushBranches();
    pendingStep.push(sourceLine);
  }

  flushStep();
  flushBranches();
  while (parts.at(-1)?.type === "connector") parts.pop();
  return parts.length ? parts : null;
}
