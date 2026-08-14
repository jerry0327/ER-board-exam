/* Hash-bound loader for the deployable HXT2/HXM2 subtitle runtime pack.
 *
 * Canonical SRC + chapters remains the editable/handoff authority. This module
 * deliberately never requests either raw master format at runtime: it fetches
 * only a Brotli-indexed HXT bundle member and a small opaque HXM sidecar, then
 * recreates and verifies the standard player objects locally.
 */

import type { AudioSummarySource } from "./audio-summaries.ts";
import { AudioChapterError, type LoadedAudioChapters } from "./audio-chapters.ts";
import { fetchCompressedStatic, fetchCompressedStaticBytes } from "./compressed-static.ts";
import {
  decodeRuntimeSemanticSubtitle,
  type DecodedRuntimeSemanticSubtitle,
} from "./subtitle-runtime-semantic-codec.ts";

const SCHEMA = "subtitle-runtime-semantic-manifest-v2" as const;
const CODEC = "subtitle-runtime-semantic-hxt-hxm-v2" as const;
const MANIFEST_KEYS = [
  "schema", "codec", "generated_at", "terminal_unavailable_sha256", "counts", "bundles", "entries",
] as const;
const COUNT_KEYS = [
  "collection_count", "pair_count", "cue_count", "chapter_count", "by_collection", "hxt_bytes", "hxm_bytes",
] as const;
const BUNDLE_KEYS = ["path", "sha256", "bytes", "member_count"] as const;
const ENTRY_KEYS = [
  "collection", "source", "source_sha256", "chapters_sha256", "profile", "cue_count", "chapter_count", "duration",
  "hxt_bundle", "hxt_offset", "hxt_bytes", "hxt_sha256", "hxm", "hxm_sha256", "hxm_bytes",
] as const;
const HASH = /^[a-f0-9]{64}$/u;
const TIMESTAMP = /^\d{2,}:[0-5]\d:[0-5]\d\.\d{3}$/u;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@+()-]*$/u;
let defaultManifestRequest: Promise<RuntimeSemanticSubtitleManifest> | null = null;

export type RuntimeSemanticBundle = {
  path: string;
  sha256: string;
  bytes: number;
  member_count: number;
};

export type RuntimeSemanticSubtitleEntry = {
  collection: string;
  source: string;
  source_sha256: string;
  chapters_sha256: string;
  profile: "question-bank-five" | "textbook-study";
  cue_count: number;
  chapter_count: number;
  duration: string;
  hxt_bundle: string;
  hxt_offset: number;
  hxt_bytes: number;
  hxt_sha256: string;
  hxm: string;
  hxm_sha256: string;
  hxm_bytes: number;
};

export type RuntimeSemanticSubtitleManifest = {
  schema: typeof SCHEMA;
  codec: typeof CODEC;
  generated_at: string;
  terminal_unavailable_sha256: string | null;
  counts: {
    collection_count: number;
    pair_count: number;
    cue_count: number;
    chapter_count: number;
    by_collection: Record<string, number>;
    hxt_bytes: number;
    hxm_bytes: number;
  };
  bundles: RuntimeSemanticBundle[];
  entries: RuntimeSemanticSubtitleEntry[];
};

export type LoadedRuntimeSemanticAudioChapters = LoadedAudioChapters & {
  pair: RuntimeSemanticSubtitleEntry;
  runtime: Pick<DecodedRuntimeSemanticSubtitle, "sourceSha256" | "chaptersSha256" | "hxtSha256" | "hxmSha256" | "cueCount" | "checkpointStride">;
};

export type LoadRuntimeSemanticAudioChaptersOptions = {
  fetch?: typeof globalThis.fetch;
  manifest?: RuntimeSemanticSubtitleManifest;
  manifestUrl?: string;
  signal?: AbortSignal;
};

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AudioChapterError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new AudioChapterError(`${label} contains unsupported or noncanonical fields.`);
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new AudioChapterError(`${label} must be a non-empty string.`);
  return value;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AudioChapterError(`${label} must be a positive integer.`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AudioChapterError(`${label} must be a non-negative integer.`);
  return Number(value);
}

