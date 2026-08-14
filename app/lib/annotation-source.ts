import type { ExplanationMode } from "./explanation-mode";
import type { ExplanationPackId } from "./explanation-packs";
import { ailsReadingPageIds } from "./ails-review.ts";
import { parseRosensSupplementalSectionId } from "./supplemental-guide-ids.ts";

const guideSourcePattern = /^guide-(tintinalli)-(\d{3})$/u;
const rosensGuideSourcePattern = /^guide-(rosens)-((?:\d{3})|e\d{2})$/u;
const tintinalliSupplementalSourcePattern = /^guide-(tintinalli)-(overview|section-(\d{2}))$/u;
const rosensSupplementalSourcePattern = /^guide-(rosens)-(overview|section-(\d{2}-\d{2}))$/u;
const boardGuideSourcePattern = /^guide-(board)-(\d{1,2}[A-Z]\d?)$/u;
const ailsGuideSourcePattern = /^guide-(ails)-([a-z][a-z0-9_-]{1,31})$/u;
const emsGuideSourcePattern = /^guide-(ems)-(\d{3})$/u;
const goldfrankGuideSourcePattern = /^guide-(goldfrank)-(\d{3})$/u;
const readerScopePattern = /^h_r_(original|concise)_(quick|standard|full|raw)_[A-Za-z0-9_-]+$/u;
const guideScopePattern = /^h_gt(\d{3})_(concise|detailed)-(quick|focus|full|raw)_[A-Za-z0-9_-]+$/u;
const rosensGuideScopePattern = /^h_gr((?:\d{3})|e\d{2})_detailed-(quick|standard|full)_[A-Za-z0-9_-]+$/u;
const emsGuideScopePattern = /^h_ge(\d{3})_(quick|standard|full)_[A-Za-z0-9_-]+$/u;
const goldfrankGuideScopePattern = /^h_gg(\d{3})_(quick|standard|full)_[A-Za-z0-9_-]+$/u;
const safeScopePattern = /[^a-z0-9_-]+/gu;

export type ReaderAnnotationScope = {
  kind: "reader";
  packId: ExplanationPackId;
  mode: ExplanationMode;
};

export type GuideAnnotationSource = {
  kind: "guide";
  textbook: "tintinalli";
  resourceKind: "chapter";
  chapter: number;
  chapterId: string;
  resourceId: string;
};

export type RosensGuideAnnotationSource = {
  kind: "guide";
  textbook: "rosens";
  resourceKind: "chapter";
  chapterId: string;
  resourceId: string;
};

export type GuideSupplementalAnnotationSource = {
  kind: "guide";
  textbook: "tintinalli" | "rosens";
  resourceKind: "overview" | "section";
  sectionId: string | null;
  resourceId: string;
};

export type BoardGuideAnnotationSource = {
  kind: "guide";
  textbook: "board";
  resourceKind: "unit";
  unitCode: string;
  resourceId: string;
};

export type AilsGuideAnnotationSource = {
  kind: "guide";
  textbook: "ails";
  resourceKind: "page";
  pageId: string;
  resourceId: string;
};

export type EmsGuideAnnotationSource = {
  kind: "guide";
  textbook: "ems";
  resourceKind: "chapter";
  chapter: number;
  chapterId: string;
  resourceId: string;
};

export type GoldfrankGuideAnnotationSource = {
  kind: "guide";
  textbook: "goldfrank";
  resourceKind: "chapter";
  chapter: number;
  chapterId: string;
  resourceId: string;
};

export type AnyGuideAnnotationSource =
  | GuideAnnotationSource
  | RosensGuideAnnotationSource
  | GuideSupplementalAnnotationSource
  | BoardGuideAnnotationSource
  | AilsGuideAnnotationSource
  | EmsGuideAnnotationSource
  | GoldfrankGuideAnnotationSource;

export type GuideAnnotationScope = {
  kind: "guide";
  chapter: number;
  packId: "concise" | "detailed";
  mode: "quick" | "focus" | "full" | "raw";
};

export type RosensGuideAnnotationScope = {
  kind: "guide";
  textbook: "rosens";
  chapterId: string;
  packId: "detailed";
  mode: "quick" | "standard" | "full";
};

export type EmsGuideAnnotationScope = {
  kind: "guide";
  textbook: "ems";
  chapterId: string;
  mode: "quick" | "standard" | "full";
};

export type GoldfrankGuideAnnotationScope = {
  kind: "guide";
  textbook: "goldfrank";
  chapterId: string;
  mode: "quick" | "standard" | "full";
};

