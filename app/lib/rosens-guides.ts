import { rosensChapters, type RosensReadingDepth } from "./rosens-catalog";
import { fetchCompressedStatic } from "./compressed-static.ts";

export type RosensGuideModeContent = {
  markdownPath: string;
  contentHash: string;
  sourceSha256: string;
  bytes: number;
};

export type RosensGuideChapterContent = {
  id: string;
  sourceSequence: number | null;
  available: boolean;
  modes: Record<RosensReadingDepth, RosensGuideModeContent> | null;
};

export type RosensGuideManifest = {
  schemaVersion: number;
  textbookId: "rosens";
  title: string;
  packId: "detailed";
  sourceVersion: string | null;
  totalEntries: number;
  importedChapters: number;
  defaultMode: RosensReadingDepth;
  overview: RosensGuideModeContent;
  chapters: RosensGuideChapterContent[];
};

let manifestRequest: Promise<RosensGuideManifest> | null = null;
const markdownCache = new Map<string, Promise<string>>();

function loadMarkdown(content: RosensGuideModeContent, label: string) {
  const cacheKey = `${content.markdownPath}:${content.contentHash}`;
  if (!markdownCache.has(cacheKey)) {
    const version = `?v=${encodeURIComponent(content.contentHash)}`;
    const request = fetchCompressedStatic(`${content.markdownPath}${version}`, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`${label}載入失敗`);
        return response.text();
      })
      .catch((error: unknown) => {
        markdownCache.delete(cacheKey);
        throw error;
      });
    markdownCache.set(cacheKey, request);
  }
  return markdownCache.get(cacheKey)!;
}

export function loadRosensGuideManifest() {
  if (!manifestRequest) {
    manifestRequest = fetchCompressedStatic("/guides/rosens/manifest.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("Rosen’s 學習指引目錄載入失敗");
        return response.json() as Promise<RosensGuideManifest>;
      })
      .then((manifest) => {
        const expectedIds = rosensChapters.map((chapter) => chapter.id);
        const actualIds = manifest.chapters.map((chapter) => chapter.id);
        const unavailable = manifest.chapters.filter((chapter) => !chapter.available).map((chapter) => chapter.id);
        const incomplete = manifest.chapters.some((chapter) => chapter.available && (
          !chapter.modes?.quick || !chapter.modes.standard || !chapter.modes.full
        ));
        if (
          manifest.schemaVersion !== 1
          || manifest.textbookId !== "rosens"
          || manifest.packId !== "detailed"
          || manifest.totalEntries !== rosensChapters.length
          || manifest.importedChapters !== 208
          || actualIds.length !== expectedIds.length
          || actualIds.some((id, index) => id !== expectedIds[index])
          || unavailable.length !== 0
          || incomplete
          || !manifest.overview?.markdownPath
        ) {
          throw new Error("Rosen’s 學習指引目錄不完整");
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

export function resolveRosensGuideContent(chapter: RosensGuideChapterContent, mode: RosensReadingDepth) {
  return chapter.available ? chapter.modes?.[mode] ?? null : null;
}

export function loadRosensGuideMarkdown(chapter: RosensGuideChapterContent, mode: RosensReadingDepth) {
  const content = resolveRosensGuideContent(chapter, mode);
  return content ? loadMarkdown(content, `Rosen’s ${chapter.id} 正文`) : Promise.resolve("");
}

export async function loadRosensWholeBookOverview() {
  const manifest = await loadRosensGuideManifest();
  return loadMarkdown(manifest.overview, "Rosen’s 全書導讀");
}
