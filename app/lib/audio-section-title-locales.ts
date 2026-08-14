import type { AudioSummarySource } from "./audio-summaries.ts";
import type { AudioChapterMetadata } from "./audio-chapters.ts";
import { fetchCompressedStatic } from "./compressed-static.ts";
import { runtimeSemanticSourceForAudioSource } from "./audio-runtime-semantic-package.ts";

export type SectionTitleLanguage = "zh-TW" | "en";

export type SectionTitleLocale = {
  "zh-TW": string;
  en: string;
};

export type LoadedSectionTitleLocales = {
  source: string;
  sourceSha256: string;
  chaptersSha256: string;
  titles: Readonly<Record<string, SectionTitleLocale>>;
};

type SectionTitleLocaleManifestEntry = {
  source: string;
  source_sha256: string;
  chapters_sha256: string;
  bundle: string;
  title_count: number;
};

type SectionTitleLocaleBundle = {
  schema: "section-title-locale-bundle-v1";
  collection: string;
  entries: Record<string, {
    source_sha256: string;
    chapters_sha256: string;
    titles: Record<string, SectionTitleLocale>;
  }>;
};

type SectionTitleLocaleManifest = {
  schema: "section-title-locale-pack-v1";
  generated_at: string;
  counts: {
    collection_count: number;
    pair_count: number;
    title_count: number;
  };
  bundles: Array<{
    collection: string;
    path: string;
    sha256: string;
    bytes: number;
    entry_count: number;
    title_count: number;
  }>;
  entries: SectionTitleLocaleManifestEntry[];
};

type LoadSectionTitleLocalesOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  manifestUrl?: string;
  expectedSourceSha256?: string;
  expectedChaptersSha256?: string;
};

const HASH = /^[a-f0-9]{64}$/u;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._@+()/-]*\.json$/u;
const EAST_ASIAN = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\u3100-\u312f\uac00-\ud7af]/u;
const STRUCTURAL_ZH = /^(?:\d{3}(?:A|B)?-Q\d{3}|CH\.?\s*\d+|SE\d+(?:-\d+)?)$/iu;
const bundleRequests = new Map<string, Promise<SectionTitleLocaleBundle>>();
let defaultManifestRequest: Promise<SectionTitleLocaleManifest> | null = null;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    throw new Error(`${label} contains unexpected fields.`);
  }
}

function integer(value: unknown, label: string, allowZero = false) {
  if (!Number.isInteger(value) || Number(value) < (allowZero ? 0 : 1)) throw new Error(`${label} is invalid.`);
  return Number(value);
}

