/* Browser decoder for the deployable HXT2/HXM2 subtitle pair.
 *
 * HXT2 carries readable text/titles and is Brotli-bundled. HXM2 is an opaque
 * identity sidecar with millisecond timing, sparse gaps, A/B runs, checkpoints
 * and section cue indexes. The decoder reconstructs canonical SRC and compact
 * chapter JSON bytes, validates their SHA-256 bindings, then invokes the
 * standard subtitle/chapter validator. */

import {
  parseSubtitleSource,
  validateAudioChapterMetadata,
  type AudioChapterMetadata,
  type SubtitleSource,
} from "./audio-chapters.ts";

const HXT_MAGIC = "HXT2";
const HXM_MAGIC = "HXM2";
const HXM_VERSION = 1;
const HXM_FLAGS = 0;
const HEADER_KEYS = [
  "schema", "source", "collection", "chapter", "title", "timebase", "speaker_map",
] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class RuntimeSemanticSubtitleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeSemanticSubtitleError";
  }
}

export type DecodedRuntimeSemanticSubtitle = {
  sourceBytes: Uint8Array;
  chaptersBytes: Uint8Array;
  sourceSha256: string;
  chaptersSha256: string;
  hxtSha256: string;
  hxmSha256: string;
  cueCount: number;
  checkpointStride: number;
  subtitle: SubtitleSource;
  metadata: AudioChapterMetadata;
};

type Hxt2 = {
  headerText: string;
  header: Record<string, unknown>;
  profile: "question-bank-five" | "textbook-study";
  textLiterals: string[];
  titles: string[];
};

type Checkpoint = {
  cueIndex: number;
  timeOffset: number;
  previousDuration: number;
  previousEnd: number;
  speakerRunIndex: number;
  speakerRunRemaining: number;
};

type SemanticChild = { type: "topic_label" | "subsection"; startCue: number };
type SemanticSection = { startCue: number; children: SemanticChild[] };

type Hxm2 = {
  sourceHash: Uint8Array;
  hxtHash: Uint8Array;
  chaptersHash: Uint8Array;
  cueCount: number;
  checkpointStride: number;
  timeStream: Uint8Array;
  gaps: Map<number, number>;
  initialSpeaker: "A" | "B";
  speakerRuns: number[];
  profile: "question-bank-five" | "textbook-study";
  sections: SemanticSection[];
  checkpoints: Checkpoint[];
};

function strictText(bytes: Uint8Array, label: string) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new RuntimeSemanticSubtitleError(`${label} is not valid UTF-8.`);
  }
}

function jsonRecord(value: string, label: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not record");
    return parsed as Record<string, unknown>;
  } catch {
    throw new RuntimeSemanticSubtitleError(`${label} is invalid JSON.`);
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new RuntimeSemanticSubtitleError(`${label} is not canonical.`);
  }
}

function requiredTitle(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 120) {
    throw new RuntimeSemanticSubtitleError(`${label} is invalid.`);
  }
  return value;
}

