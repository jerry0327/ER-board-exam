export type AudioSummaryKind = "textbook-chapter" | "textbook-section" | "question-set";

/**
 * Stable content identity used by every learning reader. Display titles and
 * filenames are intentionally excluded: they may change without breaking the
 * attachment between a learning resource and its audio.
 */
export type LearningAudioLocator =
  | { kind: "textbook-chapter"; textbookId: string; chapterId: string | number | null | undefined }
  | { kind: "textbook-section"; textbookId: string; sectionId: string | number | null | undefined }
  | { kind: "question"; questionId: string | null | undefined }
  | { kind: "board-unit"; unitCode: string | null | undefined };

export type AudioSummarySource = {
  id: string;
  collectionId: string;
  collectionTitle: string;
  /** Optional UI grouping for several independently ordered audio collections. */
  libraryId?: string;
  libraryTitle?: string;
  kind: AudioSummaryKind;
  sequence: number;
  textbook: string;
  chapterId: string;
  chapterLabel: string;
  /** Present on section-level audio. Chapter audio is mapped by the shared taxonomy. */
  sectionId?: string;
  sectionLabel?: string;
  sectionTitle?: string;
  title: string;
  file: string;
  durationSeconds: number;
  encodedSpeed: number;
  revision: string;
  dataBytes: number;
  dataSha256: string;
  metadataBytes: number;
  metadataSha256: string;
  questionExam?: string;
  questionStart?: number;
  questionEnd?: number;
};

// The catalog stays outside the application bundle, so adding thousands of
// audio entries does not increase the player JavaScript or its startup cost.
export const audioSummaries: AudioSummarySource[] = [];

function questionRangeLabel(source: AudioSummarySource) {
  if (
    source.kind !== "question-set"
    || !Number.isInteger(source.questionStart)
    || !Number.isInteger(source.questionEnd)
  ) return null;
  const start = String(source.questionStart).padStart(3, "0");
  const end = String(source.questionEnd).padStart(3, "0");
  return `Q${start}–${end}`;
}

export function audioSummaryDisplayMarker(source: AudioSummarySource) {
  if (source.kind === "question-set") return "題庫";
  if (source.kind === "textbook-section") return source.sectionLabel ?? `SECTION ${source.sectionId ?? source.chapterId}`;
  return source.chapterLabel;
}

export function audioSummaryDisplayTitle(source: AudioSummarySource) {
  if (source.kind === "question-set" && source.questionExam) {
    return `${source.questionExam} · ${questionRangeLabel(source) ?? source.chapterLabel}`;
  }
  if (source.kind === "textbook-section" && source.sectionTitle) return source.sectionTitle;
  return source.title;
}

export function audioSummaryDisplayName(source: AudioSummarySource) {
  if (source.kind === "question-set") return audioSummaryDisplayTitle(source);
  return `${audioSummaryDisplayMarker(source)} ${audioSummaryDisplayTitle(source)}`.trim();
}

export function audioSummaryLibraryId(source: AudioSummarySource) {
  return source.libraryId ?? source.collectionId;
}

export function audioSummaryLibraryTitle(source: AudioSummarySource) {
  return source.libraryTitle ?? source.collectionTitle;
}

let activeAudioSummaries = audioSummaries;
let audioSummaryById = new Map(audioSummaries.map((source) => [source.id, source]));
let textbookChapterAudioByKey = new Map<string, AudioSummarySource>();
let textbookSectionAudioByKey = new Map<string, AudioSummarySource>();
let boardGuideAudioByUnit = new Map<string, AudioSummarySource>();
let questionAudioByQuestionId = new Map<string, AudioSummarySource>();
let collectionAudioById = new Map<string, AudioSummarySource[]>();
let collectionPositionById = new Map<string, number>();
let catalogRequest: Promise<AudioSummarySource[]> | null = null;
let catalogLoadError: Error | null = null;