function hash(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function canonicalJson(value: unknown, text: string, label: string) {
  if (`${JSON.stringify(value, null, 2)}\n` !== text) throw new Error(`${label} is not canonical JSON.`);
}

async function sha256Hex(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable.");
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copied);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function responseText(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  return { bytes, text };
}

function validateManifest(value: unknown): SectionTitleLocaleManifest {
  const root = record(value, "Section title locale manifest");
  exactKeys(root, ["schema", "generated_at", "counts", "bundles", "entries"], "Section title locale manifest");
  if (root.schema !== "section-title-locale-pack-v1" || typeof root.generated_at !== "string") {
    throw new Error("Section title locale manifest identity is invalid.");
  }
  const counts = record(root.counts, "Section title locale counts");
  exactKeys(counts, ["collection_count", "pair_count", "title_count"], "Section title locale counts");
  if (!Array.isArray(root.bundles) || !Array.isArray(root.entries)) throw new Error("Section title locale manifest arrays are invalid.");
  const bundles = root.bundles.map((value, index) => {
    const item = record(value, `Section title locale bundle ${index + 1}`);
    exactKeys(item, ["collection", "path", "sha256", "bytes", "entry_count", "title_count"], `Section title locale bundle ${index + 1}`);
    if (typeof item.collection !== "string" || !item.collection || typeof item.path !== "string" || !SAFE_PATH.test(item.path)) {
      throw new Error(`Section title locale bundle ${index + 1} identity is invalid.`);
    }
    return {
      collection: item.collection,
      path: item.path,
      sha256: hash(item.sha256, `Section title locale bundle ${index + 1} hash`),
      bytes: integer(item.bytes, `Section title locale bundle ${index + 1} bytes`),
      entry_count: integer(item.entry_count, `Section title locale bundle ${index + 1} entries`),
      title_count: integer(item.title_count, `Section title locale bundle ${index + 1} titles`),
    };
  });
  const entries = root.entries.map((value, index) => {
    const item = record(value, `Section title locale entry ${index + 1}`);
    exactKeys(item, ["source", "source_sha256", "chapters_sha256", "bundle", "title_count"], `Section title locale entry ${index + 1}`);
    if (typeof item.source !== "string" || !item.source.endsWith(".src") || typeof item.bundle !== "string") {
      throw new Error(`Section title locale entry ${index + 1} identity is invalid.`);
    }
    return {
      source: item.source,
      source_sha256: hash(item.source_sha256, `Section title locale entry ${index + 1} source hash`),
      chapters_sha256: hash(item.chapters_sha256, `Section title locale entry ${index + 1} chapters hash`),
      bundle: item.bundle,
      title_count: integer(item.title_count, `Section title locale entry ${index + 1} titles`),
    };
  });
  if (
    integer(counts.collection_count, "Section title locale collection count") !== bundles.length
    || integer(counts.pair_count, "Section title locale pair count") !== entries.length
    || integer(counts.title_count, "Section title locale title count") !== entries.reduce((sum, item) => sum + item.title_count, 0)
    || new Set(entries.map((item) => item.source)).size !== entries.length
    || new Set(bundles.map((item) => item.path)).size !== bundles.length
    || bundles.some((bundle) => entries.filter((entry) => entry.bundle === bundle.path).length !== bundle.entry_count)
  ) throw new Error("Section title locale manifest counts are inconsistent.");
  return {
    schema: "section-title-locale-pack-v1",
    generated_at: root.generated_at,
    counts: {
      collection_count: bundles.length,
      pair_count: entries.length,
      title_count: entries.reduce((sum, item) => sum + item.title_count, 0),
    },
    bundles,
    entries,
  };
}

function validateTitles(value: unknown, titleCount: number) {
  const root = record(value, "Section title locale titles");
  if (Object.keys(root).length !== titleCount) throw new Error("Section title locale title count is inconsistent.");
  return Object.fromEntries(Object.entries(root).map(([id, value]) => {
    if (!/^l1-\d{2}(?:-l2-\d{2})?$/u.test(id)) throw new Error("Section title locale id is invalid.");
    const title = record(value, `Section title locale ${id}`);
    exactKeys(title, ["zh-TW", "en"], `Section title locale ${id}`);
    const zh = typeof title["zh-TW"] === "string" ? title["zh-TW"].trim() : "";
    const en = typeof title.en === "string" ? title.en.trim() : "";
    if (!zh || !en || EAST_ASIAN.test(en) || (!EAST_ASIAN.test(zh) && !STRUCTURAL_ZH.test(zh))) {
      throw new Error(`Section title locale ${id} language is invalid.`);
    }
    return [id, { "zh-TW": zh, en } satisfies SectionTitleLocale];
  }));
}

function validateBundle(value: unknown, collection: string): SectionTitleLocaleBundle {
  const root = record(value, "Section title locale bundle");
  exactKeys(root, ["schema", "collection", "entries"], "Section title locale bundle");
  if (root.schema !== "section-title-locale-bundle-v1" || root.collection !== collection) {
    throw new Error("Section title locale bundle identity is invalid.");
  }
  const entries = record(root.entries, "Section title locale bundle entries");
  return { schema: "section-title-locale-bundle-v1", collection, entries: entries as SectionTitleLocaleBundle["entries"] };
}

async function requestManifest(options: LoadSectionTitleLocalesOptions) {
  const url = options.manifestUrl ?? "/subtitles-title-locales/manifest.json";
  const response = options.fetch
    ? await options.fetch(url, { cache: "no-cache", signal: options.signal })
    : await fetchCompressedStatic(url, { cache: "no-cache", signal: options.signal });
  const { text } = await responseText(response, "Section title locale manifest");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Section title locale manifest is not valid JSON."); }
  canonicalJson(value, text, "Section title locale manifest");
  return validateManifest(value);
}

export function loadSectionTitleLocaleManifest(options: LoadSectionTitleLocalesOptions = {}) {
  if (!options.fetch && !options.signal && !options.manifestUrl) {
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

async function loadBundle(
  bundle: SectionTitleLocaleManifest["bundles"][number],
  options: LoadSectionTitleLocalesOptions,
) {
  const key = `${bundle.path}:${bundle.sha256}`;
  if (!options.fetch && !options.signal && bundleRequests.has(key)) return bundleRequests.get(key)!;
  const request = (async () => {
    const url = `/subtitles-title-locales/${bundle.path}?v=${bundle.sha256}`;
    const response = options.fetch
      ? await options.fetch(url, { cache: "force-cache", signal: options.signal })
      : await fetchCompressedStatic(url, { cache: "force-cache", signal: options.signal });
    const { bytes, text } = await responseText(response, "Section title locale bundle");
    if (bytes.byteLength !== bundle.bytes || await sha256Hex(bytes) !== bundle.sha256) {
      throw new Error("Section title locale bundle hash or size is invalid.");
    }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("Section title locale bundle is not valid JSON."); }
    canonicalJson(value, text, "Section title locale bundle");
    return validateBundle(value, bundle.collection);
  })();
  if (!options.fetch && !options.signal) {
    bundleRequests.set(key, request);
    request.catch(() => {
      if (bundleRequests.get(key) === request) bundleRequests.delete(key);
    });
  }
  return request;
}

export async function loadSectionTitleLocales(
  source: AudioSummarySource,
  options: LoadSectionTitleLocalesOptions = {},
): Promise<LoadedSectionTitleLocales> {
  const manifest = await loadSectionTitleLocaleManifest(options);
  const sourcePath = runtimeSemanticSourceForAudioSource(source);
  const matches = manifest.entries.filter((entry) => entry.source === sourcePath);
  if (matches.length !== 1) throw new Error("Audio source has no unique Section title locale entry.");
  const entry = matches[0];
  if (options.expectedSourceSha256 && entry.source_sha256 !== options.expectedSourceSha256) {
    throw new Error("Section title locale source hash does not match the subtitle source.");
  }
  if (options.expectedChaptersSha256 && entry.chapters_sha256 !== options.expectedChaptersSha256) {
    throw new Error("Section title locale chapters hash does not match Section metadata.");
  }
  const bundleDescriptor = manifest.bundles.find((bundle) => bundle.path === entry.bundle);
  if (!bundleDescriptor) throw new Error("Section title locale bundle is missing from manifest.");
  const bundle = await loadBundle(bundleDescriptor, options);
  const item = bundle.entries[sourcePath];
  if (!item || item.source_sha256 !== entry.source_sha256 || item.chapters_sha256 !== entry.chapters_sha256) {
    throw new Error("Section title locale bundle entry does not match its manifest.");
  }
  const titles = validateTitles(item.titles, entry.title_count);
  return {
    source: sourcePath,
    sourceSha256: entry.source_sha256,
    chaptersSha256: entry.chapters_sha256,
    titles,
  };
}

export function localizedSectionTitle(
  locales: LoadedSectionTitleLocales | null,
  sectionId: string,
  canonicalTitle: string,
  language: SectionTitleLanguage,
) {
  return locales?.titles[sectionId]?.[language] ?? canonicalTitle;
}

function displayCells(value: string) {
  return [...value].reduce((total, character) => {
    const code = character.codePointAt(0) ?? 0;
    const wide = (
      (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe10 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0x1f300 && code <= 0x1faff)
    );
    return total + (wide ? 2 : 1);
  }, 0);
}

export function bindSectionTitleLocales(
  locales: LoadedSectionTitleLocales,
  metadata: AudioChapterMetadata,
) {
  if (locales.sourceSha256 !== metadata.source_sha256) {
    throw new Error("Section title locale source hash does not match loaded Section metadata.");
  }
  const sections = metadata.chapters.flatMap((chapter) => [chapter, ...chapter.children]);
  if (
    Object.keys(locales.titles).length !== sections.length
    || sections.some((section) => !locales.titles[section.id])
  ) throw new Error("Section title locales do not exactly cover loaded Sections.");
  for (const section of sections) {
    const title = locales.titles[section.id];
    if (title["zh-TW"] !== section.title) {
      throw new Error(`Section title locale ${section.id} does not match canonical zh-TW.`);
    }
    const limits = section.level === 1 ? { "zh-TW": 36, en: 56 } : { "zh-TW": 44, en: 64 };
    if (displayCells(title["zh-TW"]) > limits["zh-TW"] || displayCells(title.en) > limits.en) {
      throw new Error(`Section title locale ${section.id} exceeds the display budget.`);
    }
  }
  return locales;
}