function parseHxt2(bytes: Uint8Array): Hxt2 {
  const text = strictText(bytes, "HXT2");
  if (text.startsWith("\uFEFF") || text.includes("\r") || !text.endsWith("\n")) {
    throw new RuntimeSemanticSubtitleError("HXT2 must be BOM-free UTF-8 LF text with a final LF.");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length < 5 || lines[0] !== HXT_MAGIC || !lines[1].startsWith("H\t") || !lines[2].startsWith("P\t")) {
    throw new RuntimeSemanticSubtitleError("HXT2 prefix is invalid.");
  }
  const headerText = lines[1].slice(2);
  const header = jsonRecord(headerText, "HXT2 header");
  exactKeys(header, HEADER_KEYS, "HXT2 header");
  if (header.schema !== "precision-src-v2" || header.timebase !== "source-content-1.0x" || typeof header.chapter !== "string") {
    throw new RuntimeSemanticSubtitleError("HXT2 source header is invalid.");
  }
  const speakerMap = header.speaker_map;
  if (JSON.stringify(speakerMap) !== JSON.stringify({
    A: "lower-pitched canonical voice", B: "higher-pitched canonical voice",
  })) throw new RuntimeSemanticSubtitleError("HXT2 speaker map is invalid.");
  let profile: unknown;
  try { profile = JSON.parse(lines[2].slice(2)); } catch { throw new RuntimeSemanticSubtitleError("HXT2 profile is invalid."); }
  if (profile !== "question-bank-five" && profile !== "textbook-study") {
    throw new RuntimeSemanticSubtitleError("HXT2 profile is invalid.");
  }
  const textLiterals: string[] = [];
  const titles: string[] = [];
  let titlePhase = false;
  for (const [index, line] of lines.slice(3).entries()) {
    if (line.startsWith("T\t") && !titlePhase) {
      const literal = line.slice(2);
      try { if (typeof JSON.parse(literal) !== "string") throw new Error("not string"); } catch {
        throw new RuntimeSemanticSubtitleError(`HXT2 text ${index + 1} is invalid.`);
      }
      textLiterals.push(literal);
      continue;
    }
    if (line.startsWith("L\t")) {
      titlePhase = true;
      try { titles.push(requiredTitle(JSON.parse(line.slice(2)), `HXT2 title ${index + 1}`)); } catch (error) {
        if (error instanceof RuntimeSemanticSubtitleError) throw error;
        throw new RuntimeSemanticSubtitleError(`HXT2 title ${index + 1} is invalid.`);
      }
      continue;
    }
    throw new RuntimeSemanticSubtitleError("HXT2 record order is invalid.");
  }
  if (!textLiterals.length || !titles.length) throw new RuntimeSemanticSubtitleError("HXT2 has no text or titles.");
  return { headerText, header, profile, textLiterals, titles };
}

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function readUint32be(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) throw new RuntimeSemanticSubtitleError("HXM2 is truncated.");
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function varint(bytes: Uint8Array, initialOffset: number, label: string): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = initialOffset;
  for (let count = 0; count < 10; count += 1) {
    if (offset >= bytes.length) throw new RuntimeSemanticSubtitleError(`HXM2 ${label} is truncated.`);
    const byte = bytes[offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if (!Number.isSafeInteger(value)) throw new RuntimeSemanticSubtitleError(`HXM2 ${label} exceeds safe range.`);
    if ((byte & 0x80) === 0) {
      if (count > 0 && byte === 0) throw new RuntimeSemanticSubtitleError(`HXM2 ${label} is non-canonical.`);
      return [value, offset];
    }
    shift += 7;
  }
  throw new RuntimeSemanticSubtitleError(`HXM2 ${label} is too long.`);
}

function zigzag(value: number) { return value % 2 === 0 ? value / 2 : -(value + 1) / 2; }

function parseGaps(bytes: Uint8Array, cueCount: number) {
  const [count, initialOffset] = varint(bytes, 0, "gap count");
  let offset = initialOffset;
  const gaps = new Map<number, number>();
  let previous = 0;
  for (let index = 0; index < count; index += 1) {
    let delta: number; let encoded: number;
    [delta, offset] = varint(bytes, offset, `gap ${index} index`);
    [encoded, offset] = varint(bytes, offset, `gap ${index} value`);
    const cue = index === 0 ? delta : previous + delta;
    const gap = zigzag(encoded);
    if (cue >= cueCount || gap === 0 || gaps.has(cue) || (index && cue <= previous)) {
      throw new RuntimeSemanticSubtitleError("HXM2 gap stream is invalid.");
    }
    gaps.set(cue, gap);
    previous = cue;
  }
  if (offset !== bytes.length) throw new RuntimeSemanticSubtitleError("HXM2 gap stream has trailing bytes.");
  return gaps;
}

function parseSpeakers(bytes: Uint8Array, cueCount: number): ["A" | "B", number[]] {
  if (!bytes.length || (bytes[0] !== 0 && bytes[0] !== 1)) throw new RuntimeSemanticSubtitleError("HXM2 speaker stream is invalid.");
  const [count, initialOffset] = varint(bytes, 1, "speaker count");
  let offset = initialOffset;
  if (count < 1 || count > cueCount) throw new RuntimeSemanticSubtitleError("HXM2 speaker count is invalid.");
  const runs: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    let run: number;
    [run, offset] = varint(bytes, offset, `speaker run ${index}`);
    if (run < 1 || total + run > cueCount) throw new RuntimeSemanticSubtitleError("HXM2 speaker run is invalid.");
    total += run;
    runs.push(run);
  }
  if (offset !== bytes.length || total !== cueCount) throw new RuntimeSemanticSubtitleError("HXM2 speaker stream is invalid.");
  return [bytes[0] === 0 ? "A" : "B", runs];
}

