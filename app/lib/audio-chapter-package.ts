import type { AudioSummarySource } from "./audio-summaries.ts";
import {
  AudioChapterError,
  loadAudioChapters,
  type LoadedAudioChapters,
} from "./audio-chapters.ts";
import { fetchCompressedStatic } from "./compressed-static.ts";

export type SubtitleSectionPair = {
  collection: string;
  source: string;
  chapters: string;
  source_sha256: string;
  chapters_sha256: string;
  profile: "question-bank-five" | "textbook-study";
  cue_count: number;
  chapter_count: number;
  duration: string;
};

export type SubtitleSectionManifest = {
  schema: "subtitle-player-section-manifest-v1";
  generated_at: string;
  counts: {
    collection_count: number;
    pair_count: number;
    cue_count: number;
    chapter_count: number;
    by_collection: Record<string, number>;
  };
  pairs: SubtitleSectionPair[];
};

export type LoadedAudioChapterPackage = LoadedAudioChapters & {
  pair: SubtitleSectionPair;
};

export type LoadAudioChapterPackageOptions = {
  fetch?: typeof globalThis.fetch;
  manifest?: SubtitleSectionManifest;
  manifestUrl?: string;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  chaptersSha256?: (bytes: Uint8Array) => Promise<string>;
  signal?: AbortSignal;
};

const MANIFEST_KEYS = ["schema", "generated_at", "counts", "pairs"] as const;
const COUNT_KEYS = ["collection_count", "pair_count", "cue_count", "chapter_count", "by_collection"] as const;
const PAIR_KEYS = [
  "collection",
  "source",
  "chapters",
  "source_sha256",
  "chapters_sha256",
  "profile",
  "cue_count",
  "chapter_count",
  "duration",
] as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const TIMESTAMP_PATTERN = /^\d{2,}:[0-5]\d:[0-5]\d\.\d{3}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+()-]*$/u;
let defaultManifestRequest: Promise<SubtitleSectionManifest> | null = null;