function isSha256(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isAudioSummarySource(value: unknown): value is AudioSummarySource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<AudioSummarySource>;
  return typeof source.id === "string"
    && /^[a-z0-9][a-z0-9:_-]*$/u.test(source.id)
    && typeof source.collectionId === "string"
    && /^[a-z0-9][a-z0-9_-]*$/u.test(source.collectionId)
    && typeof source.collectionTitle === "string"
    && source.collectionTitle.trim().length > 0
    && (source.kind === "textbook-chapter" || source.kind === "textbook-section" || source.kind === "question-set")
    && (source.libraryId === undefined || /^[a-z0-9][a-z0-9_-]*$/u.test(source.libraryId))
    && (source.libraryTitle === undefined || (typeof source.libraryTitle === "string" && source.libraryTitle.trim().length > 0))
    && Number.isInteger(source.sequence)
    && Number(source.sequence) > 0
    && typeof source.textbook === "string"
    && /^[a-z0-9][a-z0-9_-]*$/u.test(source.textbook)
    && typeof source.chapterId === "string"
    && typeof source.chapterLabel === "string"
    && (source.sectionId === undefined || (typeof source.sectionId === "string" && /^[a-z0-9][a-z0-9_-]*$/u.test(source.sectionId)))
    && (source.sectionLabel === undefined || (typeof source.sectionLabel === "string" && source.sectionLabel.trim().length > 0))
    && (source.sectionTitle === undefined || (typeof source.sectionTitle === "string" && source.sectionTitle.trim().length > 0))
    && typeof source.title === "string"
    && typeof source.file === "string"
    && /^releases\/[a-f0-9]{12,64}\/[A-Za-z0-9][^/\\]*$/u.test(source.file)
    && typeof source.durationSeconds === "number"
    && Number.isFinite(source.durationSeconds)
    && source.durationSeconds > 0
    && typeof source.encodedSpeed === "number"
    && Number.isFinite(source.encodedSpeed)
    && source.encodedSpeed > 0
    && typeof source.revision === "string"
    && /^[a-f0-9]{12,64}$/u.test(source.revision)
    && Number.isInteger(source.dataBytes)
    && Number(source.dataBytes) > 0
    && isSha256(source.dataSha256)
    && Number.isInteger(source.metadataBytes)
    && Number(source.metadataBytes) > 0
    && isSha256(source.metadataSha256)
    && (source.questionExam === undefined || /^\d{3}[AB]?$/u.test(source.questionExam))
    && (source.questionStart === undefined || Number.isInteger(source.questionStart))
    && (source.questionEnd === undefined || Number.isInteger(source.questionEnd))
    && (source.kind !== "textbook-section" || (
      typeof source.sectionId === "string"
      && typeof source.sectionLabel === "string"
    ))
    && (source.kind !== "question-set" || (
      typeof source.questionExam === "string"
      && /^\d{3}[AB]?$/u.test(source.questionExam)
      && Number.isInteger(source.questionStart)
      && Number.isInteger(source.questionEnd)
      && Number(source.questionStart) > 0
      && Number(source.questionEnd) >= Number(source.questionStart)
    ));
}