function parseCheckpoints(bytes: Uint8Array, cueCount: number, stride: number, timeLength: number) {
  const [count, initialOffset] = varint(bytes, 0, "checkpoint count");
  let offset = initialOffset;
  if (count !== Math.ceil(cueCount / stride)) throw new RuntimeSemanticSubtitleError("HXM2 checkpoint count is invalid.");
  const checkpoints: Checkpoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const values: number[] = [];
    for (const label of ["cue", "time", "duration", "end", "speaker run", "speaker remainder"]) {
      let value: number;
      [value, offset] = varint(bytes, offset, `checkpoint ${index} ${label}`);
      values.push(value);
    }
    const [cueIndex, timeOffset, previousDuration, previousEnd, speakerRunIndex, speakerRunRemaining] = values;
    if (cueIndex !== index * stride || timeOffset >= timeLength || speakerRunRemaining < 1) {
      throw new RuntimeSemanticSubtitleError("HXM2 checkpoint is invalid.");
    }
    checkpoints.push({ cueIndex, timeOffset, previousDuration, previousEnd, speakerRunIndex, speakerRunRemaining });
  }
  if (offset !== bytes.length) throw new RuntimeSemanticSubtitleError("HXM2 checkpoint stream has trailing bytes.");
  return checkpoints;
}

function parseSections(bytes: Uint8Array, cueCount: number): ["question-bank-five" | "textbook-study", SemanticSection[]] {
  if (bytes.length < 2 || (bytes[0] !== 0 && bytes[0] !== 1)) throw new RuntimeSemanticSubtitleError("HXM2 section stream is invalid.");
  const profile = bytes[0] === 0 ? "question-bank-five" : "textbook-study";
  const [count, initialOffset] = varint(bytes, 1, "L1 count");
  let offset = initialOffset;
  if (count < 2 || count > 8 || (profile === "question-bank-five" && count !== 7)) {
    throw new RuntimeSemanticSubtitleError("HXM2 section count is invalid.");
  }
  const sections: SemanticSection[] = [];
  let previousStart = 0;
  for (let sectionIndex = 0; sectionIndex < count; sectionIndex += 1) {
    let delta: number; let childCount: number;
    [delta, offset] = varint(bytes, offset, `L1 ${sectionIndex} start`);
    [childCount, offset] = varint(bytes, offset, `L1 ${sectionIndex} child count`);
    const startCue = sectionIndex === 0 ? delta : previousStart + delta;
    if (startCue < 1 || startCue > cueCount || startCue <= previousStart || childCount > 3) {
      throw new RuntimeSemanticSubtitleError("HXM2 section range is invalid.");
    }
    const children: SemanticChild[] = [];
    for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
      if (offset >= bytes.length) throw new RuntimeSemanticSubtitleError("HXM2 section child is truncated.");
      const code = bytes[offset++];
      if (code === 0) children.push({ type: "topic_label", startCue });
      else if (code === 1) {
        let childDelta: number;
        [childDelta, offset] = varint(bytes, offset, `L1 ${sectionIndex} child ${childIndex} start`);
        if (childDelta < 0 || startCue + childDelta > cueCount) throw new RuntimeSemanticSubtitleError("HXM2 subsection start is invalid.");
        children.push({ type: "subsection", startCue: startCue + childDelta });
      } else throw new RuntimeSemanticSubtitleError("HXM2 child type is invalid.");
    }
    sections.push({ startCue, children });
    previousStart = startCue;
  }
  if (offset !== bytes.length) throw new RuntimeSemanticSubtitleError("HXM2 section stream has trailing bytes.");
  return [profile, sections];
}

