export function plainMarkdownHeading(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .trim();
}

export function createHeadingSlugger() {
  const counts = new Map<string, number>();
  return (value: string) => {
    const base = value
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .toLocaleLowerCase() || "section";
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}

export type MarkdownOutlineItem = {
  level: 1 | 2 | 3 | 4;
  label: string;
  id: string;
};

function comparableHeadingLabel(value: string) {
  return plainMarkdownHeading(value)
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

export function markdownHeadingMatchesTitle(heading: string, title: string) {
  return comparableHeadingLabel(heading) === comparableHeadingLabel(title);
}

export function outlineStartsWithTitle(outline: MarkdownOutlineItem[], title: string) {
  return outline[0]?.level === 2
    && markdownHeadingMatchesTitle(outline[0].label.replace(/^\d+\.\s+/u, ""), title);
}

/**
 * Extract the same ATX headings that MarkdownContent renders with anchors.
 *
 * Parsing by heading level keeps the standardized H2/H3 outline and
 * unnumbered H4 topics available to every reader surface.
 */
export function extractMarkdownOutline(markdown: string, excludeDocumentTitle = true) {
  const slug = createHeadingSlugger();
  const outline: MarkdownOutlineItem[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let firstHeading = true;

  for (const line of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const match = line.match(/^(#{1,4})[\t ]+(.+?)(?:[\t ]+#+[\t ]*)?$/u);
    if (!match) continue;
    const label = plainMarkdownHeading(match[2]);
    if (!label) continue;
    const item: MarkdownOutlineItem = {
      level: match[1].length as MarkdownOutlineItem["level"],
      label,
      id: slug(label),
    };
    if (!excludeDocumentTitle || !firstHeading) outline.push(item);
    firstHeading = false;
  }

  return outline;
}
