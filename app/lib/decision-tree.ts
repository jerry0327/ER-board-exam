export type DecisionTreeRow = {
  level: number;
  label: string;
  outcome: string;
  terminal: boolean;
};

const branchMarker = /[├└]─/u;

export function parseDecisionTree(value: string): DecisionTreeRow[] | null {
  const lines = value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !/^[│\s]+$/u.test(line));
  if (lines.filter((line) => branchMarker.test(line)).length < 2) return null;

  return lines.map((line, index) => {
    const marker = line.search(branchMarker);
    const prefix = marker >= 0 ? line.slice(0, marker) : "";
    const content = (marker >= 0 ? line.slice(marker + 2) : line).trim();
    const [label, ...outcomeParts] = content.split(/\s*→\s*/u);
    const outcome = outcomeParts.join(" → ").trim();
    const level = marker < 0 ? 0 : Math.max(1, Math.round(prefix.replace(/│/gu, " ").length / 3) + 1);
    return {
      level,
      label: label.trim(),
      outcome,
      terminal: Boolean(outcome) || (index === lines.length - 1),
    };
  });
}
