import {
  rosensSupplementalSectionId,
  rosensSupplementalSectionKeys,
  tintinalliSupplementalSectionId,
  type RosensSupplementalSectionKey,
} from "./supplemental-guide-ids.ts";
import { fetchCompressedStatic } from "./compressed-static.ts";
import { LEARNING_SOURCE_REGISTRY } from "./learning-source-registry.ts";

export type SupplementalGuideTextbookId = "tintinalli" | "rosens";

type SupplementalGuideResourceBase = {
  id: string;
  textbookId: SupplementalGuideTextbookId;
  title: string;
  markdownPath: string;
  contentHash: string;
  sourceSha256: string;
  bytes: number;
};

export type SupplementalGuideOverviewEntry = SupplementalGuideResourceBase & {
  id: "overview";
  kind: "overview";
  section: null;
};

export type SupplementalGuideTintinalliSectionEntry = SupplementalGuideResourceBase & {
  textbookId: "tintinalli";
  kind: "section";
  section: number;
};

export type SupplementalGuideRosensSectionEntry = SupplementalGuideResourceBase & {
  textbookId: "rosens";
  kind: "section";
  section: RosensSupplementalSectionKey;
};

export type SupplementalGuideSectionEntry =
  | SupplementalGuideTintinalliSectionEntry
  | SupplementalGuideRosensSectionEntry;

export type SupplementalGuideEntry = SupplementalGuideOverviewEntry | SupplementalGuideSectionEntry;

export type SupplementalGuideCatalog = {
  schemaVersion: 1;
  textbookId: SupplementalGuideTextbookId;
  title: string;
  sourceVersion: string;
  entries: SupplementalGuideEntry[];
};

const manifestPaths: Record<SupplementalGuideTextbookId, string> = {
  tintinalli: "/guides/tintinalli/manifest.json",
  rosens: "/guides/rosens/supplemental-manifest.json",
};

