import { fetchCompressedStatic } from "./compressed-static.ts";

export type EmsReadingDepth = "quick" | "standard" | "full";

export type EmsGuideModeContent = {
  headingTitle: string;
  bytes: number;
  contentHash: string;
  sourceSha256: string;
  markdownPath: string;
};

export type EmsGuideChapter = {
  id: string;
  number: number;
  title: string;
  order: number;
  bytes: number;
  contentHash: string;
  markdownPath: string;
  modes: Record<EmsReadingDepth, EmsGuideModeContent>;
};

export type EmsGuideManifest = {
  schemaVersion: number;
  sourceRevision: string;
  title: string;
  subtitle: string;
  chapterCount: number;
  defaultMode: EmsReadingDepth;
  chapters: EmsGuideChapter[];
};

let manifestRequest: Promise<EmsGuideManifest> | null = null;
const chapterRequests = new Map<string, Promise<string>>();

function normalizeChapterId(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 24
    ? String(number).padStart(3, "0")
    : "001";
}

export function loadEmsGuideManifest() {
  if (!manifestRequest) {
    manifestRequest = fetchCompressedStatic("/guides/ems/manifest.json", { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("EMS 學習指引目錄載入失敗");
        const manifest = await response.json() as EmsGuideManifest;
        if (
          manifest.schemaVersion !== 1
          || manifest.chapterCount !== 24
          || manifest.chapters.length !== 24
          || manifest.defaultMode !== "full"
          || !/^[a-f0-9]{20}$/u.test(manifest.sourceRevision)
          || manifest.chapters.some((chapter, index) => {
            const full = chapter.modes?.full;
            return chapter.id !== String(index + 1).padStart(3, "0")
              || chapter.number !== index + 1
              || !chapter.modes?.quick
              || !chapter.modes?.standard
              || !full
              || chapter.markdownPath !== full.markdownPath
              || chapter.contentHash !== full.contentHash
              || chapter.bytes !== full.bytes;
          })
        ) {
          throw new Error("EMS 學習指引目錄不完整");
        }
        return manifest;
      })
      .catch((error: unknown) => {
        manifestRequest = null;
        throw error;
      });
  }
  return manifestRequest;
}

export function resolveEmsGuideContent(chapter: EmsGuideChapter, mode: EmsReadingDepth) {
  return chapter.modes[mode];
}

export function loadEmsGuideMarkdown(chapter: EmsGuideChapter, mode: EmsReadingDepth) {
  const id = normalizeChapterId(chapter.id);
  const content = resolveEmsGuideContent(chapter, mode);
  const cacheKey = `${id}:${mode}:${content.contentHash}`;
  if (!chapterRequests.has(cacheKey)) {
    const version = `?v=${encodeURIComponent(content.contentHash)}`;
    const request = fetchCompressedStatic(`${content.markdownPath}${version}`, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`EMS 第 ${Number(id)} 章載入失敗`);
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

export function prefetchEmsGuideChapter(chapter: EmsGuideChapter, mode: EmsReadingDepth) {
  return loadEmsGuideMarkdown(chapter, mode).catch(() => undefined);
}

export function normalizeEmsGuideChapterId(value: string | number | null | undefined) {
  return normalizeChapterId(value);
}
