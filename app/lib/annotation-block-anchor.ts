import type { AnnotationExcerptRequest, StudyAnnotation } from "./types";
import { markdownHeadingRanges, markdownHeadingSection } from "./markdown-section-excerpt.ts";

const METADATA_PREFIX = "source-block:";
const PREFIX_FIELD_LIMIT = 80;
const safeAnchorPattern = /^annotation-(?:heading|table)-[a-z0-9]+-[a-z0-9]+$/u;
const safeScopePattern = /^[a-z0-9_-]{1,24}$/u;

function normalizedExcerpt(markdown: string) {
  return markdown.replace(/\r\n?/gu, "\n").trim();
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function blockIdentity(block: AnnotationExcerptRequest["block"], markdown: string) {
  const normalized = normalizedExcerpt(markdown);
  if (block !== "heading") return normalized;
  const lines = normalized.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const candidate = lines[index].replace(/^(?: {0,3}>[\t ]?)+/u, "");
    if (/^(?: {0,3})(?:=+|-+)[\t ]*$/u.test(candidate)) {
      return lines.slice(0, index + 1).join("\n").trim();
    }
    if (!candidate.trim()) break;
  }
  return lines[0].trim();
}

function headingTitle(markdown: string) {
  const identity = blockIdentity("heading", markdown);
  const lines = identity.split("\n");
  const atx = /^(?:(?: {0,3}>[\t ]?)+)? {0,3}#{1,6}[\t ]+(.+?)(?:[\t ]+#+[\t ]*)?$/u.exec(lines[0]);
  if (atx) return atx[1].trim();

  const underlineIndex = lines.findIndex((line, index) => index > 0
    && /^(?:(?: {0,3}>[\t ]?)+)? {0,3}(?:=+|-+)[\t ]*$/u.test(line));
  if (underlineIndex > 0) {
    return lines
      .slice(0, underlineIndex)
      .map((line) => line.replace(/^(?: {0,3}>[\t ]?)+/u, "").trim())
      .join(" ")
      .trim();
  }
  return lines[0].trim();
}

const structuralChinesePrefixPattern = /^[零〇一二三四五六七八九十百千兩]+[、．.][\t \u3000]*/u;
const structuralDecimalPrefixPattern = /^\d+(?:\.\d+)+(?:[.．、)]?[\t \u3000]+|[.．、)])/u;
const structuralArabicPrefixPattern = /^(?:\(\d+\)|\d+[.．、])[\t \u3000]+/u;
const structuralStepPrefixPattern = /^(?:step[\t \u3000]+\d+|part[\t \u3000]+(?:\d+|[A-G]|VIII|VII|VI|IV|V|III|II|I))(?:[.．、:：)]?[\t \u3000]+|[.．、:：)])/iu;
const structuralChineseStepPrefixPattern = /^第[\t \u3000]*(?:\d+|[零〇一二三四五六七八九十百千兩]+)[\t \u3000]*步[\t \u3000]*(?:[：:、．.][\t \u3000]*)?/u;
const structuralLetterPrefixPattern = /^([A-Z])[.．、)]([\t \u3000]+)(.+)$/u;
const semanticTaxonPrefixPattern = /^(?:C\.[\t \u3000]*difficile|E\.[\t \u3000]*coli|H\.[\t \u3000]*pylori|K\.[\t \u3000]*kingae|M\.[\t \u3000]*tuberculosis|N\.[\t \u3000]*meningitidis|P\.[\t \u3000]*(?:vivax|ovale)|S\.[\t \u3000]*(?:aureus|pneumoniae))\b/iu;
const semanticDecimalValuePrefixPattern = /^\d+(?:\.\d+)+(?:[\t \u3000]*%|[\t \u3000]+(?:mg|mcg|g|kg|mL|L|mEq|mmol|mol|mm|cm|m|Hz|kPa|mmHg|cells?|days?|hours?|minutes?)(?![\p{L}\p{M}]))/u;