const catalogRequests = new Map<SupplementalGuideTextbookId, Promise<SupplementalGuideCatalog>>();
const markdownRequests = new Map<string, Promise<string>>();

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("讀書指南目錄格式不正確");
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不可為空`);
  return value;
}

function parseResource(
  textbookId: SupplementalGuideTextbookId,
  value: unknown,
  kind: SupplementalGuideEntry["kind"],
  section: number | RosensSupplementalSectionKey | null,
): SupplementalGuideEntry {
  const raw = recordValue(value);
  const id = nonEmptyString(raw.id, "讀書指南資源編號");
  const title = nonEmptyString(raw.title, "讀書指南標題");
  const markdownPath = nonEmptyString(raw.markdownPath, "讀書指南檔案路徑");
  const contentHash = nonEmptyString(raw.contentHash, "讀書指南內容版本");
  const sourceSha256 = nonEmptyString(raw.sourceSha256, "讀書指南來源雜湊");
  const bytes = raw.bytes;
  const pathPrefix = `/guides/${textbookId}/`;

  if (!markdownPath.startsWith(pathPrefix) || !markdownPath.endsWith(".md") || markdownPath.includes("..")) {
    throw new Error("讀書指南檔案路徑不正確");
  }
  if (!/^[a-f0-9]{16}$/u.test(contentHash) || !/^[a-f0-9]{64}$/u.test(sourceSha256) || !sourceSha256.startsWith(contentHash)) {
    throw new Error("讀書指南內容版本不正確");
  }
  if (!Number.isSafeInteger(bytes) || Number(bytes) <= 0) throw new Error("讀書指南檔案大小不正確");

  if (kind === "overview") {
    if (id !== "overview" || section !== null) throw new Error("全書整合指南編號不正確");
    return { id: "overview", textbookId, kind, section: null, title, markdownPath, contentHash, sourceSha256, bytes: Number(bytes) };
  }

  if (textbookId === "tintinalli") {
    if (typeof section !== "number") throw new Error("Tintinalli Section 指南編號不正確");
    const expectedId = tintinalliSupplementalSectionId(section);
    if (!expectedId || id !== expectedId) throw new Error("Tintinalli Section 指南編號不一致");
    return { id, textbookId, kind, section, title, markdownPath, contentHash, sourceSha256, bytes: Number(bytes) };
  }

  if (typeof section !== "string") throw new Error("Rosen’s Section 指南編號不正確");
  const expectedId = rosensSupplementalSectionId(section);
  if (!expectedId || id !== expectedId) throw new Error("Rosen’s Section 指南編號不一致");
  return { id, textbookId, kind, section, title, markdownPath, contentHash, sourceSha256, bytes: Number(bytes) };
}

export function parseSupplementalGuideManifest(textbookId: SupplementalGuideTextbookId, value: unknown): SupplementalGuideCatalog {
  const raw = recordValue(value);
  if (raw.schemaVersion !== 1 || raw.textbookId !== textbookId) throw new Error("讀書指南目錄版本不正確");
  nonEmptyString(raw.title, "教科書標題");
  const title = LEARNING_SOURCE_REGISTRY[textbookId].title;
  const sourceVersion = nonEmptyString(raw.sourceVersion, "讀書指南來源版本");
  const overview = {
    ...parseResource(textbookId, raw.overview, "overview", null),
    title: "Whole-Book Overview",
  } as SupplementalGuideOverviewEntry;
  const entries: SupplementalGuideEntry[] = [overview];

  if (textbookId === "tintinalli") {
    if (!Array.isArray(raw.sections) || raw.sections.length !== 26) throw new Error("Tintinalli Section 指南不完整");
    const sections = raw.sections.map((item) => {
      const sectionRecord = recordValue(item);
      const section = sectionRecord.section;
      if (!Number.isSafeInteger(section)) throw new Error("Tintinalli Section 指南編號不正確");
      return parseResource(textbookId, sectionRecord, "section", Number(section)) as SupplementalGuideTintinalliSectionEntry;
    }).sort((left, right) => left.section - right.section);
    const expectedSections = Array.from({ length: 26 }, (_, index) => index + 1);
    if (!sections.every((entry, index) => entry.section === expectedSections[index])) throw new Error("Tintinalli Section 指南編號不完整");
    entries.push(...sections);
  } else {
    if (!Array.isArray(raw.sections) || raw.sections.length !== rosensSupplementalSectionKeys.length) {
      throw new Error("Rosen’s Section 指南不完整");
    }
    const sections = raw.sections.map((item) => {
      const sectionRecord = recordValue(item);
      const section = sectionRecord.section;
      if (typeof section !== "string" || !rosensSupplementalSectionKeys.includes(section as RosensSupplementalSectionKey)) {
        throw new Error("Rosen’s Section 指南編號不正確");
      }
      return parseResource(textbookId, sectionRecord, "section", section as RosensSupplementalSectionKey) as SupplementalGuideRosensSectionEntry;
    }).sort((left, right) => rosensSupplementalSectionKeys.indexOf(left.section) - rosensSupplementalSectionKeys.indexOf(right.section));
    if (!sections.every((entry, index) => entry.section === rosensSupplementalSectionKeys[index])) {
      throw new Error("Rosen’s Section 指南編號不完整");
    }
    entries.push(...sections);
  }

  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("讀書指南資源編號重複");
  return { schemaVersion: 1, textbookId, title, sourceVersion, entries };
}

export function loadSupplementalGuideCatalog(textbookId: SupplementalGuideTextbookId) {
  const cached = catalogRequests.get(textbookId);
  if (cached) return cached;

  const request = fetchCompressedStatic(manifestPaths[textbookId], { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("讀書指南目錄讀取失敗");
      return response.json() as Promise<unknown>;
    })
    .then((value) => parseSupplementalGuideManifest(textbookId, value))
    .catch((error: unknown) => {
      if (catalogRequests.get(textbookId) === request) catalogRequests.delete(textbookId);
      throw error;
    });

  catalogRequests.set(textbookId, request);
  return request;
}

export function resolveSupplementalGuideEntry(catalog: SupplementalGuideCatalog, requestedResourceId: string | null) {
  return catalog.entries.find((entry) => entry.id === requestedResourceId) ?? catalog.entries[0];
}

export function supplementalGuideDocumentTitle(entry: SupplementalGuideEntry) {
  const bookTitle = LEARNING_SOURCE_REGISTRY[entry.textbookId].title;
  if (entry.kind === "overview") return `${bookTitle} — Whole-Book Overview`;
  return `${bookTitle} — Section ${entry.section} Overview: ${entry.title}`;
}

export function normalizeSupplementalGuideMarkdownTitle(entry: SupplementalGuideEntry, markdown: string) {
  const title = supplementalGuideDocumentTitle(entry);
  return markdown.replace(/^#\s+\S.*$/mu, `# ${title}`);
}

export function loadSupplementalGuideMarkdown(entry: SupplementalGuideEntry) {
  const cacheKey = `${entry.textbookId}:${entry.id}:${entry.contentHash}`;
  const cached = markdownRequests.get(cacheKey);
  if (cached) return cached;

  const version = `?v=${encodeURIComponent(entry.contentHash)}`;
  const request = fetchCompressedStatic(`${entry.markdownPath}${version}`, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("讀書指南內容讀取失敗");
      return response.text();
    })
    .then((markdown) => {
      if (!/^#\s+\S/mu.test(markdown)) throw new Error("讀書指南內容不完整");
      return normalizeSupplementalGuideMarkdownTitle(entry, markdown);
    })
    .catch((error: unknown) => {
      if (markdownRequests.get(cacheKey) === request) markdownRequests.delete(cacheKey);
      throw error;
    });

  markdownRequests.set(cacheKey, request);
  return request;
}
