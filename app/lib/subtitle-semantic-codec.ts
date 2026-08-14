/*
 * Browser-safe decoder for the HXT/HXM v1 reference codec.
 *
 * The canonical SRC stays the editable master and HXT/HXM is an optional
 * immutable runtime representation. The decoder reconstructs the canonical
 * SRC bytes exactly, checks CRC-32 plus both SHA-256 bindings, then delegates
 * ordinary cue validation to audio-chapters.ts. No Node APIs are used here.
 */

import { parseSubtitleSource, type SubtitleSource } from "./audio-chapters.ts";

const HXT_MAGIC = "HXT1";
const HXM_MAGIC = "HXM1";
const HXM_VERSION = 1;
const HXM_FLAGS = 0;
const HEADER_KEYS = [
  "schema", "source", "collection", "chapter", "title", "timebase", "speaker_map",
] as const;
const TIMESTAMP = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class SemanticSubtitleCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticSubtitleCodecError";
  }
}

export type DecodedSemanticSubtitle = {
  sourceBytes: Uint8Array;
  sourceSha256: string;
  hxtSha256: string;
  cueCount: number;
  checkpointStride: number;
  subtitle: SubtitleSource;
};

type HxtDocument = {
  headerText: string;
  textLiterals: string[];
};

type Checkpoint = {
  cueIndex: number;
  timeOffset: number;
  previousDuration: number;
  previousEnd: number;
  speakerRunIndex: number;
  speakerRunRemaining: number;
};

type HxmDocument = {
  sourceHash: Uint8Array;
  hxtHash: Uint8Array;
  cueCount: number;
  checkpointStride: number;
  timeStream: Uint8Array;
  gaps: Map<number, number>;
  initialSpeaker: "A" | "B";
  speakerRuns: number[];
  checkpoints: Checkpoint[];
};

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new SemanticSubtitleCodecError(`${label} is not canonical.`);
  }
}