function withoutStructuralHeadingPrefix(value: string) {
  const leadingMarkup = /^((?:(?:\*\*|__|~~|`|\*|_)[\t \u3000]*)*)/u.exec(value)?.[1] ?? "";
  const title = value.slice(leadingMarkup.length);
  let remainder = title;

  for (let pass = 0; pass < 4; pass += 1) {
    if (
      semanticTaxonPrefixPattern.test(remainder)
      || semanticDecimalValuePrefixPattern.test(remainder)
    ) {
      break;
    }
    if (structuralChinesePrefixPattern.test(remainder)) {
      remainder = remainder.replace(structuralChinesePrefixPattern, "");
      continue;
    }
    if (structuralDecimalPrefixPattern.test(remainder)) {
      remainder = remainder.replace(structuralDecimalPrefixPattern, "");
      continue;
    }
    if (structuralArabicPrefixPattern.test(remainder)) {
      remainder = remainder.replace(structuralArabicPrefixPattern, "");
      continue;
    }
    if (structuralStepPrefixPattern.test(remainder)) {
      remainder = remainder.replace(structuralStepPrefixPattern, "");
      continue;
    }
    if (structuralChineseStepPrefixPattern.test(remainder)) {
      remainder = remainder.replace(structuralChineseStepPrefixPattern, "");
      continue;
    }
    const letter = structuralLetterPrefixPattern.exec(remainder);
    if (letter) {
      remainder = letter[3];
      continue;
    }
    break;
  }

  return `${leadingMarkup}${remainder}`.replace(/[\t \u3000]+/gu, " ").trim();
}

/**
 * A heading-only compatibility identity. It deliberately removes just the
 * leading outline label so notes created before a numbering rewrite can find
 * the same heading afterwards. Medical values and abbreviated taxa remain
 * part of the identity.
 */
export function annotationCanonicalHeadingKey(markdown: string) {
  const identity = withoutStructuralHeadingPrefix(headingTitle(markdown)).normalize("NFC");
  return `heading-canonical-${stableHash(identity)}`;
}

/**
 * Deterministic DOM anchor for one rendered Markdown source block. The source
 * offset disambiguates repeated headings/tables and the content hash guards
 * against an accidental match after the source is revised.
 */
export function annotationBlockAnchor(
  block: AnnotationExcerptRequest["block"],
  markdown: string,
  sourceOffset = 0,
) {
  const safeOffset = Number.isInteger(sourceOffset) && sourceOffset >= 0 ? sourceOffset : 0;
  return `annotation-${block}-${safeOffset.toString(36)}-${stableHash(blockIdentity(block, markdown))}`;
}

/** Content-only key is a backward-compatible fallback for old excerpts. */
export function annotationBlockKey(block: AnnotationExcerptRequest["block"], markdown: string) {
  return `${block}-${stableHash(blockIdentity(block, markdown))}`;
}

/** Recover the source offset embedded in a deterministic block anchor. */
export function annotationBlockSourceOffset(anchor: string | null | undefined) {
  if (!anchor || !safeAnchorPattern.test(anchor)) return null;
  const encoded = /^annotation-(?:heading|table)-([a-z0-9]+)-[a-z0-9]+$/u.exec(anchor)?.[1];
  if (!encoded) return null;
  const offset = Number.parseInt(encoded, 36);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

/**
 * Return the uniquely nearest current source offset. An exact-distance tie is
 * intentionally unresolved so a legacy note never jumps to the wrong copy.
 */
export function nearestAnnotationSourceOffset(
  legacyOffset: number,
  currentOffsets: readonly (number | null)[],
) {
  if (!Number.isSafeInteger(legacyOffset) || legacyOffset < 0) return null;
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  currentOffsets.forEach((offset, index) => {
    if (offset === null || !Number.isSafeInteger(offset) || offset < 0) return;
    const distance = Math.abs(offset - legacyOffset);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  });
  return tied ? null : bestIndex;
}

/**
 * Build the same excerpt/anchor pair as MarkdownContent's first rendered H1.
 * The Guide uses this for its visible chapter heading because the duplicate H1
 * inside the article remains visually hidden.
 */
export function firstMarkdownH1Excerpt(markdown: string, fallbackHeading: string): AnnotationExcerptRequest {
  const normalized = normalizedExcerpt(markdown);
  const headings = markdownHeadingRanges(normalized);
  const first = headings.find((heading) => heading.level === 1 && heading.root);
  if (first) {
    const excerpt = markdownHeadingSection(normalized, first.start, first.end, first.level, headings);
    const headingIdentity = normalized.slice(first.start, first.end).trim();
    return {
      markdown: excerpt,
      block: "heading",
      label: "主標題",
      sourceAnchor: annotationBlockAnchor("heading", headingIdentity, first.start),
    };
  }

  const label = fallbackHeading.replace(/\s+/gu, " ").trim() || "本章";
  const headingIdentity = `# ${label}`;
  const excerpt = [headingIdentity, normalized].filter(Boolean).join("\n\n");
  return {
    markdown: excerpt,
    block: "heading",
    label: "主標題",
    sourceAnchor: annotationBlockAnchor("heading", headingIdentity, 0),
  };
}

/** Store the source anchor/scope in the existing durable prefix column. */
export function annotationBlockMetadata(anchor: string, scope?: string) {
  if (!safeAnchorPattern.test(anchor)) return "";
  const normalizedScope = scope?.toLocaleLowerCase("en");
  const base = `${METADATA_PREFIX}${anchor}`;
  const scopeMetadata = normalizedScope && safeScopePattern.test(normalizedScope) ? `;scope=${normalizedScope}` : "";
  return base.length + scopeMetadata.length <= PREFIX_FIELD_LIMIT ? `${base}${scopeMetadata}` : base;
}

export function annotationBlockAnchorFrom(annotation: Pick<StudyAnnotation, "kind" | "prefix">) {
  if (annotation.kind !== "excerpt" || !annotation.prefix.startsWith(METADATA_PREFIX)) return null;
  const anchor = annotation.prefix.slice(METADATA_PREFIX.length).split(";", 1)[0];
  return safeAnchorPattern.test(anchor) ? anchor : null;
}

export function annotationBlockScopeFrom(annotation: Pick<StudyAnnotation, "kind" | "prefix">) {
  if (annotation.kind !== "excerpt" || !annotation.prefix.startsWith(METADATA_PREFIX)) return null;
  const scope = /;scope=([a-z0-9_-]{1,24})$/u.exec(annotation.prefix)?.[1];
  return scope && safeScopePattern.test(scope) ? scope : null;
}

export function excerptBlockKind(markdown: string): AnnotationExcerptRequest["block"] | null {
  if (/^\s*\|.+\|/mu.test(markdown)) return "table";
  if (markdownHeadingRanges(markdown).length > 0) return "heading";
  return null;
}