function normalizeTintinalliChapter(chapter: number | string) {
  const value = typeof chapter === "number" ? chapter : Number(chapter);
  if (!Number.isInteger(value) || value < 1 || value > 303) return null;
  return value;
}

function normalizeRosensChapter(chapter: number | string) {
  if (typeof chapter === "number" || /^\d{1,3}$/u.test(chapter)) {
    const value = Number(chapter);
    if (!Number.isInteger(value) || value < 1 || value > 192) return null;
    return String(value).padStart(3, "0");
  }
  const value = chapter.toLocaleLowerCase("en");
  const eChapter = /^e(\d{1,2})$/u.exec(value);
  if (!eChapter) return null;
  const ordinal = Number(eChapter[1]);
  return ordinal >= 1 && ordinal <= 16 ? `e${String(ordinal).padStart(2, "0")}` : null;
}

/**
 * Stable prefix for a new Reader highlight/excerpt. Encoding both the actual
 * rendered pack and reading depth lets a Notebook deep link restore the exact
 * source view without repurposing the text-context prefix/suffix fields.
 */
export function readerAnnotationScopePrefix(packId: ExplanationPackId, mode: ExplanationMode) {
  return `h_r_${packId}_${mode}_`;
}

/** Parse only mode-aware Reader ids; legacy h_/h_c_ ids intentionally return null. */
export function parseReaderAnnotationScope(value?: string | null): ReaderAnnotationScope | null {
  if (!value) return null;
  const match = readerScopePattern.exec(value);
  if (!match) return null;
  return {
    kind: "reader",
    packId: match[1] as ExplanationPackId,
    mode: match[2] as ExplanationMode,
  };
}

/**
 * Stable, URL/API-safe resource key for a Tintinalli learning-guide chapter.
 * Existing question annotations continue to use their question id unchanged.
 */
export function guideAnnotationResourceId(chapter: number | string) {
  const normalized = normalizeTintinalliChapter(chapter);
  if (normalized === null) return null;
  return `guide-tintinalli-${String(normalized).padStart(3, "0")}`;
}

/** Parse only keys produced by guideAnnotationResourceId. */
export function parseGuideAnnotationResourceId(value: string): GuideAnnotationSource | null {
  const match = guideSourcePattern.exec(value);
  if (!match) return null;
  const chapter = Number(match[2]);
  if (chapter < 1 || chapter > 303) return null;
  const chapterId = String(chapter).padStart(3, "0");
  return {
    kind: "guide",
    textbook: "tintinalli",
    resourceKind: "chapter",
    chapter,
    chapterId,
    resourceId: `guide-tintinalli-${chapterId}`,
  };
}

/** Stable resource key for a Rosen's 10e core, supplemental, or eChapter. */
export function rosensGuideAnnotationResourceId(chapter: number | string) {
  const chapterId = normalizeRosensChapter(chapter);
  return chapterId ? `guide-rosens-${chapterId}` : null;
}

/** Parse only Rosen's chapter keys; whole-book resources use the generic parser. */
export function parseRosensGuideAnnotationResourceId(value: string): RosensGuideAnnotationSource | null {
  const match = rosensGuideSourcePattern.exec(value);
  if (!match) return null;
  const chapterId = normalizeRosensChapter(match[2]);
  if (!chapterId || chapterId !== match[2]) return null;
  return {
    kind: "guide",
    textbook: "rosens",
    resourceKind: "chapter",
    chapterId,
    resourceId: `guide-rosens-${chapterId}`,
  };
}

/**
 * Parse every guide resource accepted by shared progress and annotation APIs.
 * Chapter-specific parsers intentionally remain narrow for legacy consumers.
 */