function parseHxm2(bytes: Uint8Array): Hxm2 {
  if (bytes.length < 6 + 96 + 4 || strictText(bytes.subarray(0, 4), "HXM2 magic") !== HXM_MAGIC || bytes[4] !== HXM_VERSION || bytes[5] !== HXM_FLAGS) {
    throw new RuntimeSemanticSubtitleError("HXM2 magic/version/flags are invalid.");
  }
  if (readUint32be(bytes, bytes.length - 4) !== crc32(bytes.subarray(0, -4))) throw new RuntimeSemanticSubtitleError("HXM2 CRC-32 mismatch.");
  const body = bytes.subarray(0, -4);
  const [cueCount, afterCueCount] = varint(body, 6, "cue count");
  const [checkpointStride, afterStride] = varint(body, afterCueCount, "checkpoint stride");
  let offset = afterStride;
  if (cueCount < 1 || checkpointStride < 1 || checkpointStride > 65536 || offset + 96 > body.length) {
    throw new RuntimeSemanticSubtitleError("HXM2 header is invalid.");
  }
  const sourceHash = body.slice(offset, offset + 32);
  const hxtHash = body.slice(offset + 32, offset + 64);
  const chaptersHash = body.slice(offset + 64, offset + 96);
  offset += 96;
  const lengths: number[] = [];
  for (const label of ["time", "gap", "speaker", "checkpoint", "section"]) {
    let length: number;
    [length, offset] = varint(body, offset, `${label} length`);
    lengths.push(length);
  }
  if (lengths.reduce((total, length) => total + length, 0) !== body.length - offset) {
    throw new RuntimeSemanticSubtitleError("HXM2 stream bounds are invalid.");
  }
  const streams = lengths.map((length) => {
    const stream = body.slice(offset, offset + length);
    offset += length;
    return stream;
  });
  const [timeStream, gapStream, speakerStream, checkpointStream, sectionStream] = streams;
  if (!timeStream.length) throw new RuntimeSemanticSubtitleError("HXM2 time stream is empty.");
  const gaps = parseGaps(gapStream, cueCount);
  const [initialSpeaker, speakerRuns] = parseSpeakers(speakerStream, cueCount);
  const checkpoints = parseCheckpoints(checkpointStream, cueCount, checkpointStride, timeStream.length);
  const [profile, sections] = parseSections(sectionStream, cueCount);
  return { sourceHash, hxtHash, chaptersHash, cueCount, checkpointStride, timeStream, gaps, initialSpeaker, speakerRuns, profile, sections, checkpoints };
}

function timeline(hxm: Hxm2) {
  let offset = 0;
  let previousDuration = 0;
  const durations: number[] = [];
  const timeOffsets: number[] = [];
  for (let index = 0; index < hxm.cueCount; index += 1) {
    timeOffsets.push(offset);
    let encoded: number;
    [encoded, offset] = varint(hxm.timeStream, offset, `duration ${index}`);
    const duration = index === 0 ? encoded : previousDuration + zigzag(encoded);
    if (duration < 1) throw new RuntimeSemanticSubtitleError("HXM2 duration is invalid.");
    durations.push(duration);
    previousDuration = duration;
  }
  if (offset !== hxm.timeStream.length) throw new RuntimeSemanticSubtitleError("HXM2 time stream has trailing bytes.");
  const starts: number[] = [];
  const ends: number[] = [];
  let previousEnd = 0;
  for (let index = 0; index < hxm.cueCount; index += 1) {
    const start = previousEnd + (hxm.gaps.get(index) ?? 0);
    const end = start + durations[index];
    if (start < previousEnd || start < 0 || end <= start) throw new RuntimeSemanticSubtitleError("HXM2 timeline is invalid.");
    starts.push(start); ends.push(end); previousEnd = end;
  }
  return { durations, timeOffsets, starts, ends };
}

function speakerState(runs: number[], cueIndex: number) {
  let remaining = cueIndex;
  for (let index = 0; index < runs.length; index += 1) {
    if (remaining < runs[index]) return { runIndex: index, remaining: runs[index] - remaining };
    remaining -= runs[index];
  }
  throw new RuntimeSemanticSubtitleError("HXM2 speaker state is invalid.");
}

function verifyCheckpoints(hxm: Hxm2, decoded: ReturnType<typeof timeline>) {
  for (const checkpoint of hxm.checkpoints) {
    const speaker = speakerState(hxm.speakerRuns, checkpoint.cueIndex);
    if (
      checkpoint.timeOffset !== decoded.timeOffsets[checkpoint.cueIndex]
      || checkpoint.previousDuration !== (checkpoint.cueIndex ? decoded.durations[checkpoint.cueIndex - 1] : 0)
      || checkpoint.previousEnd !== (checkpoint.cueIndex ? decoded.ends[checkpoint.cueIndex - 1] : 0)
      || checkpoint.speakerRunIndex !== speaker.runIndex
      || checkpoint.speakerRunRemaining !== speaker.remaining
    ) throw new RuntimeSemanticSubtitleError("HXM2 checkpoint integrity check failed.");
  }
}