export function validateSubtitleSectionManifest(value: unknown): SubtitleSectionManifest {
  const root = record(value, "subtitle manifest");
  exactFields(root, MANIFEST_KEYS, "subtitle manifest");
  if (root.schema !== "subtitle-player-section-manifest-v1") {
    throw new AudioChapterError("Subtitle manifest schema is invalid.");
  }
  const generatedAt = requiredString(root.generated_at, "subtitle manifest.generated_at");
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new AudioChapterError("Subtitle manifest.generated_at is invalid.");
  }
  const counts = record(root.counts, "subtitle manifest.counts");
  exactFields(counts, COUNT_KEYS, "subtitle manifest.counts");
  const collectionCount = positiveInteger(counts.collection_count, "collection_count");
  const pairCount = positiveInteger(counts.pair_count, "pair_count");
  const cueCount = positiveInteger(counts.cue_count, "cue_count");
  const chapterCount = positiveInteger(counts.chapter_count, "chapter_count");
  const rawByCollection = record(counts.by_collection, "subtitle manifest.counts.by_collection");
  const byCollection = Object.fromEntries(Object.entries(rawByCollection).map(([collection, count]) => {
    safeSegment(collection, "subtitle manifest collection");
    return [collection, positiveInteger(count, `subtitle manifest count ${collection}`)];
  }));
  if (!Array.isArray(root.pairs) || !root.pairs.length) {
    throw new AudioChapterError("Subtitle manifest.pairs must be a non-empty array.");
  }

  const seenSources = new Set<string>();
  const seenChapters = new Set<string>();
  const calculatedCollections: Record<string, number> = {};
  let calculatedCues = 0;
  let calculatedChapters = 0;
  const pairs = root.pairs.map((rawPair, index): SubtitleSectionPair => {
    const label = `subtitle manifest.pairs[${index}]`;
    const pair = record(rawPair, label);
    exactFields(pair, PAIR_KEYS, label);
    const collection = requiredString(pair.collection, `${label}.collection`);
    safeSegment(collection, `${label}.collection`);
    const source = safePackagePath(pair.source, `${label}.source`, ".src");
    const chapters = safePackagePath(pair.chapters, `${label}.chapters`, ".chapters.json");
    const sourceParts = source.split("/");
    const chapterParts = chapters.split("/");
    if (
      sourceParts[0] !== collection
      || chapterParts[0] !== collection
      || sourceParts.slice(0, -1).join("/") !== chapterParts.slice(0, -1).join("/")
      || source.slice(0, -4) !== chapters.slice(0, -".chapters.json".length)
    ) throw new AudioChapterError(`${label} is not a co-located same-stem pair.`);
    if (seenSources.has(source) || seenChapters.has(chapters)) {
      throw new AudioChapterError(`${label} duplicates a package path.`);
    }
    seenSources.add(source);
    seenChapters.add(chapters);
    const sourceSha256 = requiredHash(pair.source_sha256, `${label}.source_sha256`);
    const chaptersSha256 = requiredHash(pair.chapters_sha256, `${label}.chapters_sha256`);
    if (pair.profile !== "question-bank-five" && pair.profile !== "textbook-study") {
      throw new AudioChapterError(`${label}.profile is invalid.`);
    }
    const pairCueCount = positiveInteger(pair.cue_count, `${label}.cue_count`);
    const pairChapterCount = positiveInteger(pair.chapter_count, `${label}.chapter_count`);
    const duration = requiredString(pair.duration, `${label}.duration`);
    if (!TIMESTAMP_PATTERN.test(duration)) throw new AudioChapterError(`${label}.duration is invalid.`);
    calculatedCollections[collection] = (calculatedCollections[collection] ?? 0) + 1;
    calculatedCues += pairCueCount;
    calculatedChapters += pairChapterCount;
    return {
      collection,
      source,
      chapters,
      source_sha256: sourceSha256,
      chapters_sha256: chaptersSha256,
      profile: pair.profile,
      cue_count: pairCueCount,
      chapter_count: pairChapterCount,
      duration,
    };
  });

  if (
    pairCount !== pairs.length
    || collectionCount !== Object.keys(calculatedCollections).length
    || cueCount !== calculatedCues
    || chapterCount !== calculatedChapters
    || JSON.stringify(sortedRecord(byCollection)) !== JSON.stringify(sortedRecord(calculatedCollections))
  ) throw new AudioChapterError("Subtitle manifest counts do not match its pairs.");

  return {
    schema: "subtitle-player-section-manifest-v1",
    generated_at: generatedAt,
    counts: {
      collection_count: collectionCount,
      pair_count: pairCount,
      cue_count: cueCount,
      chapter_count: chapterCount,
      by_collection: byCollection,
    },
    pairs,
  };
}

export async function loadSubtitleSectionManifest(
  options: Pick<LoadAudioChapterPackageOptions, "fetch" | "manifestUrl" | "signal"> = {},
) {
  if (!options.fetch && !options.manifestUrl && !options.signal) {
    if (defaultManifestRequest) return defaultManifestRequest;
    const pending = requestSubtitleSectionManifest(options).catch((error) => {
      if (defaultManifestRequest === pending) defaultManifestRequest = null;
      throw error;
    });
    defaultManifestRequest = pending;
    return pending;
  }
  return requestSubtitleSectionManifest(options);
}

async function requestSubtitleSectionManifest(
  options: Pick<LoadAudioChapterPackageOptions, "fetch" | "manifestUrl" | "signal">,
) {
  const fetcher = runtimeFetcher(options.fetch);
  const response = await fetcher(options.manifestUrl ?? "/subtitles/manifest.json", {
    cache: "no-cache",
    signal: options.signal,
  });
  if (!response.ok) throw new AudioChapterError(`Subtitle manifest request failed (${response.status}).`);
  let value: unknown;
  try {
    value = JSON.parse(await response.text());
  } catch {
    throw new AudioChapterError("Subtitle manifest is not valid JSON.");
  }
  return validateSubtitleSectionManifest(value);
}

