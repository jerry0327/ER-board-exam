import {
  siteSecondsFromSourceSeconds,
  sourceSecondsFromSiteSeconds,
} from "./audio-playback.ts";
import { fetchCompressedStatic } from "./compressed-static.ts";
import { QUESTION_BANK_CONTENT_ID_OVERRIDES } from "./question-bank-content-id-overrides.ts";

export type AudioChapterProfile = "question-bank-five" | "textbook-study";
export type AudioChapterL2Type = "topic_label" | "subsection";

export type SubtitleCue = {
  index: number;
  start: string;
  end: string;
  startSourceSeconds: number;
  endSourceSeconds: number;
  speaker: string;
  text: string;
};

export type SubtitleSource = {
  header: Record<string, unknown> & { schema: "precision-src-v2" };
  cues: SubtitleCue[];
};

export type AudioChapterL2 = {
  id: string;
  level: 2;
  type: AudioChapterL2Type;
  title: string;
  start: string;
  end: string;
  start_cue: number;
  end_cue: number;
};

export type AudioChapterL1 = {
  id: string;
  level: 1;
  title: string;
  start: string;
  end: string;
  start_cue: number;
  end_cue: number;
  children: AudioChapterL2[];
};

export type AudioChapterMetadata = {
  schema: "subtitle-chapters-v1";
  source: string;
  source_sha256: string;
  profile: AudioChapterProfile;
  chapters: AudioChapterL1[];
};

export type LoadedAudioChapters = {
  srcUrl: string;
  chaptersUrl: string;
  subtitle: SubtitleSource;
  metadata: AudioChapterMetadata;
};

export type CurrentAudioChapter = {
  l1: AudioChapterL1;
  l2: AudioChapterL2 | null;
};

/** Progress bars consume this projection; L2 is intentionally unavailable. */
export type AudioChapterMarker = {
  id: string;
  level: 1;
  title: string;
  sourceStartSeconds: number;
  playerStartSeconds: number;
};

export type LoadAudioChaptersOptions = {
  fetch?: typeof globalThis.fetch;
  chaptersUrl?: string;
  expectedChaptersSha256?: string;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  chaptersSha256?: (bytes: Uint8Array) => Promise<string>;
  signal?: AbortSignal;
};

const TOP_KEYS = ["schema", "source", "source_sha256", "profile", "chapters"] as const;
const L1_KEYS = ["id", "level", "title", "start", "end", "start_cue", "end_cue", "children"] as const;
const L2_KEYS = ["id", "level", "type", "title", "start", "end", "start_cue", "end_cue"] as const;
const TIMESTAMP_PATTERN = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/u;
const QB_SOURCE_PATTERN = /^(\d{3}(?:A|B)?)-Q(\d{3})-Q(\d{3})\.src$/u;
const QB_TITLE_PATTERN = /^\d{3}(?:A|B)?-Q\d{3}$/u;

export class AudioChapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioChapterError";
  }
}