function speakers(hxm: Hxm2) {
  const result: ("A" | "B")[] = [];
  let speaker = hxm.initialSpeaker;
  for (const run of hxm.speakerRuns) {
    for (let index = 0; index < run; index += 1) result.push(speaker);
    speaker = speaker === "A" ? "B" : "A";
  }
  if (result.length !== hxm.cueCount) throw new RuntimeSemanticSubtitleError("HXM2 speaker coverage is invalid.");
  return result;
}

function timestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function hex(bytes: Uint8Array) { return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }

async function hash(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new RuntimeSemanticSubtitleError("SHA-256 is unavailable.");
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copied);
  return hex(new Uint8Array(digest));
}

function reconstructSource(hxt: Hxt2, hxm: Hxm2) {
  if (hxt.textLiterals.length !== hxm.cueCount) throw new RuntimeSemanticSubtitleError("HXT2/HXM2 cue counts differ.");
  const decoded = timeline(hxm);
  verifyCheckpoints(hxm, decoded);
  const voices = speakers(hxm);
  const lines = [hxt.headerText];
  for (let index = 0; index < hxm.cueCount; index += 1) {
    lines.push(`{"start":"${timestamp(decoded.starts[index])}","end":"${timestamp(decoded.ends[index])}","speaker":"${voices[index]}","text":${hxt.textLiterals[index]}}`);
  }
  return { bytes: encoder.encode(`${lines.join("\n")}\n`), decoded };
}

function reconstructChapters(hxt: Hxt2, hxm: Hxm2, decodedSourceHash: string, decoded: ReturnType<typeof timeline>) {
  if (hxt.profile !== hxm.profile) throw new RuntimeSemanticSubtitleError("HXT2/HXM2 profile differs.");
  let titleOffset = 0;
  const timestampAtCue = (cue: number, end = false) => {
    if (!Number.isInteger(cue) || cue < 1 || cue > hxm.cueCount) throw new RuntimeSemanticSubtitleError("HXM2 section cue is invalid.");
    return timestamp((end ? decoded.ends : decoded.starts)[cue - 1]);
  };
  const partitionEnd = (nextStartCue: number) => (
    nextStartCue <= hxm.cueCount
      ? timestampAtCue(nextStartCue)
      : timestampAtCue(hxm.cueCount, true)
  );
  const chapters = hxm.sections.map((section, l1Index) => {
    const nextStart = hxm.sections[l1Index + 1]?.startCue ?? hxm.cueCount + 1;
    const title = hxt.titles[titleOffset++];
    if (!title) throw new RuntimeSemanticSubtitleError("HXT2 lacks an L1 title.");
    const children = section.children.map((child, childIndex) => {
      const titleChild = hxt.titles[titleOffset++];
      if (!titleChild) throw new RuntimeSemanticSubtitleError("HXT2 lacks an L2 title.");
      const childNext = child.type === "topic_label"
        ? nextStart
        : section.children[childIndex + 1]?.startCue ?? nextStart;
      const startCue = child.type === "topic_label" ? section.startCue : child.startCue;
      return {
        id: `l1-${String(l1Index + 1).padStart(2, "0")}-l2-${String(childIndex + 1).padStart(2, "0")}`,
        level: 2,
        type: child.type,
        title: titleChild,
        start: timestampAtCue(startCue),
        end: partitionEnd(childNext),
        start_cue: startCue,
        end_cue: childNext - 1,
      };
    });
    return {
      id: `l1-${String(l1Index + 1).padStart(2, "0")}`,
      level: 1,
      title,
      start: timestampAtCue(section.startCue),
      end: partitionEnd(nextStart),
      start_cue: section.startCue,
      end_cue: nextStart - 1,
      children,
    };
  });
  if (titleOffset !== hxt.titles.length) throw new RuntimeSemanticSubtitleError("HXT2 has surplus titles.");
  const source = `${hxt.header.chapter}.src`;
  return encoder.encode(`${JSON.stringify({
    schema: "subtitle-chapters-v1",
    source,
    source_sha256: decodedSourceHash,
    profile: hxt.profile,
    chapters,
  }, null, 2)}\n`);
}