function activateAudioCatalog(sources: AudioSummarySource[]) {
  const ids = new Set<string>();
  const resources = new Set<string>();
  const files = new Set<string>();
  const collections = new Map<string, AudioSummarySource[]>();

  for (const source of sources) {
    const resourceKey = `${source.collectionId}:${source.kind}:${source.sectionId ?? source.chapterId}`;
    if (ids.has(source.id)) throw new Error(`Duplicate audio id: ${source.id}`);
    if (resources.has(resourceKey)) throw new Error(`Duplicate audio resource: ${resourceKey}`);
    if (files.has(source.file)) throw new Error(`Duplicate audio file: ${source.file}`);
    ids.add(source.id);
    resources.add(resourceKey);
    files.add(source.file);
    const collection = collections.get(source.collectionId) ?? [];
    collection.push(source);
    collections.set(source.collectionId, collection);
  }

  for (const collection of collections.values()) {
    collection.sort((left, right) => left.sequence - right.sequence);
  }

  activeAudioSummaries = sources;
  audioSummaryById = new Map(sources.map((source) => [source.id, source]));
  textbookChapterAudioByKey = new Map(
    sources
      .filter((source) => source.kind === "textbook-chapter")
      .map((source) => [`${source.textbook}:${source.chapterId.toLocaleLowerCase("en")}`, source]),
  );
  textbookSectionAudioByKey = new Map(
    sources
      .filter((source) => source.kind === "textbook-section" && source.sectionId)
      .map((source) => [`${source.textbook}:${source.sectionId!.toLocaleLowerCase("en")}`, source]),
  );
  boardGuideAudioByUnit = new Map(
    sources
      .filter((source) => source.textbook === "board" && source.kind === "textbook-chapter")
      .map((source) => [source.chapterId.toUpperCase(), source]),
  );
  questionAudioByQuestionId = new Map();
  for (const source of sources.filter((candidate) => candidate.kind === "question-set")) {
    for (let number = source.questionStart!; number <= source.questionEnd!; number += 1) {
      const questionId = `${source.questionExam}-Q${String(number).padStart(3, "0")}`;
      if (questionAudioByQuestionId.has(questionId)) throw new Error(`Duplicate question audio: ${questionId}`);
      questionAudioByQuestionId.set(questionId, source);
    }
  }
  collectionAudioById = collections;
  collectionPositionById = new Map();
  for (const collection of collections.values()) {
    collection.forEach((source, index) => collectionPositionById.set(source.id, index));
  }
  return sources;
}

export function currentAudioSummaryCatalog() {
  return activeAudioSummaries;
}

export function currentAudioSummaryCatalogError() {
  return catalogLoadError;
}

export function loadAudioSummaryCatalog() {
  if (typeof window === "undefined") return Promise.resolve(activeAudioSummaries);
  if (catalogRequest) return catalogRequest;
  catalogRequest = fetch("/audio/snac/catalog.json", { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Audio catalog could not be loaded.");
      const catalog = await response.json() as {
        schema?: string;
        catalogRevision?: string;
        itemCount?: number;
        entries?: AudioSummarySource[];
      };
      if (
        catalog.schema !== "em-board-audio-catalog-v2"
        || !/^[a-f0-9]{20}$/u.test(catalog.catalogRevision ?? "")
        || !Array.isArray(catalog.entries)
        || !catalog.entries.length
        || catalog.itemCount !== catalog.entries.length
      ) {
        throw new Error("Audio catalog is empty.");
      }
      if (!catalog.entries.every(isAudioSummarySource)) {
        throw new Error("Audio catalog contains an invalid entry.");
      }
      const calculatedRevision = (await sha256Hex(JSON.stringify(catalog.entries))).slice(0, 20);
      if (calculatedRevision !== catalog.catalogRevision) {
        throw new Error("Audio catalog integrity verification failed.");
      }
      catalogLoadError = null;
      return activateAudioCatalog(catalog.entries);
    })
    .catch((reason) => {
      catalogRequest = null;
      catalogLoadError = reason instanceof Error
        ? reason
        : new Error("Audio catalog could not be loaded.");
      return activeAudioSummaries;
    });
  return catalogRequest;
}

export function audioSummaryForId(id: string | null | undefined) {
  return id ? audioSummaryById.get(id) ?? null : null;
}

export function audioSummaryForTextbookChapter(
  textbookId: string | null | undefined,
  chapterId: string | number | null | undefined,
) {
  if (!textbookId || chapterId === null || chapterId === undefined) return null;
  const normalizedTextbook = textbookId.trim().toLocaleLowerCase("en");
  const rawChapter = String(chapterId).trim().toLocaleLowerCase("en");
  const candidates = /^\d{1,4}$/u.test(rawChapter)
    ? [String(Number(rawChapter)).padStart(3, "0"), rawChapter]
    : [rawChapter];
  for (const candidate of candidates) {
    const source = textbookChapterAudioByKey.get(`${normalizedTextbook}:${candidate}`);
    if (source) return source;
  }
  return null;
}

