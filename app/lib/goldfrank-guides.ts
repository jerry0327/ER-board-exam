import { fetchCompressedStatic } from "./compressed-static.ts";

export type GoldfrankReadingDepth = "quick" | "standard" | "full";

export type GoldfrankGuideModeContent = {
  headingTitle: string;
  bytes: number;
  contentHash: string;
  sourceSha256: string;
  markdownPath: string;
};

export type GoldfrankGuideChapter = {
  id: string;
  number: number;
  title: string;
  order: number;
  bytes: number;
  contentHash: string;
  markdownPath: string;
  modes: Record<GoldfrankReadingDepth, GoldfrankGuideModeContent>;
};

export type GoldfrankGuideManifest = {
  schemaVersion: number;
  sourceRevision: string;
  title: string;
  subtitle: string;
  chapterCount: number;
  defaultMode: GoldfrankReadingDepth;
  chapters: GoldfrankGuideChapter[];
};

let manifestRequest: Promise<GoldfrankGuideManifest> | null = null;
const chapterRequests = new Map<string, Promise<string>>();
const chapterCount = 140;
const depths: GoldfrankReadingDepth[] = ["quick", "standard", "full"];

function normalizeChapterId(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= chapterCount
    ? String(number).padStart(3, "0")
    : "001";
}

function validHash(value: unknown, length: number) {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value);
}

function validModeContent(
  content: GoldfrankGuideModeContent | undefined,
  id: string,
  depth: GoldfrankReadingDepth,
) {
  const suffix = depth === "full" ? "" : `-${depth}`;
  return Boolean(
    content
    && typeof content.headingTitle === "string"
    && content.headingTitle.trim().length > 0
    && Number.isInteger(content.bytes)
    && content.bytes > 0
    && validHash(content.contentHash, 64)
    && validHash(content.sourceSha256, 64)
    && content.markdownPath === `/guides/goldfrank/chapters/${id}${suffix}.md`,
  );
}

function validManifest(manifest: GoldfrankGuideManifest) {
  return manifest.schemaVersion === 1
    && manifest.chapterCount === chapterCount
    && manifest.chapters.length === chapterCount
    && manifest.defaultMode === "full"
    && validHash(manifest.sourceRevision, 20)
    && typeof manifest.title === "string"
    && manifest.title.trim().length > 0
    && typeof manifest.subtitle === "string"
    && manifest.subtitle.trim().length > 0
    && manifest.chapters.every((chapter, index) => {
      const number = index + 1;
      const id = String(number).padStart(3, "0");
      const full = chapter.modes?.full;
      return chapter.id === id
        && chapter.number === number
        && chapter.order === number
        && typeof chapter.title === "string"
        && chapter.title.trim().length > 0
        && depths.every((depth) => validModeContent(chapter.modes?.[depth], id, depth))
        && new Set(depths.map((depth) => chapter.modes[depth].contentHash)).size === depths.length
        && chapter.markdownPath === full?.markdownPath
        && chapter.contentHash === full?.contentHash
        && chapter.bytes === full?.bytes;
    });
}

export function loadGoldfrankGuideManifest() {
  if (!manifestRequest) {
    manifestRequest = fetchCompressedStatic("/guides/goldfrank/manifest.json", { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Goldfrank 學習指引目錄載入失敗");
        const manifest = await response.json() as GoldfrankGuideManifest;
        if (!validManifest(manifest)) throw new Error("Goldfrank 學習指引目錄不完整");
        return manifest;
      })
      .catch((error: unknown) => {
        manifestRequest = null;
        throw error;
      });
  }
  return manifestRequest;
}

export function resolveGoldfrankGuideContent(
  chapter: GoldfrankGuideChapter,
  mode: GoldfrankReadingDepth,
) {
  return chapter.modes[mode];
}

export function loadGoldfrankGuideMarkdown(
  chapter: GoldfrankGuideChapter,
  mode: GoldfrankReadingDepth,
) {
  const id = normalizeChapterId(chapter.id);
  const content = resolveGoldfrankGuideContent(chapter, mode);
  const cacheKey = `${id}:${mode}:${content.contentHash}`;
  if (!chapterRequests.has(cacheKey)) {
    const version = `?v=${encodeURIComponent(content.contentHash)}`;
    const request = fetchCompressedStatic(`${content.markdownPath}${version}`, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Goldfrank 第 ${Number(id)} 章載入失敗`);
        return response.text();
      })
      .catch((error: unknown) => {
        chapterRequests.delete(cacheKey);
        throw error;
      });
    chapterRequests.set(cacheKey, request);
  }
  return chapterRequests.get(cacheKey)!;
}

export function prefetchGoldfrankGuideChapter(
  chapter: GoldfrankGuideChapter,
  mode: GoldfrankReadingDepth,
) {
  return loadGoldfrankGuideMarkdown(chapter, mode).catch(() => undefined);
}

export function normalizeGoldfrankGuideChapterId(value: string | number | null | undefined) {
  return normalizeChapterId(value);
}