export function parseAnyGuideAnnotationResourceId(value: string): AnyGuideAnnotationSource | null {
  const tintinalliChapter = parseGuideAnnotationResourceId(value);
  if (tintinalliChapter) return tintinalliChapter;
  const rosensChapter = parseRosensGuideAnnotationResourceId(value);
  if (rosensChapter) return rosensChapter;

  const emsChapter = emsGuideSourcePattern.exec(value);
  if (emsChapter) {
    const chapter = Number(emsChapter[2]);
    if (chapter < 1 || chapter > 24) return null;
    const chapterId = String(chapter).padStart(3, "0");
    return {
      kind: "guide",
      textbook: "ems",
      resourceKind: "chapter",
      chapter,
      chapterId,
      resourceId: `guide-ems-${chapterId}`,
    };
  }

  const goldfrankChapter = goldfrankGuideSourcePattern.exec(value);
  if (goldfrankChapter) {
    const chapter = Number(goldfrankChapter[2]);
    if (chapter < 1 || chapter > 140) return null;
    const chapterId = String(chapter).padStart(3, "0");
    return {
      kind: "guide",
      textbook: "goldfrank",
      resourceKind: "chapter",
      chapter,
      chapterId,
      resourceId: `guide-goldfrank-${chapterId}`,
    };
  }

  const boardUnit = boardGuideSourcePattern.exec(value);
  if (boardUnit) {
    return {
      kind: "guide",
      textbook: "board",
      resourceKind: "unit",
      unitCode: boardUnit[2],
      resourceId: value,
    };
  }

  const ailsPage = ailsGuideSourcePattern.exec(value);
  if (ailsPage && ailsReadingPageIds.includes(ailsPage[2] as (typeof ailsReadingPageIds)[number])) {
    return {
      kind: "guide",
      textbook: "ails",
      resourceKind: "page",
      pageId: ailsPage[2],
      resourceId: value,
    };
  }

  const tintinalliSupplemental = tintinalliSupplementalSourcePattern.exec(value);
  if (tintinalliSupplemental) {
    const sectionId = tintinalliSupplemental[3] ?? null;
    if (sectionId && (Number(sectionId) < 1 || Number(sectionId) > 26)) return null;
    return {
      kind: "guide",
      textbook: "tintinalli",
      resourceKind: sectionId ? "section" : "overview",
      sectionId,
      resourceId: value,
    };
  }

  const rosensSupplemental = rosensSupplementalSourcePattern.exec(value);
  if (rosensSupplemental) {
    const sectionId = rosensSupplemental[3] ?? null;
    if (sectionId && parseRosensSupplementalSectionId(`section-${sectionId}`) === null) return null;
    return {
      kind: "guide",
      textbook: "rosens",
      resourceKind: sectionId ? "section" : "overview",
      sectionId,
      resourceId: value,
    };
  }
  return null;
}

/**
 * Prefix for highlight/excerpt ids belonging to one rendered guide scope.
 * The optional scope should identify the edition/depth being rendered. It is
 * normalized instead of copied verbatim so generated ids remain API-safe.
 */
export function guideAnnotationScopePrefix(resourceId: string, scope = "default") {
  const source = parseGuideAnnotationResourceId(resourceId);
  if (!source) return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "default";
  return `h_gt${source.chapterId}_${normalizedScope}_`;
}

/** Parse the rendered guide edition/depth encoded in a highlight/excerpt id. */
export function parseGuideAnnotationScope(value?: string | null): GuideAnnotationScope | null {
  if (!value) return null;
  const match = guideScopePattern.exec(value);
  if (!match) return null;
  const chapter = Number(match[1]);
  if (chapter < 1 || chapter > 303) return null;
  return {
    kind: "guide",
    chapter,
    packId: match[2] as GuideAnnotationScope["packId"],
    mode: match[3] as GuideAnnotationScope["mode"],
  };
}

/** Prefix for highlights/excerpts in a rendered Rosen's chapter depth. */
export function rosensGuideAnnotationScopePrefix(resourceId: string, scope = "detailed-standard") {
  const source = parseRosensGuideAnnotationResourceId(resourceId);
  if (!source) return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "detailed-standard";
  return `h_gr${source.chapterId}_${normalizedScope}_`;
}

/** Parse the chapter and reading depth encoded in a Rosen's annotation id. */
export function parseRosensGuideAnnotationScope(value?: string | null): RosensGuideAnnotationScope | null {
  if (!value) return null;
  const match = rosensGuideScopePattern.exec(value);
  if (!match || !normalizeRosensChapter(match[1])) return null;
  return {
    kind: "guide",
    textbook: "rosens",
    chapterId: match[1],
    packId: "detailed",
    mode: match[2] as RosensGuideAnnotationScope["mode"],
  };
}

/** Prefix for non-chapter guide resources such as whole-book and section guides. */
export function guideSupplementalAnnotationScopePrefix(resourceId: string, scope = "default") {
  const source = parseAnyGuideAnnotationResourceId(resourceId);
  if (!source || (source.resourceKind !== "overview" && source.resourceKind !== "section")) return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "default";
  const textbook = source.textbook === "tintinalli" ? "t" : "r";
  const resource = source.resourceKind === "overview" ? "o" : `s${source.sectionId}`;
  return `h_g${textbook}${resource}_${normalizedScope}_`;
}

/** Stable progress and annotation resource id for one題庫教科書單元. */
export function boardGuideAnnotationResourceId(unitCode: string) {
  const code = unitCode.normalize("NFKC").trim().toUpperCase();
  return /^\d{1,2}[A-Z]\d?$/u.test(code) ? `guide-board-${code}` : null;
}