export function audioSummaryForTextbookSection(
  textbookId: string | null | undefined,
  sectionId: string | number | null | undefined,
) {
  if (!textbookId || sectionId === null || sectionId === undefined) return null;
  const normalizedTextbook = textbookId.trim().toLocaleLowerCase("en");
  const rawSection = String(sectionId).trim().toLocaleLowerCase("en");
  const candidates = /^\d{1,3}$/u.test(rawSection)
    ? [String(Number(rawSection)), rawSection.padStart(3, "0")]
    : [rawSection];
  for (const candidate of candidates) {
    const source = textbookSectionAudioByKey.get(`${normalizedTextbook}:${candidate}`);
    if (source) return source;
  }
  return null;
}

export function audioSummaryForTintinalliChapter(chapterId: string | number | null | undefined) {
  return audioSummaryForTextbookChapter("tintinalli", chapterId);
}

export function audioSummaryForRosensChapter(chapterId: string | null | undefined) {
  if (!chapterId) return null;
  const normalized = chapterId.trim().toLowerCase();
  if (/^\d{1,4}$/u.test(normalized)) {
    return audioSummaryForTextbookChapter("rosens", String(Number(normalized)).padStart(3, "0"));
  }
  const onlineMatch = /^e(\d{1,2})$/u.exec(normalized);
  const onlineSequence = Number(onlineMatch?.[1]);
  if (!onlineMatch || onlineSequence < 1 || onlineSequence > 16) return null;
  return audioSummaryForTextbookChapter("rosens", String(192 + onlineSequence).padStart(3, "0"));
}

export function audioSummaryForQuestion(questionId: string | null | undefined) {
  return questionId ? questionAudioByQuestionId.get(questionId.toUpperCase()) ?? null : null;
}

export function audioSummaryForBoardGuideUnit(unitCode: string | null | undefined) {
  return unitCode ? boardGuideAudioByUnit.get(unitCode.trim().toUpperCase()) ?? null : null;
}

/**
 * One data-driven resolver for all reader surfaces. Importers must assign the
 * stable locator fields; readers never infer attachment from a display name.
 */
export function audioSummaryForLearningResource(locator: LearningAudioLocator | null | undefined) {
  if (!locator) return null;
  if (locator.kind === "question") return audioSummaryForQuestion(locator.questionId);
  if (locator.kind === "board-unit") return audioSummaryForBoardGuideUnit(locator.unitCode);
  if (locator.kind === "textbook-section") {
    return audioSummaryForTextbookSection(locator.textbookId, locator.sectionId);
  }
  return locator.textbookId.trim().toLocaleLowerCase("en") === "rosens"
    ? audioSummaryForRosensChapter(String(locator.chapterId ?? ""))
    : audioSummaryForTextbookChapter(locator.textbookId, locator.chapterId);
}

export function adjacentAudioSummary(
  sourceId: string | null | undefined,
  direction: -1 | 1,
) {
  const source = audioSummaryForId(sourceId);
  const index = sourceId ? collectionPositionById.get(sourceId) : undefined;
  if (!source || index === undefined) return null;
  return collectionAudioById.get(source.collectionId)?.[index + direction] ?? null;
}

export function hasAlternativeAudioSummary(sourceId: string | null | undefined) {
  const source = audioSummaryForId(sourceId);
  if (!source) return false;
  return (collectionAudioById.get(source.collectionId)?.length ?? 0) > 1;
}

export function randomAudioSummary(
  sourceId: string | null | undefined,
  excludedSourceIds: readonly string[] = [],
) {
  const source = audioSummaryForId(sourceId);
  if (!source) return null;
  const collection = collectionAudioById.get(source.collectionId) ?? [];
  const excluded = new Set([source.id, ...excludedSourceIds]);
  const preferred = collection.filter((candidate) => !excluded.has(candidate.id));
  const candidates = preferred.length > 0
    ? preferred
    : collection.filter((candidate) => candidate.id !== source.id);
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export function upcomingAudioSummaries(
  sourceId: string | null | undefined,
  limit = 6,
) {
  const source = audioSummaryForId(sourceId);
  if (!source) return activeAudioSummaries.slice(0, Math.max(0, limit));
  const collection = collectionAudioById.get(source.collectionId) ?? [];
  const index = collectionPositionById.get(source.id) ?? -1;
  return collection.slice(index + 1, index + 1 + Math.max(0, limit));
}