export function chapterMetadataUrlFor(srcUrl: string) {
  const match = /^([^?#]*)([?#].*)?$/u.exec(srcUrl);
  const path = match?.[1] ?? srcUrl;
  const suffix = match?.[2] ?? "";
  if (!/\.src$/iu.test(path)) throw new AudioChapterError("Subtitle URL must end in .src.");
  return `${path.slice(0, -4)}.chapters.json${suffix}`;
}

export function parseSubtitleSource(text: string): SubtitleSource {
  if (text.startsWith("\uFEFF")) throw new AudioChapterError("SRC must not contain a UTF-8 BOM.");
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 2 || lines.some((line) => !line)) {
    throw new AudioChapterError("SRC must contain a header and at least one cue.");
  }
  const header = parseJsonRecord(lines[0], "SRC header");
  if (header.schema !== "precision-src-v2") {
    throw new AudioChapterError("SRC schema must be precision-src-v2.");
  }
  let previousStart = -1;
  const cues = lines.slice(1).map((line, offset): SubtitleCue => {
    const location = `SRC cue ${offset + 1}`;
    const cue = parseJsonRecord(line, location);
    const start = requiredString(cue.start, `${location}.start`);
    const end = requiredString(cue.end, `${location}.end`);
    const startSourceSeconds = timestampSeconds(start, `${location}.start`);
    const endSourceSeconds = timestampSeconds(end, `${location}.end`);
    if (startSourceSeconds >= endSourceSeconds || startSourceSeconds < previousStart) {
      throw new AudioChapterError(`${location} has an invalid timeline.`);
    }
    previousStart = startSourceSeconds;
    return {
      index: offset + 1,
      start,
      end,
      startSourceSeconds,
      endSourceSeconds,
      speaker: requiredString(cue.speaker, `${location}.speaker`),
      text: requiredString(cue.text, `${location}.text`),
    };
  });
  return { header: header as SubtitleSource["header"], cues };
}

export function validateAudioChapterMetadata(
  value: unknown,
  subtitle: SubtitleSource,
  expectedSource: string,
): AudioChapterMetadata {
  const root = requiredRecord(value, "chapter metadata");
  exactFields(root, TOP_KEYS, "chapter metadata");
  if (root.schema !== "subtitle-chapters-v1") {
    throw new AudioChapterError("Chapter schema must be subtitle-chapters-v1.");
  }
  const source = requiredString(root.source, "chapter metadata.source");
  if (source !== expectedSource) {
    throw new AudioChapterError(`Chapter source must equal ${expectedSource}.`);
  }
  const sourceSha256 = requiredString(root.source_sha256, "chapter metadata.source_sha256");
  if (!/^[a-f0-9]{64}$/u.test(sourceSha256)) {
    throw new AudioChapterError("Chapter source_sha256 is invalid.");
  }
  if (root.profile !== "question-bank-five" && root.profile !== "textbook-study") {
    throw new AudioChapterError("Chapter profile is invalid.");
  }
  if (!Array.isArray(root.chapters)) throw new AudioChapterError("chapters must be an array.");
  const chapters = root.chapters.map(parseL1);
  const metadata: AudioChapterMetadata = {
    schema: "subtitle-chapters-v1",
    source,
    source_sha256: sourceSha256,
    profile: root.profile,
    chapters,
  };
  validateL1Partition(chapters, subtitle.cues);
  if (metadata.profile === "question-bank-five") validateQuestionBank(metadata);
  else validateStudy(metadata);
  validateL2Partitions(metadata, subtitle.cues);
  return metadata;
}

export async function loadAudioChapters(
  srcUrl: string,
  options: LoadAudioChaptersOptions = {},
): Promise<LoadedAudioChapters> {
  const fetcher = options.fetch ?? ((input, init) => fetchCompressedStatic(String(input), init));
  if (!fetcher) throw new AudioChapterError("Fetch is unavailable.");
  const inferredChaptersUrl = chapterMetadataUrlFor(srcUrl);
  const chaptersUrl = options.chaptersUrl ?? inferredChaptersUrl;
  if (urlPathname(chaptersUrl) !== urlPathname(inferredChaptersUrl)) {
    throw new AudioChapterError("Chapter URL must be the same-stem companion of the SRC URL.");
  }
  const [srcResponse, chaptersResponse] = await Promise.all([
    fetcher(srcUrl, { signal: options.signal }),
    fetcher(chaptersUrl, { signal: options.signal }),
  ]);
  if (!srcResponse.ok) throw new AudioChapterError(`SRC request failed (${srcResponse.status}).`);
  if (!chaptersResponse.ok) {
    throw new AudioChapterError(`Chapter request failed (${chaptersResponse.status}).`);
  }
  const srcBytes = new Uint8Array(await srcResponse.arrayBuffer());
  let srcText: string;
  try {
    srcText = new TextDecoder("utf-8", { fatal: true }).decode(srcBytes);
  } catch {
    throw new AudioChapterError("SRC is not valid UTF-8.");
  }
  const subtitle = parseSubtitleSource(srcText);
  const chapterBytes = new Uint8Array(await chaptersResponse.arrayBuffer());
  let chapterText: string;
  try {
    chapterText = new TextDecoder("utf-8", { fatal: true }).decode(chapterBytes);
  } catch {
    throw new AudioChapterError("Chapter metadata is not valid UTF-8.");
  }
  let chapterValue: unknown;
  try {
    chapterValue = JSON.parse(chapterText);
  } catch {
    throw new AudioChapterError("Chapter metadata is not valid JSON.");
  }
  const metadata = validateAudioChapterMetadata(chapterValue, subtitle, sourceBasename(srcUrl));
  const digest = await (options.sha256 ?? sha256Hex)(srcBytes);
  if (digest !== metadata.source_sha256) {
    throw new AudioChapterError("Chapter metadata does not match the loaded SRC.");
  }
  if (options.expectedChaptersSha256) {
    const chapterDigest = await (options.chaptersSha256 ?? options.sha256 ?? sha256Hex)(chapterBytes);
    if (chapterDigest !== options.expectedChaptersSha256) {
      throw new AudioChapterError("Loaded chapters do not match the package manifest.");
    }
  }
  return { srcUrl, chaptersUrl, subtitle, metadata };
}

function urlPathname(value: string) {
  return value.split(/[?#]/u, 1)[0];
}

/** Resolve canonical source-time chapters from the player's site-time position. */
export function currentAudioChapterAt(
  metadata: AudioChapterMetadata,
  playerSeconds: number,
): CurrentAudioChapter | null {
  if (!Number.isFinite(playerSeconds) || playerSeconds < 0) return null;
  // Canonical metadata has millisecond precision. Rounding after the 1.2x
  // conversion prevents floating-point drift from skipping an exact boundary.
  const sourceSeconds = Math.round(sourceSecondsFromSiteSeconds(playerSeconds) * 1000) / 1000;
  const l1 = findSection(metadata.chapters, sourceSeconds);
  if (!l1) return null;
  return { l1, l2: findSection(l1.children, sourceSeconds) };
}

/** Resolve the visible subtitle cue from the player's site-time position. */
export function currentSubtitleCueAt(
  subtitle: SubtitleSource,
  playerSeconds: number,
): SubtitleCue | null {
  if (!Number.isFinite(playerSeconds) || playerSeconds < 0 || subtitle.cues.length === 0) return null;
  const sourceSeconds = Math.round(sourceSecondsFromSiteSeconds(playerSeconds) * 1000) / 1000;
  let low = 0;
  let high = subtitle.cues.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = subtitle.cues[middle];
    if (sourceSeconds < cue.startSourceSeconds) high = middle - 1;
    else if (sourceSeconds >= cue.endSourceSeconds) low = middle + 1;
    else return cue;
  }
  return null;
}

/** Project only L1 starts, already converted to the player's site-time seek basis. */
export function level1AudioChapterMarkers(metadata: AudioChapterMetadata): AudioChapterMarker[] {
  return metadata.chapters.map((chapter) => {
    const sourceStartSeconds = timestampSeconds(chapter.start, `${chapter.id}.start`);
    return {
      id: chapter.id,
      level: 1,
      title: chapter.title,
      sourceStartSeconds,
      playerStartSeconds: siteSecondsFromSourceSeconds(sourceStartSeconds),
    };
  });
}

export function playerSecondsForChapter(section: AudioChapterL1 | AudioChapterL2) {
  return siteSecondsFromSourceSeconds(timestampSeconds(section.start, `${section.id}.start`));
}

function parseL1(value: unknown, index: number): AudioChapterL1 {
  const location = `chapters[${index}]`;
  const item = requiredRecord(value, location);
  exactFields(item, L1_KEYS, location);
  const id = `l1-${String(index + 1).padStart(2, "0")}`;
  if (item.id !== id || item.level !== 1) throw new AudioChapterError(`${location} identity is invalid.`);
  if (!Array.isArray(item.children)) throw new AudioChapterError(`${location}.children must be an array.`);
  return {
    id,
    level: 1,
    title: requiredTitle(item.title, `${location}.title`),
    start: requiredTimestamp(item.start, `${location}.start`),
    end: requiredTimestamp(item.end, `${location}.end`),
    start_cue: positiveInteger(item.start_cue, `${location}.start_cue`),
    end_cue: positiveInteger(item.end_cue, `${location}.end_cue`),
    children: item.children.map((child, childIndex) => parseL2(child, index, childIndex)),
  };
}

function parseL2(value: unknown, l1Index: number, l2Index: number): AudioChapterL2 {
  const location = `chapters[${l1Index}].children[${l2Index}]`;
  const item = requiredRecord(value, location);
  exactFields(item, L2_KEYS, location);
  const id = `l1-${String(l1Index + 1).padStart(2, "0")}-l2-${String(l2Index + 1).padStart(2, "0")}`;
  if (item.id !== id || item.level !== 2) throw new AudioChapterError(`${location} identity is invalid.`);
  if (item.type !== "topic_label" && item.type !== "subsection") {
    throw new AudioChapterError(`${location}.type is invalid.`);
  }
  return {
    id,
    level: 2,
    type: item.type,
    title: requiredTitle(item.title, `${location}.title`),
    start: requiredTimestamp(item.start, `${location}.start`),
    end: requiredTimestamp(item.end, `${location}.end`),
    start_cue: positiveInteger(item.start_cue, `${location}.start_cue`),
    end_cue: positiveInteger(item.end_cue, `${location}.end_cue`),
  };
}

function validateL1Partition(chapters: AudioChapterL1[], cues: SubtitleCue[]) {
  if (!chapters.length || chapters[0].start_cue !== 1 || chapters[0].start !== cues[0].start) {
    throw new AudioChapterError("L1 chapters must begin at SRC cue 1.");
  }
  chapters.forEach((chapter, index) => {
    validateCueStart(chapter, cues);
    const next = chapters[index + 1];
    const expectedEnd = next?.start ?? cues.at(-1)?.end;
    const expectedEndCue = next ? next.start_cue - 1 : cues.length;
    if (chapter.end !== expectedEnd || chapter.end_cue !== expectedEndCue) {
      throw new AudioChapterError(`${chapter.id} leaves an L1 gap or overlap.`);
    }
  });
}

function validateQuestionBank(metadata: AudioChapterMetadata) {
  if (metadata.chapters.length !== 7) throw new AudioChapterError("Question Bank requires 7 L1 chapters.");
  const questions = metadata.chapters.slice(1, 6);
  if (
    metadata.chapters[0].title !== "導論"
    || metadata.chapters[0].children.length
    || metadata.chapters[6].title !== "總結"
    || metadata.chapters[6].children.length
  ) throw new AudioChapterError("Question Bank 導論 or 總結 is invalid.");
  const source = QB_SOURCE_PATTERN.exec(metadata.source);
  if (!source) {
    throw new AudioChapterError("Question Bank source range is invalid.");
  }
  const override = QUESTION_BANK_CONTENT_ID_OVERRIDES[metadata.source];
  const expected = override
    ? expectedQuestionBankOverrideSet(metadata, override)
    : expectedQuestionBankFilenameSet(source);
  const titles = questions.map((chapter) => chapter.title);
  if (
    new Set(titles).size !== 5
    || titles.some((title) => !QB_TITLE_PATTERN.test(title) || !expected.has(title))
  ) throw new AudioChapterError("Question Bank IDs do not match the source set.");
  if (questions.some((chapter) => chapter.children.length !== 1 || chapter.children[0].type !== "topic_label")) {
    throw new AudioChapterError("Every Question Bank item requires one topic_label.");
  }
}

function expectedQuestionBankFilenameSet(source: RegExpExecArray) {
  if (Number(source[3]) - Number(source[2]) !== 4) {
    throw new AudioChapterError("Question Bank source range is invalid.");
  }
  return new Set(Array.from(
    { length: 5 },
    (_, index) => `${source[1]}-Q${String(Number(source[2]) + index).padStart(3, "0")}`,
  ));
}

function expectedQuestionBankOverrideSet(
  metadata: AudioChapterMetadata,
  override: { sourceSha256: string; questionIds: readonly string[] },
) {
  if (metadata.source_sha256 !== override.sourceSha256) {
    throw new AudioChapterError("Question Bank content-ID override source hash is invalid.");
  }
  if (
    override.questionIds.length !== 5
    || new Set(override.questionIds).size !== 5
    || override.questionIds.some((title) => !QB_TITLE_PATTERN.test(title))
  ) throw new AudioChapterError("Question Bank content-ID override is invalid.");
  return new Set(override.questionIds);
}

function validateStudy(metadata: AudioChapterMetadata) {
  if (metadata.chapters.length < 2 || metadata.chapters.length > 8) {
    throw new AudioChapterError("Study metadata requires 2 to 8 L1 chapters.");
  }
  const first = metadata.chapters[0];
  const last = metadata.chapters.at(-1)!;
  if (first.title !== "導論" || first.children.length || last.title !== "總結" || last.children.length) {
    throw new AudioChapterError("Study 導論 or 總結 is invalid.");
  }
  if (metadata.chapters.some((chapter) => (
    chapter.children.length > 3 || chapter.children.some((child) => child.type !== "subsection")
  ))) throw new AudioChapterError("Study L2 structure is invalid.");
}

function validateL2Partitions(metadata: AudioChapterMetadata, cues: SubtitleCue[]) {
  for (const parent of metadata.chapters) {
    if (!parent.children.length) continue;
    if (metadata.profile === "question-bank-five") {
      const child = parent.children[0];
      validateCueStart(child, cues);
      if (["start", "end", "start_cue", "end_cue"].some((key) => (
        child[key as keyof AudioChapterL2] !== parent[key as keyof AudioChapterL1]
      ))) throw new AudioChapterError(`${child.id} must match its parent range.`);
      continue;
    }
    if (parent.children[0].start !== parent.start || parent.children[0].start_cue !== parent.start_cue) {
      throw new AudioChapterError(`${parent.id} L2 partition must begin with its parent.`);
    }
    parent.children.forEach((child, index) => {
      validateCueStart(child, cues);
      const next = parent.children[index + 1];
      if (
        child.end !== (next?.start ?? parent.end)
        || child.end_cue !== (next ? next.start_cue - 1 : parent.end_cue)
      ) throw new AudioChapterError(`${child.id} leaves an L2 gap or overlap.`);
    });
  }
}

function validateCueStart(
  section: Pick<AudioChapterL1, "id" | "start" | "end" | "start_cue" | "end_cue">,
  cues: SubtitleCue[],
) {
  if (
    section.start_cue > section.end_cue
    || section.end_cue > cues.length
    || section.start !== cues[section.start_cue - 1]?.start
    || timestampSeconds(section.start, `${section.id}.start`) >= timestampSeconds(section.end, `${section.id}.end`)
  ) throw new AudioChapterError(`${section.id} does not align to SRC cues.`);
}

function findSection<T extends { start: string; end: string }>(sections: T[], sourceSeconds: number): T | null {
  const last = sections.length - 1;
  return sections.find((section, index) => {
    const start = timestampSeconds(section.start, "section.start");
    const end = timestampSeconds(section.end, "section.end");
    return sourceSeconds >= start && (sourceSeconds < end || (index === last && sourceSeconds === end));
  }) ?? null;
}

function sourceBasename(srcUrl: string) {
  const path = srcUrl.split(/[?#]/u, 1)[0].replaceAll("\\", "/");
  try {
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  } catch {
    throw new AudioChapterError("SRC URL filename is invalid.");
  }
}

async function sha256Hex(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new AudioChapterError("SHA-256 is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timestampSeconds(value: string, location: string) {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) throw new AudioChapterError(`${location} must use HH:MM:SS.mmm.`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function requiredTimestamp(value: unknown, location: string) {
  const result = requiredString(value, location);
  timestampSeconds(result, location);
  return result;
}

function requiredTitle(value: unknown, location: string) {
  const result = requiredString(value, location);
  if (result !== result.trim() || result.length > 120) throw new AudioChapterError(`${location} is invalid.`);
  if (!/[\u3400-\u9fff]/u.test(result) && !QB_TITLE_PATTERN.test(result)) {
    throw new AudioChapterError(`${location} must use a Traditional-Chinese main label.`);
  }
  return result;
}

function requiredString(value: unknown, location: string) {
  if (typeof value !== "string" || !value) throw new AudioChapterError(`${location} must be a string.`);
  return value;
}

function positiveInteger(value: unknown, location: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw new AudioChapterError(`${location} must be positive.`);
  return Number(value);
}

function requiredRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AudioChapterError(`${location} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], location: string) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AudioChapterError(`${location} contains non-player fields.`);
  }
}

function parseJsonRecord(text: string, location: string) {
  try {
    return requiredRecord(JSON.parse(text), location);
  } catch (error) {
    if (error instanceof AudioChapterError) throw error;
    throw new AudioChapterError(`${location} is not valid JSON.`);
  }
}