/** Prefix for highlights and excerpts in one rendered題庫教科書單元. */
export function boardGuideAnnotationScopePrefix(resourceId: string, scope = "full") {
  const source = parseAnyGuideAnnotationResourceId(resourceId);
  if (!source || source.resourceKind !== "unit") return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "full";
  return `h_gb${source.unitCode.toLocaleLowerCase("en")}_${normalizedScope}_`;
}

/** Stable progress and annotation resource id for one AILS reading page. */
export function ailsGuideAnnotationResourceId(pageId: string) {
  const normalized = pageId.normalize("NFKC").trim().toLocaleLowerCase("en");
  return ailsReadingPageIds.includes(normalized as (typeof ailsReadingPageIds)[number])
    ? `guide-ails-${normalized}`
    : null;
}

/** Prefix for highlights and excerpts in one rendered AILS page. */
export function ailsGuideAnnotationScopePrefix(resourceId: string, scope = "full") {
  const source = parseAnyGuideAnnotationResourceId(resourceId);
  if (!source || source.resourceKind !== "page") return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "full";
  return `h_ga${source.pageId}_${normalizedScope}_`;
}

/** Stable progress and annotation resource id for one EMS guide chapter. */
export function emsGuideAnnotationResourceId(chapter: string | number) {
  const number = Number(chapter);
  return Number.isInteger(number) && number >= 1 && number <= 24
    ? `guide-ems-${String(number).padStart(3, "0")}`
    : null;
}

/** Prefix for highlights and excerpts in one EMS guide chapter. */
export function emsGuideAnnotationScopePrefix(resourceId: string, scope = "full") {
  const source = parseAnyGuideAnnotationResourceId(resourceId);
  if (!source || source.textbook !== "ems" || source.resourceKind !== "chapter") return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "full";
  return `h_ge${source.chapterId}_${normalizedScope}_`;
}

/** Parse the chapter and reading depth encoded in an EMS highlight/excerpt id. */
export function parseEmsGuideAnnotationScope(value?: string | null): EmsGuideAnnotationScope | null {
  if (!value) return null;
  const match = emsGuideScopePattern.exec(value);
  const chapter = Number(match?.[1]);
  if (!match || chapter < 1 || chapter > 24) return null;
  return {
    kind: "guide",
    textbook: "ems",
    chapterId: match[1],
    mode: match[2] as EmsGuideAnnotationScope["mode"],
  };
}

/** Stable progress and annotation resource id for one Goldfrank chapter. */
export function goldfrankGuideAnnotationResourceId(chapter: string | number) {
  const number = Number(chapter);
  return Number.isInteger(number) && number >= 1 && number <= 140
    ? `guide-goldfrank-${String(number).padStart(3, "0")}`
    : null;
}

/** Prefix for highlights and excerpts in one rendered Goldfrank chapter. */
export function goldfrankGuideAnnotationScopePrefix(resourceId: string, scope = "full") {
  const source = parseAnyGuideAnnotationResourceId(resourceId);
  if (!source || source.textbook !== "goldfrank" || source.resourceKind !== "chapter") return null;
  const normalizedScope = scope
    .toLocaleLowerCase("en")
    .replace(safeScopePattern, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32) || "full";
  return `h_gg${source.chapterId}_${normalizedScope}_`;
}

/** Parse the chapter and reading depth encoded in a Goldfrank highlight/excerpt id. */
export function parseGoldfrankGuideAnnotationScope(value?: string | null): GoldfrankGuideAnnotationScope | null {
  if (!value) return null;
  const match = goldfrankGuideScopePattern.exec(value);
  const chapter = Number(match?.[1]);
  if (!match || chapter < 1 || chapter > 140) return null;
  return {
    kind: "guide",
    textbook: "goldfrank",
    chapterId: match[1],
    mode: match[2] as GoldfrankGuideAnnotationScope["mode"],
  };
}

/** Deterministic root-note id for any shared guide resource. */
export function guideResourceAnnotationId(resourceId: string) {
  return parseAnyGuideAnnotationResourceId(resourceId) ? `q_${resourceId}` : null;
}

/**
 * Deterministic id used for the one root chapter note and for migration from
 * guide_progress.note. Re-running migration therefore cannot create copies.
 */
export function guideLegacyAnnotationId(resourceId: string) {
  return parseGuideAnnotationResourceId(resourceId) ? `q_${resourceId}` : null;
}

// Short aliases keep call sites readable while retaining explicit exported
// names for source parsing and migration code.
export const guideSourceKey = guideAnnotationResourceId;
export const parseGuideSourceKey = parseGuideAnnotationResourceId;
export const guideScopePrefix = guideAnnotationScopePrefix;
export const guideLegacyId = guideLegacyAnnotationId;