export function subtitlePairForAudioSource(
  manifest: SubtitleSectionManifest,
  source: AudioSummarySource,
) {
  const expectedCollection = subtitleCollectionForAudioSource(source);
  const expectedFilename = `${subtitleStemForAudioSource(source)}.src`;
  const matches = manifest.pairs.filter((pair) => (
    pair.collection === expectedCollection
    && pair.source.split("/").at(-1) === expectedFilename
  ));
  if (matches.length !== 1) {
    throw new AudioChapterError(
      matches.length ? "Audio source has ambiguous subtitle pairs." : "Audio source has no subtitle pair.",
    );
  }
  return matches[0];
}

export async function loadAudioChapterPackage(
  source: AudioSummarySource,
  options: LoadAudioChapterPackageOptions = {},
): Promise<LoadedAudioChapterPackage> {
  const manifest = options.manifest ?? await loadSubtitleSectionManifest(options);
  const pair = subtitlePairForAudioSource(manifest, source);
  const fetcher = runtimeFetcher(options.fetch);
  const srcUrl = versionedSubtitleUrl(pair.source, pair.source_sha256);
  const chaptersUrl = versionedSubtitleUrl(pair.chapters, pair.chapters_sha256);
  const loaded = await loadAudioChapters(srcUrl, {
    fetch: fetcher,
    chaptersUrl,
    expectedChaptersSha256: pair.chapters_sha256,
    sha256: options.sha256,
    chaptersSha256: options.chaptersSha256,
    signal: options.signal,
  });
  if (loaded.metadata.profile !== pair.profile || loaded.metadata.chapters.length !== pair.chapter_count) {
    throw new AudioChapterError("Loaded chapters do not match the package manifest.");
  }
  return { ...loaded, pair };
}

function subtitleCollectionForAudioSource(source: AudioSummarySource) {
  if (source.collectionId === "questions") return "question-bank";
  if (source.collectionId.startsWith("tintinalli")) return "tintinalli";
  if (source.collectionId.startsWith("rosens")) return "rosens";
  return source.collectionId;
}

function subtitleStemForAudioSource(source: AudioSummarySource) {
  const stem = source.file.split("/").at(-1) ?? "";
  safeSegment(stem, "audio subtitle stem");
  return stem;
}

function versionedSubtitleUrl(relative: string, sha256: string) {
  // Package paths have already passed a strict ASCII allowlist. Keep them
  // unescaped because the Worker intentionally rejects percent-encoded logical
  // paths before consulting the content-pack index.
  return `/subtitles/${relative}?v=${sha256}`;
}

function runtimeFetcher(explicit?: typeof globalThis.fetch): typeof globalThis.fetch {
  return explicit ?? ((input, init) => fetchCompressedStatic(String(input), init));
}

function safePackagePath(value: unknown, label: string, suffix: string) {
  const path = requiredString(value, label);
  const parts = path.split("/");
  if (
    !path.endsWith(suffix)
    || parts.length < 2
    || parts.some((part) => !SAFE_SEGMENT_PATTERN.test(part) || part === "." || part === "..")
  ) throw new AudioChapterError(`${label} is unsafe or invalid.`);
  return path;
}

function safeSegment(value: string, label: string) {
  if (!SAFE_SEGMENT_PATTERN.test(value) || value === "." || value === "..") {
    throw new AudioChapterError(`${label} is unsafe or invalid.`);
  }
}

function requiredHash(value: unknown, label: string) {
  const hash = requiredString(value, label);
  if (!HASH_PATTERN.test(hash)) throw new AudioChapterError(`${label} is invalid.`);
  return hash;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw new AudioChapterError(`${label} must be positive.`);
  return Number(value);
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new AudioChapterError(`${label} must be a string.`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AudioChapterError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AudioChapterError(`${label} contains unsupported fields.`);
  }
}

function sortedRecord(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")));
}