function jsonRecord(value: string, label: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SemanticSubtitleCodecError(`${label} must be an object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SemanticSubtitleCodecError) throw error;
    throw new SemanticSubtitleCodecError(`${label} is invalid JSON.`);
  }
}

function strictText(bytes: Uint8Array, label: string) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new SemanticSubtitleCodecError(`${label} is not valid UTF-8.`);
  }
}

function parseHxt(bytes: Uint8Array): HxtDocument {
  const text = strictText(bytes, "HXT");
  if (text.startsWith("\uFEFF") || text.includes("\r") || !text.endsWith("\n")) {
    throw new SemanticSubtitleCodecError("HXT must be BOM-free UTF-8 with LF and a final LF.");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length < 3 || lines[0] !== HXT_MAGIC || !lines[1].startsWith("H\t")) {
    throw new SemanticSubtitleCodecError("HXT header is invalid.");
  }
  const headerText = lines[1].slice(2);
  const header = jsonRecord(headerText, "HXT header");
  exactKeys(header, HEADER_KEYS, "HXT header");
  if (header.schema !== "precision-src-v2" || header.timebase !== "source-content-1.0x") {
    throw new SemanticSubtitleCodecError("HXT source header is invalid.");
  }
  const speakerMap = header.speaker_map;
  if (
    !speakerMap || typeof speakerMap !== "object" || Array.isArray(speakerMap)
    || JSON.stringify(speakerMap) !== JSON.stringify({
      A: "lower-pitched canonical voice",
      B: "higher-pitched canonical voice",
    })
  ) throw new SemanticSubtitleCodecError("HXT speaker map is invalid.");

  const textLiterals = lines.slice(2).map((line, index) => {
    if (!line.startsWith("T\t")) throw new SemanticSubtitleCodecError(`HXT text ${index + 1} is invalid.`);
    const literal = line.slice(2);
    try {
      const value: unknown = JSON.parse(literal);
      if (typeof value !== "string") throw new Error("not a string");
    } catch {
      throw new SemanticSubtitleCodecError(`HXT text ${index + 1} is invalid.`);
    }
    return literal;
  });
  if (!textLiterals.length) throw new SemanticSubtitleCodecError("HXT contains no cue text.");
  return { headerText, textLiterals };
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
  if (offset + 4 > bytes.length) throw new SemanticSubtitleCodecError("HXM is truncated.");
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function decodeVarint(bytes: Uint8Array, initialOffset: number, label: string): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = initialOffset;
  for (let count = 0; count < 10; count += 1) {
    if (offset >= bytes.length) throw new SemanticSubtitleCodecError(`HXM ${label} is truncated.`);
    const byte = bytes[offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if (!Number.isSafeInteger(value)) throw new SemanticSubtitleCodecError(`HXM ${label} exceeds safe integer range.`);
    if ((byte & 0x80) === 0) {
      if (count > 0 && byte === 0) throw new SemanticSubtitleCodecError(`HXM ${label} is non-canonical.`);
      return [value, offset];
    }
    shift += 7;
  }
  throw new SemanticSubtitleCodecError(`HXM ${label} is too long.`);
}

function zigzagDecode(value: number) {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function parseGapStream(bytes: Uint8Array, cueCount: number) {
  const [count, initialOffset] = decodeVarint(bytes, 0, "gap count");
  let offset = initialOffset;
  const gaps = new Map<number, number>();
  let previousIndex = 0;
  for (let position = 0; position < count; position += 1) {
    let delta: number;
    let encodedGap: number;
    [delta, offset] = decodeVarint(bytes, offset, `gap index ${position}`);
    [encodedGap, offset] = decodeVarint(bytes, offset, `gap value ${position}`);
    const cueIndex = position === 0 ? delta : previousIndex + delta;
    const gap = zigzagDecode(encodedGap);
    if (
      cueIndex < 0 || cueIndex >= cueCount || gap === 0 || gaps.has(cueIndex)
      || (position > 0 && cueIndex <= previousIndex)
    ) throw new SemanticSubtitleCodecError("HXM gap stream is invalid.");
    gaps.set(cueIndex, gap);
    previousIndex = cueIndex;
  }
  if (offset !== bytes.length) throw new SemanticSubtitleCodecError("HXM gap stream has trailing bytes.");
  return gaps;
}

function parseSpeakerStream(bytes: Uint8Array, cueCount: number): ["A" | "B", number[]] {
  if (!bytes.length || (bytes[0] !== 0 && bytes[0] !== 1)) {
    throw new SemanticSubtitleCodecError("HXM speaker stream is invalid.");
  }
  const [count, initialOffset] = decodeVarint(bytes, 1, "speaker run count");
  let offset = initialOffset;
  if (count < 1 || count > cueCount) throw new SemanticSubtitleCodecError("HXM speaker run count is invalid.");
  const runs: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    let run: number;
    [run, offset] = decodeVarint(bytes, offset, `speaker run ${index}`);
    if (run < 1 || total + run > cueCount) throw new SemanticSubtitleCodecError("HXM speaker run is invalid.");
    total += run;
    runs.push(run);
  }
  if (offset !== bytes.length || total !== cueCount) {
    throw new SemanticSubtitleCodecError("HXM speaker stream does not cover all cues.");
  }
  return [bytes[0] === 0 ? "A" : "B", runs];
}

function parseIndexStream(bytes: Uint8Array, cueCount: number, stride: number, timeLength: number) {
  const [count, initialOffset] = decodeVarint(bytes, 0, "checkpoint count");
  let offset = initialOffset;
  const expectedCount = Math.ceil(cueCount / stride);
  if (count !== expectedCount) throw new SemanticSubtitleCodecError("HXM checkpoint count is invalid.");
  const checkpoints: Checkpoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const values: number[] = [];
    for (const label of ["cue", "time offset", "previous duration", "previous end", "speaker run", "speaker remaining"]) {
      let value: number;
      [value, offset] = decodeVarint(bytes, offset, `checkpoint ${index} ${label}`);
      values.push(value);
    }
    const [cueIndex, timeOffset, previousDuration, previousEnd, speakerRunIndex, speakerRunRemaining] = values;
    if (
      cueIndex !== index * stride || timeOffset >= timeLength || speakerRunRemaining < 1
    ) throw new SemanticSubtitleCodecError("HXM checkpoint is invalid.");
    checkpoints.push({ cueIndex, timeOffset, previousDuration, previousEnd, speakerRunIndex, speakerRunRemaining });
  }
  if (offset !== bytes.length) throw new SemanticSubtitleCodecError("HXM checkpoint stream has trailing bytes.");
  return checkpoints;
}

function parseHxm(bytes: Uint8Array): HxmDocument {
  if (bytes.length < 6 + 64 + 4 || strictText(bytes.subarray(0, 4), "HXM magic") !== HXM_MAGIC) {
    throw new SemanticSubtitleCodecError("HXM magic is invalid.");
  }
  if (bytes[4] !== HXM_VERSION || bytes[5] !== HXM_FLAGS) {
    throw new SemanticSubtitleCodecError("HXM version or flags are unsupported.");
  }
  const declaredCrc = readUint32be(bytes, bytes.length - 4);
  if (crc32(bytes.subarray(0, -4)) !== declaredCrc) throw new SemanticSubtitleCodecError("HXM CRC-32 mismatch.");
  const body = bytes.subarray(0, -4);
  const [cueCount, afterCueCount] = decodeVarint(body, 6, "cue count");
  const [checkpointStride, afterStride] = decodeVarint(body, afterCueCount, "checkpoint stride");
  let offset = afterStride;
  if (cueCount < 1 || checkpointStride < 1 || checkpointStride > 65536) {
    throw new SemanticSubtitleCodecError("HXM cue count or checkpoint stride is invalid.");
  }
  if (offset + 64 > body.length) throw new SemanticSubtitleCodecError("HXM hashes are truncated.");
  const sourceHash = body.slice(offset, offset + 32);
  const hxtHash = body.slice(offset + 32, offset + 64);
  offset += 64;
  const lengths: number[] = [];
  for (const label of ["time", "gap", "speaker", "checkpoint"]) {
    let length: number;
    [length, offset] = decodeVarint(body, offset, `${label} stream length`);
    lengths.push(length);
  }
  if (lengths.reduce((total, length) => total + length, 0) !== body.length - offset) {
    throw new SemanticSubtitleCodecError("HXM stream bounds are invalid.");
  }
  const streams = lengths.map((length) => {
    const result = body.slice(offset, offset + length);
    offset += length;
    return result;
  });
  const [timeStream, gapStream, speakerStream, checkpointStream] = streams;
  if (!timeStream.length) throw new SemanticSubtitleCodecError("HXM time stream is empty.");
  const gaps = parseGapStream(gapStream, cueCount);
  const [initialSpeaker, speakerRuns] = parseSpeakerStream(speakerStream, cueCount);
  const checkpoints = parseIndexStream(checkpointStream, cueCount, checkpointStride, timeStream.length);
  return {
    sourceHash,
    hxtHash,
    cueCount,
    checkpointStride,
    timeStream,
    gaps,
    initialSpeaker,
    speakerRuns,
    checkpoints,
  };
}

function decodeTimeline(document: HxmDocument) {
  const durations: number[] = [];
  const timeOffsets: number[] = [];
  let offset = 0;
  let previousDuration = 0;
  for (let index = 0; index < document.cueCount; index += 1) {
    timeOffsets.push(offset);
    let encoded: number;
    [encoded, offset] = decodeVarint(document.timeStream, offset, `duration ${index}`);
    const duration = index === 0 ? encoded : previousDuration + zigzagDecode(encoded);
    if (duration < 1) throw new SemanticSubtitleCodecError("HXM has a non-positive duration.");
    durations.push(duration);
    previousDuration = duration;
  }
  if (offset !== document.timeStream.length) throw new SemanticSubtitleCodecError("HXM time stream has trailing bytes.");
  const starts: number[] = [];
  const ends: number[] = [];
  let previousEnd = 0;
  for (let index = 0; index < durations.length; index += 1) {
    const start = previousEnd + (document.gaps.get(index) ?? 0);
    const end = start + durations[index];
    if (start < previousEnd || start < 0 || end <= start) throw new SemanticSubtitleCodecError("HXM timeline is invalid.");
    starts.push(start);
    ends.push(end);
    previousEnd = end;
  }
  return { durations, starts, ends, timeOffsets };
}

function speakerStateAt(runs: number[], cueIndex: number) {
  let remaining = cueIndex;
  for (let index = 0; index < runs.length; index += 1) {
    if (remaining < runs[index]) return { runIndex: index, runRemaining: runs[index] - remaining };
    remaining -= runs[index];
  }
  throw new SemanticSubtitleCodecError("HXM speaker runs are invalid.");
}

function verifyCheckpoints(document: HxmDocument, timeline: ReturnType<typeof decodeTimeline>) {
  for (const checkpoint of document.checkpoints) {
    const state = speakerStateAt(document.speakerRuns, checkpoint.cueIndex);
    if (
      checkpoint.timeOffset !== timeline.timeOffsets[checkpoint.cueIndex]
      || checkpoint.previousDuration !== (checkpoint.cueIndex === 0 ? 0 : timeline.durations[checkpoint.cueIndex - 1])
      || checkpoint.previousEnd !== (checkpoint.cueIndex === 0 ? 0 : timeline.ends[checkpoint.cueIndex - 1])
      || checkpoint.speakerRunIndex !== state.runIndex
      || checkpoint.speakerRunRemaining !== state.runRemaining
    ) throw new SemanticSubtitleCodecError("HXM checkpoint integrity check failed.");
  }
}

function decodeSpeakers(document: HxmDocument) {
  const speakers: ("A" | "B")[] = [];
  let speaker: "A" | "B" = document.initialSpeaker;
  for (const run of document.speakerRuns) {
    for (let count = 0; count < run; count += 1) speakers.push(speaker);
    speaker = speaker === "A" ? "B" : "A";
  }
  if (speakers.length !== document.cueCount) throw new SemanticSubtitleCodecError("HXM speakers are invalid.");
  return speakers;
}

function timestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function rawSourceBytes(hxt: HxtDocument, hxm: HxmDocument) {
  if (hxt.textLiterals.length !== hxm.cueCount) {
    throw new SemanticSubtitleCodecError("HXT/HXM cue counts do not match.");
  }
  const timeline = decodeTimeline(hxm);
  verifyCheckpoints(hxm, timeline);
  const speakers = decodeSpeakers(hxm);
  const lines = [hxt.headerText];
  for (let index = 0; index < hxm.cueCount; index += 1) {
    lines.push(`{"start":"${timestamp(timeline.starts[index])}","end":"${timestamp(timeline.ends[index])}","speaker":"${speakers[index]}","text":${hxt.textLiterals[index]}}`);
  }
  return encoder.encode(`${lines.join("\n")}\n`);
}

async function sha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new SemanticSubtitleCodecError("SHA-256 is unavailable.");
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", copied));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function decodeSemanticSubtitle(
  hxtBytes: Uint8Array,
  hxmBytes: Uint8Array,
  expectedSourceSha256?: string,
): Promise<DecodedSemanticSubtitle> {
  const hxt = parseHxt(hxtBytes);
  const hxm = parseHxm(hxmBytes);
  const hxtSha256 = await sha256(hxtBytes);
  if (hxtSha256 !== hex(hxm.hxtHash)) throw new SemanticSubtitleCodecError("HXT SHA-256 does not match HXM.");
  const sourceBytes = rawSourceBytes(hxt, hxm);
  const sourceSha256 = await sha256(sourceBytes);
  if (sourceSha256 !== hex(hxm.sourceHash)) throw new SemanticSubtitleCodecError("Reconstructed SRC SHA-256 does not match HXM.");
  if (expectedSourceSha256 && sourceSha256 !== expectedSourceSha256) {
    throw new SemanticSubtitleCodecError("Reconstructed SRC SHA-256 does not match the package manifest.");
  }
  return {
    sourceBytes,
    sourceSha256,
    hxtSha256,
    cueCount: hxm.cueCount,
    checkpointStride: hxm.checkpointStride,
    subtitle: parseSubtitleSource(strictText(sourceBytes, "reconstructed SRC")),
  };
}

/** Bounded cue seek using the closest checkpoint; no text payload is needed. */
export function semanticCueAt(hxmBytes: Uint8Array, cueIndex: number) {
  const document = parseHxm(hxmBytes);
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= document.cueCount) {
    throw new SemanticSubtitleCodecError("Cue index is outside the HXM range.");
  }
  const checkpoint = document.checkpoints[Math.floor(cueIndex / document.checkpointStride)];
  let offset = checkpoint.timeOffset;
  let previousDuration = checkpoint.previousDuration;
  let previousEnd = checkpoint.previousEnd;
  let start = 0;
  let end = 0;
  for (let index = checkpoint.cueIndex; index <= cueIndex; index += 1) {
    let encoded: number;
    [encoded, offset] = decodeVarint(document.timeStream, offset, `random cue ${index}`);
    const duration = index === 0 ? encoded : previousDuration + zigzagDecode(encoded);
    start = previousEnd + (document.gaps.get(index) ?? 0);
    end = start + duration;
    if (duration < 1 || start < previousEnd) throw new SemanticSubtitleCodecError("HXM random access decode failed.");
    previousDuration = duration;
    previousEnd = end;
  }
  let runIndex = checkpoint.speakerRunIndex;
  let runRemaining = checkpoint.speakerRunRemaining;
  let speaker = runIndex % 2 === 0
    ? document.initialSpeaker
    : document.initialSpeaker === "A" ? "B" : "A";
  for (let index = checkpoint.cueIndex; index < cueIndex; index += 1) {
    runRemaining -= 1;
    if (runRemaining === 0) {
      runIndex += 1;
      if (runIndex >= document.speakerRuns.length) throw new SemanticSubtitleCodecError("HXM random speaker decode failed.");
      runRemaining = document.speakerRuns[runIndex];
      speaker = speaker === "A" ? "B" : "A";
    }
  }
  return { startMilliseconds: start, endMilliseconds: end, speaker };
}

export function sourceMilliseconds(timestampText: string) {
  const match = TIMESTAMP.exec(timestampText);
  if (!match) throw new SemanticSubtitleCodecError("Timestamp is invalid.");
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + Number(match[4]);
}
