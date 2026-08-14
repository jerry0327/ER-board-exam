import { fetchCompressedStatic } from "./compressed-static.ts";

export type StudyGuidePart = {
  part: string | null;
  title: string;
  printPage: number;
};

export type GuidePackId = "concise" | "detailed";
export type GuideReadingMode = "quick" | "focus" | "full";

export type StudyGuideModeContent = {
  markdownPath: string;
  contentHash: string;
  sourceSha256: string;
  bytes: number;
};

export type StudyGuidePackContent = {
  available: boolean;
  sourceVersion: string | null;
  modes: Record<GuideReadingMode, StudyGuideModeContent>;
};

export type StudyGuidePack = {
  id: GuidePackId;
  label: string;
  description: string;
  status: "available" | "coming_soon";
  importedChapters: number;
  sourceVersion: string | null;
};

export type StudyGuideChapter = {
  id: number;
  title: string;
  sectionId: number;
  sectionTitle: string;
  printPage: number;
  parts: StudyGuidePart[];
  available: boolean;
  markdownPath: string | null;
  contentHash: string | null;
  linkedQuestionCount: number;
  contents: Partial<Record<GuidePackId, StudyGuidePackContent>>;
};

export type StudyGuideCatalog = {
  schemaVersion: number;
  title: string;
  totalChapters: number;
  importedChapters: number;
  defaultPackId: GuidePackId;
  packs: StudyGuidePack[];
  sections: { id: number; title: string }[];
  chapters: StudyGuideChapter[];
};

export type StudyGuideLinks = {
  schemaVersion: number;
  sourceHash: string;
  questionToChapters: Record<string, number[]>;
  chapterToQuestions: Record<string, string[]>;
  validation: {
    exactLinkedQuestions: number;
    ambiguousQuestionsExcluded: number;
    questionChapterLinks: number;
    linkedChapters: number;
  };
};

let catalogRequest: Promise<StudyGuideCatalog> | null = null;
let linksRequest: Promise<StudyGuideLinks> | null = null;
const markdownCache = new Map<string, Promise<string>>();

export function loadStudyGuideCatalog() {
  if (!catalogRequest) {
    catalogRequest = fetchCompressedStatic("/guides/manifest.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("學習指引目錄載入失敗");
        return response.json() as Promise<StudyGuideCatalog>;
      })
      .then((catalog) => {
        if (catalog.schemaVersion < 3 || catalog.totalChapters !== 303 || catalog.chapters.length !== 303 || !catalog.packs?.length) {
          throw new Error("學習指引目錄不完整");
        }
        const incompletePack = catalog.chapters.some((chapter) => Object.values(chapter.contents ?? {}).some((pack) => (
          pack?.available && (!pack.modes?.quick || !pack.modes?.focus || !pack.modes?.full)
        )));
        if (incompletePack) throw new Error("學習指引閱讀模式不完整");
        return catalog;
      })
      .catch((error: unknown) => {
        catalogRequest = null;
        throw error;
      });
  }
  return catalogRequest;
}

export function loadStudyGuideLinks() {
  if (!linksRequest) {
    linksRequest = fetchCompressedStatic("/guides/links.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("題目與章節連結載入失敗");
        return response.json() as Promise<StudyGuideLinks>;
      })
      .catch((error: unknown) => {
        linksRequest = null;
        throw error;
      });
  }
  return linksRequest;
}

export function resolveStudyGuideContent(chapter: StudyGuideChapter, packId: GuidePackId, mode: GuideReadingMode) {
  const pack = chapter.contents?.[packId];
  if (!pack?.available) return null;
  return pack.modes?.[mode] ?? null;
}

export function loadStudyGuideMarkdown(chapter: StudyGuideChapter, packId: GuidePackId, mode: GuideReadingMode) {
  const content = resolveStudyGuideContent(chapter, packId, mode);
  if (!content) return Promise.resolve("");
  const cacheKey = `${packId}:${mode}:${chapter.id}:${content.contentHash}`;
  if (!markdownCache.has(cacheKey)) {
    const version = `?v=${encodeURIComponent(content.contentHash)}`;
    const request = fetchCompressedStatic(`${content.markdownPath}${version}`, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Chapter ${chapter.id} 學習指引載入失敗 (${response.status})`);
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