export async function decodeRuntimeSemanticSubtitle(
  hxtBytes: Uint8Array,
  hxmBytes: Uint8Array,
  expected: {
    sourceSha256?: string;
    chaptersSha256?: string;
    hxtSha256?: string;
    hxmSha256?: string;
  } = {},
): Promise<DecodedRuntimeSemanticSubtitle> {
  const hxt = parseHxt2(hxtBytes);
  const hxm = parseHxm2(hxmBytes);
  const hxmSha256 = await hash(hxmBytes);
  if (expected.hxmSha256 && hxmSha256 !== expected.hxmSha256) {
    throw new RuntimeSemanticSubtitleError("HXM2 SHA-256 does not match the package manifest.");
  }
  const hxtSha256 = await hash(hxtBytes);
  if (hxtSha256 !== hex(hxm.hxtHash) || (expected.hxtSha256 && hxtSha256 !== expected.hxtSha256)) {
    throw new RuntimeSemanticSubtitleError("HXT2 SHA-256 does not match HXM2 or manifest.");
  }
  const source = reconstructSource(hxt, hxm);
  const sourceSha256 = await hash(source.bytes);
  if (sourceSha256 !== hex(hxm.sourceHash) || (expected.sourceSha256 && sourceSha256 !== expected.sourceSha256)) {
    throw new RuntimeSemanticSubtitleError("Reconstructed SRC SHA-256 does not match HXM2 or manifest.");
  }
  const chaptersBytes = reconstructChapters(hxt, hxm, sourceSha256, source.decoded);
  const chaptersSha256 = await hash(chaptersBytes);
  if (chaptersSha256 !== hex(hxm.chaptersHash) || (expected.chaptersSha256 && chaptersSha256 !== expected.chaptersSha256)) {
    throw new RuntimeSemanticSubtitleError("Reconstructed chapters SHA-256 does not match HXM2 or manifest.");
  }
  const subtitle = parseSubtitleSource(strictText(source.bytes, "reconstructed SRC"));
  let chapterValue: unknown;
  try { chapterValue = JSON.parse(strictText(chaptersBytes, "reconstructed chapters")); } catch {
    throw new RuntimeSemanticSubtitleError("Reconstructed chapters are invalid JSON.");
  }
  const metadata = validateAudioChapterMetadata(chapterValue, subtitle, `${hxt.header.chapter}.src`);
  return {
    sourceBytes: source.bytes,
    chaptersBytes,
    sourceSha256,
    chaptersSha256,
    hxtSha256,
    hxmSha256,
    cueCount: hxm.cueCount,
    checkpointStride: hxm.checkpointStride,
    subtitle,
    metadata,
  };
}

/**
 * Decodes one timeline entry from the closest HXM2 checkpoint.  This is kept
 * independent of HXT2 so a player can seek/tick against the opaque timing
 * sidecar without materializing every cue's text or reconstructed SRC.
 */
export function runtimeSemanticCueAt(hxmBytes: Uint8Array, cueIndex: number) {
  const hxm = parseHxm2(hxmBytes);
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= hxm.cueCount) {
    throw new RuntimeSemanticSubtitleError("Cue index is outside the HXM2 range.");
  }
  const checkpoint = hxm.checkpoints[Math.floor(cueIndex / hxm.checkpointStride)];
  let offset = checkpoint.timeOffset;
  let previousDuration = checkpoint.previousDuration;
  let previousEnd = checkpoint.previousEnd;
  let start = 0;
  let end = 0;
  for (let index = checkpoint.cueIndex; index <= cueIndex; index += 1) {
    let encoded: number;
    [encoded, offset] = varint(hxm.timeStream, offset, `random cue ${index}`);
    const duration = index === 0 ? encoded : previousDuration + zigzag(encoded);
    start = previousEnd + (hxm.gaps.get(index) ?? 0);
    end = start + duration;
    if (duration < 1 || start < previousEnd || end <= start) {
      throw new RuntimeSemanticSubtitleError("HXM2 random access decode failed.");
    }
    previousDuration = duration;
    previousEnd = end;
  }
  let runIndex = checkpoint.speakerRunIndex;
  let runRemaining = checkpoint.speakerRunRemaining;
  let speaker: "A" | "B" = runIndex % 2 === 0
    ? hxm.initialSpeaker
    : hxm.initialSpeaker === "A" ? "B" : "A";
  for (let index = checkpoint.cueIndex; index < cueIndex; index += 1) {
    runRemaining -= 1;
    if (runRemaining === 0) {
      runIndex += 1;
      if (runIndex >= hxm.speakerRuns.length) {
        throw new RuntimeSemanticSubtitleError("HXM2 random speaker decode failed.");
      }
      runRemaining = hxm.speakerRuns[runIndex];
      speaker = speaker === "A" ? "B" : "A";
    }
  }
  return { startMilliseconds: start, endMilliseconds: end, speaker };
}