function requiredHash(value: unknown, label: string) {
  const hash = requiredString(value, label);
  if (!HASH.test(hash)) throw new AudioChapterError(`${label} is invalid.`);
  return hash;
}

function safePath(value: unknown, suffix: string, label: string) {
  const path = requiredString(value, label);
  const parts = path.split("/");
  if (
    !path.endsWith(suffix)
    || parts.length < 2
    || parts.some((part) => !SEGMENT.test(part) || part === "." || part === "..")
  ) throw new AudioChapterError(`${label} is unsafe or invalid.`);
  return path;
}

function safeCollection(value: unknown, label: string) {
  const collection = requiredString(value, label);
  if (!SEGMENT.test(collection) || collection === "." || collection === "..") {
    throw new AudioChapterError(`${label} is unsafe or invalid.`);
  }
  return collection;
}

function sortedRecord(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")));
}

export function validateRuntimeSemanticSubtitleManifest(value: unknown): RuntimeSemanticSubtitleManifest {
  const root = record(value, "semantic subtitle manifest");
  exactKeys(root, MANIFEST_KEYS, "semantic subtitle manifest");
  if (root.schema !== SCHEMA || root.codec !== CODEC) {
    throw new AudioChapterError("Semantic subtitle manifest schema or codec is invalid.");
  }
  const generatedAt = requiredString(root.generated_at, "semantic subtitle manifest.generated_at");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new AudioChapterError("Semantic subtitle manifest.generated_at is invalid.");
  if (root.terminal_unavailable_sha256 !== null) {
    throw new AudioChapterError("Semantic subtitle manifest may not bind unavailable placeholders.");
  }
  const terminalUnavailableSha256 = null;
  const countsRaw = record(root.counts, "semantic subtitle manifest.counts");
  exactKeys(countsRaw, COUNT_KEYS, "semantic subtitle manifest.counts");
  const rawByCollection = record(countsRaw.by_collection, "semantic subtitle manifest.counts.by_collection");
  const declaredByCollection = Object.fromEntries(Object.entries(rawByCollection).map(([collection, count]) => [
    safeCollection(collection, "semantic subtitle manifest collection"),
    positiveInteger(count, `semantic subtitle manifest count ${collection}`),
  ]));
  const counts = {
    collection_count: positiveInteger(countsRaw.collection_count, "semantic subtitle manifest collection_count"),
    pair_count: positiveInteger(countsRaw.pair_count, "semantic subtitle manifest pair_count"),
    cue_count: positiveInteger(countsRaw.cue_count, "semantic subtitle manifest cue_count"),
    chapter_count: positiveInteger(countsRaw.chapter_count, "semantic subtitle manifest chapter_count"),
    by_collection: declaredByCollection,
    hxt_bytes: positiveInteger(countsRaw.hxt_bytes, "semantic subtitle manifest hxt_bytes"),
    hxm_bytes: positiveInteger(countsRaw.hxm_bytes, "semantic subtitle manifest hxm_bytes"),
  };
  if (!Array.isArray(root.bundles) || !root.bundles.length || !Array.isArray(root.entries) || !root.entries.length) {
    throw new AudioChapterError("Semantic subtitle manifest has no bundles or entries.");
  }
  const bundles = root.bundles.map((rawBundle, index): RuntimeSemanticBundle => {
    const label = `semantic subtitle manifest.bundles[${index}]`;
    const bundle = record(rawBundle, label);
    exactKeys(bundle, BUNDLE_KEYS, label);
    const sha256 = requiredHash(bundle.sha256, `${label}.sha256`);
    const path = safePath(bundle.path, ".hxtb", `${label}.path`);
    if (path !== `bundles/${sha256}.hxtb`) throw new AudioChapterError(`${label}.path does not bind its hash.`);
    return {
      path,
      sha256,
      bytes: positiveInteger(bundle.bytes, `${label}.bytes`),
      member_count: positiveInteger(bundle.member_count, `${label}.member_count`),
    };
  });
  const bundleByPath = new Map<string, RuntimeSemanticBundle>();
  for (const bundle of bundles) {
    if (bundleByPath.has(bundle.path)) throw new AudioChapterError("Semantic subtitle manifest has duplicate bundles.");
    bundleByPath.set(bundle.path, bundle);
  }
  if (!bundles.every((bundle, index) => index === 0 || bundles[index - 1].path < bundle.path)) {
    throw new AudioChapterError("Semantic subtitle manifest bundles are not sorted.");
  }
  const byCollection: Record<string, number> = {};
  const bundleOffsets = new Map<string, { offset: number; count: number }>();
  const sourcePaths = new Set<string>();
  let cueCount = 0;
  let chapterCount = 0;
  let hxtBytes = 0;
  let hxmBytes = 0;
  let previousSource = "";
  const entries = root.entries.map((rawEntry, index): RuntimeSemanticSubtitleEntry => {
    const label = `semantic subtitle manifest.entries[${index}]`;
    const entry = record(rawEntry, label);
    exactKeys(entry, ENTRY_KEYS, label);
    const source = safePath(entry.source, ".src", `${label}.source`);
    const collection = safeCollection(entry.collection, `${label}.collection`);
    if (source.split("/")[0] !== collection || source <= previousSource || sourcePaths.has(source)) {
      throw new AudioChapterError(`${label}.source is duplicated, unsorted, or mismatched.`);
    }
    previousSource = source;
    sourcePaths.add(source);
    const profile = entry.profile;
    if (profile !== "question-bank-five" && profile !== "textbook-study") throw new AudioChapterError(`${label}.profile is invalid.`);
    const hxtBundle = safePath(entry.hxt_bundle, ".hxtb", `${label}.hxt_bundle`);
    const bundle = bundleByPath.get(hxtBundle);
    if (!bundle) throw new AudioChapterError(`${label}.hxt_bundle is absent from bundles.`);
    const hxtOffset = nonNegativeInteger(entry.hxt_offset, `${label}.hxt_offset`);
    const hxtBytesForEntry = positiveInteger(entry.hxt_bytes, `${label}.hxt_bytes`);
    if (hxtOffset + hxtBytesForEntry > bundle.bytes) throw new AudioChapterError(`${label}.hxt bounds are invalid.`);
    const hxmSha256 = requiredHash(entry.hxm_sha256, `${label}.hxm_sha256`);
    const hxm = safePath(entry.hxm, ".hxm", `${label}.hxm`);
    if (hxm !== `timing/${hxmSha256}.hxm`) throw new AudioChapterError(`${label}.hxm does not bind its hash.`);
    const state = bundleOffsets.get(hxtBundle) ?? { offset: 0, count: 0 };
    if (hxtOffset !== state.offset) throw new AudioChapterError(`${label}.hxt_offset does not form a complete bundle partition.`);
    bundleOffsets.set(hxtBundle, { offset: hxtOffset + hxtBytesForEntry, count: state.count + 1 });
    const duration = requiredString(entry.duration, `${label}.duration`);
    if (!TIMESTAMP.test(duration)) throw new AudioChapterError(`${label}.duration is invalid.`);
    const parsed: RuntimeSemanticSubtitleEntry = {
      collection,
      source,
      source_sha256: requiredHash(entry.source_sha256, `${label}.source_sha256`),
      chapters_sha256: requiredHash(entry.chapters_sha256, `${label}.chapters_sha256`),
      profile,
      cue_count: positiveInteger(entry.cue_count, `${label}.cue_count`),
      chapter_count: positiveInteger(entry.chapter_count, `${label}.chapter_count`),
      duration,
      hxt_bundle: hxtBundle,
      hxt_offset: hxtOffset,
      hxt_bytes: hxtBytesForEntry,
      hxt_sha256: requiredHash(entry.hxt_sha256, `${label}.hxt_sha256`),
      hxm,
      hxm_sha256: hxmSha256,
      hxm_bytes: positiveInteger(entry.hxm_bytes, `${label}.hxm_bytes`),
    };
    byCollection[collection] = (byCollection[collection] ?? 0) + 1;
    cueCount += parsed.cue_count;
    chapterCount += parsed.chapter_count;
    hxtBytes += parsed.hxt_bytes;
    hxmBytes += parsed.hxm_bytes;
    return parsed;
  });
  for (const bundle of bundles) {
    const state = bundleOffsets.get(bundle.path);
    if (!state || state.offset !== bundle.bytes || state.count !== bundle.member_count) {
      throw new AudioChapterError(`Semantic subtitle bundle ${bundle.path} is not fully partitioned.`);
    }
  }
  if (
    counts.collection_count !== Object.keys(byCollection).length
    || counts.pair_count !== entries.length
    || counts.cue_count !== cueCount
    || counts.chapter_count !== chapterCount
    || counts.hxt_bytes !== hxtBytes
    || counts.hxm_bytes !== hxmBytes
    || JSON.stringify(sortedRecord(counts.by_collection)) !== JSON.stringify(sortedRecord(byCollection))
  ) throw new AudioChapterError("Semantic subtitle manifest counts do not match entries.");
  return {
    schema: SCHEMA,
    codec: CODEC,
    generated_at: generatedAt,
    terminal_unavailable_sha256: terminalUnavailableSha256,
    counts,
    bundles,
    entries,
  };
}

