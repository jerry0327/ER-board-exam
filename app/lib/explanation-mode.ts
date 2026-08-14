import { normalizeMarkdown } from "./normalize-markdown.ts";

export type ExplanationMode = "quick" | "standard" | "full" | "raw";

const MODE_SECTIONS: Record<"quick" | "standard", Set<string>> = {
  quick: new Set(["核心理由", "選項分析"]),
  standard: new Set(["核心理由", "考場解題路徑", "選項分析", "核心知識整理", "常見陷阱與變形"]),
};

export function explanationForMode(markdown: string, mode: ExplanationMode) {
  if (mode === "raw") return markdown;
  const normalized = normalizeMarkdown(markdown);
  if (mode === "full") return normalized;

  const allowed = MODE_SECTIONS[mode];
  const lines = normalized.split("\n");
  const firstSection = lines.findIndex((line) => /^##\s+/.test(line));
  if (firstSection < 0) return normalized;

  const result: string[] = [];
  let include = false;
  for (let index = firstSection; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (heading) include = allowed.has(heading[1]);
    if (include) result.push(lines[index]);
  }
  return result.join("\n").trim();
}

export function coreReasonFromExplanation(markdown: string) {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => /^##\s+核心理由\s*$/u.test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^##\s+/u.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}
