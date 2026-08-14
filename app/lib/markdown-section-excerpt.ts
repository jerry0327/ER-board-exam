import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";

export type MarkdownHeadingRange = {
  level: number;
  start: number;
  end: number;
  root: boolean;
  sectionEnd: number;
};

type MarkdownNode = {
  type: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function sourceLineStart(markdown: string, offset: number) {
  return markdown.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function collectHeadingRanges(
  node: MarkdownNode,
  headings: MarkdownHeadingRange[],
  markdown: string,
) {
  const children = node.children ?? [];
  const containerEnd = node.type === "root"
    ? markdown.length
    : node.position?.end?.offset;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (
      child.type === "heading"
      && typeof child.depth === "number"
      && Number.isInteger(start)
      && Number.isInteger(end)
    ) {
      const nextPeer = children.slice(index + 1).find((candidate) => (
        candidate.type === "heading"
        && typeof candidate.depth === "number"
        && candidate.depth <= child.depth!
        && Number.isInteger(candidate.position?.start?.offset)
      ));
      const nextStart = nextPeer?.position?.start?.offset;
      headings.push({
        level: child.depth,
        start: start as number,
        end: end as number,
        root: node.type === "root",
        sectionEnd: Number.isInteger(nextStart)
          ? sourceLineStart(markdown, nextStart as number)
          : Number.isInteger(containerEnd) ? containerEnd as number : markdown.length,
      });
    }
    collectHeadingRanges(child, headings, markdown);
  }
}

/**
 * Locate every rendered Markdown heading by walking the same mdast shape used
 * by react-markdown. Each range retains its parent container so a heading in a
 * quote or list cannot truncate an outer section or absorb content after it.
 */
export function markdownHeadingRanges(markdown: string): MarkdownHeadingRange[] {
  const headings: MarkdownHeadingRange[] = [];
  collectHeadingRanges(parser.parse(markdown) as MarkdownNode, headings, markdown);
  return headings.sort((left, right) => left.start - right.start);
}

/**
 * Capture one semantic heading section: the heading itself, all prose, lists,
 * tables and child headings below it, stopping immediately before the next
 * heading at the same or a higher level in the same Markdown container.
 */
export function markdownHeadingSection(
  markdown: string,
  headingStart: number,
  headingEnd: number,
  headingLevel: number,
  headings = markdownHeadingRanges(markdown),
) {
  const safeStart = Number.isInteger(headingStart) && headingStart >= 0
    ? Math.min(headingStart, markdown.length)
    : 0;
  const safeEnd = Number.isInteger(headingEnd) && headingEnd > safeStart
    ? Math.min(headingEnd, markdown.length)
    : safeStart;
  const current = headings.find((heading) => (
    heading.start === safeStart
    && heading.end === safeEnd
    && heading.level === headingLevel
  ));
  if (current) return markdown.slice(safeStart, current.sectionEnd).trim();

  const next = headings.find((heading) => (
    heading.start >= safeEnd
    && heading.start > safeStart
    && heading.level <= headingLevel
  ));
  const sectionEnd = next ? sourceLineStart(markdown, next.start) : markdown.length;
  return markdown.slice(safeStart, sectionEnd).trim();
}