async function sha256Hex(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new AudioChapterError("SHA-256 is unavailable.");
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", copied));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function responseBytes(response: Response, label: string) {
  if (!response.ok) throw new AudioChapterError(`${label} request failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function semanticUrl(relative: string, sha256: string) {
  return `/subtitles-runtime/${relative}?v=${sha256}`;
}

function sourceCollection(source: AudioSummarySource) {
  if (source.collectionId === "questions") return "question-bank";
  if (source.collectionId.startsWith("tintinalli")) return "tintinalli";
  if (source.collectionId.startsWith("rosens")) return "rosens";
  return source.collectionId;
}

function sourceStem(source: AudioSummarySource) {
  const stem = source.file.split("/").at(-1) ?? "";
  if (!SEGMENT.test(stem)) throw new AudioChapterError("Audio subtitle stem is unsafe or invalid.");
  return stem;
}

export function runtimeSemanticSourceForAudioSource(source: AudioSummarySource) {
  return `${sourceCollection(source)}/${sourceStem(source)}.src`;
}

export function runtimeSemanticPairForAudioSource(manifest: RuntimeSemanticSubtitleManifest, source: AudioSummarySource) {
  const expectedSource = runtimeSemanticSourceForAudioSource(source);
  const matches = manifest.entries.filter((entry) => entry.source === expectedSource);
  if (matches.length !== 1) {
    throw new AudioChapterError(matches.length ? "Audio source has ambiguous semantic subtitle entries." : "Audio source has no semantic subtitle entry.");
  }
  return matches[0];
}

async function requestManifest(options: Pick<LoadRuntimeSemanticAudioChaptersOptions, "fetch" | "manifestUrl" | "signal">) {
  const url = options.manifestUrl ?? "/subtitles-runtime/manifest.json";
  const response = options.fetch
    ? await options.fetch(url, { cache: "no-cache", signal: options.signal })
    : await fetchCompressedStatic(url, { cache: "no-cache", signal: options.signal });
  if (!response.ok) throw new AudioChapterError(`Semantic subtitle manifest request failed (${response.status}).`);
  let text: string;
  let value: unknown;
  try {
    text = await response.text();
    value = JSON.parse(text);
  } catch {
    throw new AudioChapterError("Semantic subtitle manifest is not valid JSON.");
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    throw new AudioChapterError("Semantic subtitle manifest is not canonical JSON.");
  }
  return validateRuntimeSemanticSubtitleManifest(value);
}

export async function loadRuntimeSemanticSubtitleManifest(
  options: Pick<LoadRuntimeSemanticAudioChaptersOptions, "fetch" | "manifestUrl" | "signal"> = {},
) {
  if (!options.fetch && !options.manifestUrl && !options.signal) {
    if (defaultManifestRequest) return defaultManifestRequest;
    const pending = requestManifest(options).catch((error) => {
      if (defaultManifestRequest === pending) defaultManifestRequest = null;
      throw error;
    });
    defaultManifestRequest = pending;
    return pending;
  }
  return requestManifest(options);
}

async function requestBinary(
  logicalPath: string,
  expectedSha256: string,
  label: string,
  options: LoadRuntimeSemanticAudioChaptersOptions,
) {
  const response = options.fetch
    ? await options.fetch(logicalPath, { cache: "force-cache", signal: options.signal })
    : await fetchCompressedStaticBytes(logicalPath, { cache: "force-cache", signal: options.signal });
  const bytes = await responseBytes(response, label);
  if (await sha256Hex(bytes) !== expectedSha256) throw new AudioChapterError(`${label} SHA-256 does not match the manifest.`);
  return bytes;
}

export async function loadRuntimeSemanticAudioChapters(
  source: AudioSummarySource,
  options: LoadRuntimeSemanticAudioChaptersOptions = {},
): Promise<LoadedRuntimeSemanticAudioChapters> {
  const manifest = options.manifest ?? await loadRuntimeSemanticSubtitleManifest(options);
  const pair = runtimeSemanticPairForAudioSource(manifest, source);
  const bundle = manifest.bundles.find((item) => item.path === pair.hxt_bundle);
  if (!bundle) throw new AudioChapterError("Semantic subtitle bundle is missing from manifest.");
  const [bundleBytes, hxmBytes] = await Promise.all([
    requestBinary(semanticUrl(bundle.path, bundle.sha256), bundle.sha256, "Semantic HXT bundle", options),
    requestBinary(semanticUrl(pair.hxm, pair.hxm_sha256), pair.hxm_sha256, "Semantic HXM sidecar", options),
  ]);
  const hxtBytes = bundleBytes.slice(pair.hxt_offset, pair.hxt_offset + pair.hxt_bytes);
  if (hxtBytes.byteLength !== pair.hxt_bytes || await sha256Hex(hxtBytes) !== pair.hxt_sha256) {
    throw new AudioChapterError("Semantic HXT member bounds or SHA-256 do not match the manifest.");
  }
  let decoded: DecodedRuntimeSemanticSubtitle;
  try {
    decoded = await decodeRuntimeSemanticSubtitle(hxtBytes, hxmBytes, {
      sourceSha256: pair.source_sha256,
      chaptersSha256: pair.chapters_sha256,
      hxtSha256: pair.hxt_sha256,
      hxmSha256: pair.hxm_sha256,
    });
  } catch (error) {
    // The nested codec message is intentionally not surfaced as a transport
    // detail; this public loader has one fail-closed contract for all pair
    // verification failures.
    void error;
    throw new AudioChapterError("Semantic subtitle pair failed hash or structural verification.");
  }
  if (
    decoded.cueCount !== pair.cue_count
    || decoded.metadata.profile !== pair.profile
    || decoded.metadata.chapters.length !== pair.chapter_count
    || decoded.subtitle.cues.at(-1)?.end !== pair.duration
  ) throw new AudioChapterError("Decoded semantic subtitle pair does not match its manifest entry.");
  return {
    srcUrl: semanticUrl(bundle.path, bundle.sha256),
    chaptersUrl: semanticUrl(pair.hxm, pair.hxm_sha256),
    subtitle: decoded.subtitle,
    metadata: decoded.metadata,
    pair,
    runtime: {
      sourceSha256: decoded.sourceSha256,
      chaptersSha256: decoded.chaptersSha256,
      hxtSha256: decoded.hxtSha256,
      hxmSha256: decoded.hxmSha256,
      cueCount: decoded.cueCount,
      checkpointStride: decoded.checkpointStride,
    },
  };
}
