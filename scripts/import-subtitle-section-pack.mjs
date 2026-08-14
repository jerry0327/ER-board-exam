import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  parseSubtitleSource,
  validateAudioChapterMetadata,
} from "../app/lib/audio-chapters.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_TARGET = path.join(PROJECT_ROOT, "public", "subtitles");
const MANIFEST_SCHEMA = "subtitle-player-section-manifest-v1";
const TOP_KEYS = ["schema", "generated_at", "counts", "pairs"];
const COUNT_KEYS = ["collection_count", "pair_count", "cue_count", "chapter_count", "by_collection"];
const PAIR_KEYS = [
  "collection", "source", "chapters", "source_sha256", "chapters_sha256",
  "profile", "cue_count", "chapter_count", "duration",
];
const CHAPTER_KEYS = ["schema", "source", "source_sha256", "profile", "chapters"];
const L1_KEYS = ["id", "level", "title", "start", "end", "start_cue", "end_cue", "children"];
const L2_KEYS = ["id", "level", "type", "title", "start", "end", "start_cue", "end_cue"];
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+()-]*$/u;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    throw new Error(`${label} contains non-runtime fields`);
  }
  return value;
}

function positive(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function safeRelative(value, suffix, label) {
  if (typeof value !== "string" || !value.endsWith(suffix)) throw new Error(`${label} has an invalid suffix`);
  const parts = value.split("/");
  if (parts.length < 2 || parts.some((part) => !SAFE_SEGMENT_PATTERN.test(part) || part === "." || part === "..")) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

function stableRead(file) {
  const before = fs.statSync(file, { bigint: true });
  if (!before.isFile()) throw new Error(`Not a regular file: ${file}`);
  const bytes = fs.readFileSync(file);
  const after = fs.statSync(file, { bigint: true });
  if (
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs || BigInt(bytes.length) !== after.size
  ) throw new Error(`File changed while being read: ${file}`);
  return bytes;
}

function strictUtf8(bytes, label) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`${label} has a UTF-8 BOM`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not strict UTF-8`);
  }
}

function inside(root, relative) {
  const resolved = path.resolve(root, ...relative.split("/"));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes package root: ${relative}`);
  return resolved;
}

function validateSource(bytes, pair) {
  const text = strictUtf8(bytes, pair.source);
  const subtitle = parseSubtitleSource(text);
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 2 || lines.some((line) => !line)) throw new Error(`${pair.source} is not canonical SRC NDJSON`);
  const header = JSON.parse(lines[0]);
  if (
    !header || header.schema !== "precision-src-v2" || header.collection !== pair.collection
    || header.chapter !== path.posix.basename(pair.source, ".src")
  ) throw new Error(`${pair.source} header identity is invalid`);
  let finalEnd = null;
  for (const line of lines.slice(1)) {
    const cue = JSON.parse(line);
    if (!cue || typeof cue.start !== "string" || typeof cue.end !== "string") {
      throw new Error(`${pair.source} contains an invalid cue`);
    }
    finalEnd = cue.end;
  }
  if (lines.length - 1 !== pair.cue_count || finalEnd !== pair.duration) {
    throw new Error(`${pair.source} does not match manifest cue count or duration`);
  }
  return subtitle;
}

function validateChapters(bytes, pair, subtitle) {
  const text = strictUtf8(bytes, pair.chapters);
  const document = JSON.parse(text);
  exactKeys(document, CHAPTER_KEYS, pair.chapters);
  if (
    document.schema !== "subtitle-chapters-v1"
    || document.source !== path.posix.basename(pair.source)
    || document.source_sha256 !== pair.source_sha256
    || document.profile !== pair.profile
    || !Array.isArray(document.chapters)
    || document.chapters.length !== pair.chapter_count
  ) throw new Error(`${pair.chapters} identity does not match its manifest pair`);
  document.chapters.forEach((chapter, l1Index) => {
    exactKeys(chapter, L1_KEYS, `${pair.chapters} L1 ${l1Index + 1}`);
    if (chapter.level !== 1 || !Array.isArray(chapter.children)) throw new Error(`${pair.chapters} has invalid L1 data`);
    chapter.children.forEach((child, l2Index) => {
      exactKeys(child, L2_KEYS, `${pair.chapters} L1 ${l1Index + 1} L2 ${l2Index + 1}`);
      if (child.level !== 2 || !["topic_label", "subsection"].includes(child.type)) {
        throw new Error(`${pair.chapters} has invalid L2 data`);
      }
    });
  });
  validateAudioChapterMetadata(document, subtitle, path.posix.basename(pair.source));
  if (text !== `${JSON.stringify(document, null, 2)}\n`) throw new Error(`${pair.chapters} is not canonical player JSON`);
}

function walk(root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export function validateSubtitlePackage(packageRoot, manifestPath = path.join(packageRoot, "manifest.json")) {
  packageRoot = path.resolve(packageRoot);
  manifestPath = path.resolve(manifestPath);
  if (!manifestPath.startsWith(`${packageRoot}${path.sep}`)) throw new Error("Manifest must be inside the package root");
  const manifestBytes = stableRead(manifestPath);
  const manifest = JSON.parse(strictUtf8(manifestBytes, "subtitle manifest"));
  exactKeys(manifest, TOP_KEYS, "subtitle manifest");
  if (manifest.schema !== MANIFEST_SCHEMA || !Array.isArray(manifest.pairs) || !manifest.pairs.length) {
    throw new Error("Subtitle manifest schema or pairs are invalid");
  }
  const counts = exactKeys(manifest.counts, COUNT_KEYS, "subtitle manifest counts");
  const expectedPaths = new Set();
  const byCollection = {};
  let cues = 0;
  let chapters = 0;
  const records = manifest.pairs.map((rawPair, index) => {
    const pair = exactKeys(rawPair, PAIR_KEYS, `subtitle manifest pair ${index + 1}`);
    if (typeof pair.collection !== "string" || !SAFE_SEGMENT_PATTERN.test(pair.collection)) throw new Error("Invalid collection");
    pair.source = safeRelative(pair.source, ".src", `pair ${index + 1} source`);
    pair.chapters = safeRelative(pair.chapters, ".chapters.json", `pair ${index + 1} chapters`);
    if (
      pair.source.split("/")[0] !== pair.collection || pair.chapters.split("/")[0] !== pair.collection
      || path.posix.dirname(pair.source) !== path.posix.dirname(pair.chapters)
      || pair.source.slice(0, -4) !== pair.chapters.slice(0, -".chapters.json".length)
    ) throw new Error(`Manifest pair ${index + 1} is not co-located and same-stem`);
    if (!HASH_PATTERN.test(pair.source_sha256) || !HASH_PATTERN.test(pair.chapters_sha256)) throw new Error("Invalid pair hash");
    if (!["question-bank-five", "textbook-study"].includes(pair.profile)) throw new Error("Invalid pair profile");
    positive(pair.cue_count, "cue_count");
    positive(pair.chapter_count, "chapter_count");
    if (expectedPaths.has(pair.source) || expectedPaths.has(pair.chapters)) throw new Error("Duplicate package path");
    expectedPaths.add(pair.source);
    expectedPaths.add(pair.chapters);
    const sourcePath = inside(packageRoot, pair.source);
    const chaptersPath = inside(packageRoot, pair.chapters);
    const sourceBytes = stableRead(sourcePath);
    const chaptersBytes = stableRead(chaptersPath);
    if (sha256(sourceBytes) !== pair.source_sha256 || sha256(chaptersBytes) !== pair.chapters_sha256) {
      throw new Error(`Hash mismatch in pair ${pair.source}`);
    }
    const subtitle = validateSource(sourceBytes, pair);
    validateChapters(chaptersBytes, pair, subtitle);
    byCollection[pair.collection] = (byCollection[pair.collection] ?? 0) + 1;
    cues += pair.cue_count;
    chapters += pair.chapter_count;
    return { pair, sourceBytes, chaptersBytes };
  });
  const actualPayloads = new Set(walk(packageRoot).map((file) => path.relative(packageRoot, file).split(path.sep).join("/"))
    .filter((relative) => relative.endsWith(".src") || relative.endsWith(".chapters.json")));
  if (actualPayloads.size !== expectedPaths.size || [...actualPayloads].some((item) => !expectedPaths.has(item))) {
    throw new Error("Package contains missing or orphan subtitle payloads");
  }
  if (
    counts.pair_count !== records.length || counts.collection_count !== Object.keys(byCollection).length
    || counts.cue_count !== cues || counts.chapter_count !== chapters
    || JSON.stringify(Object.fromEntries(Object.entries(counts.by_collection).sort()))
      !== JSON.stringify(Object.fromEntries(Object.entries(byCollection).sort()))
  ) throw new Error("Manifest counts do not match payloads");
  return { manifest, manifestBytes, records };
}

export function installSubtitlePackage(validated, targetRoot = DEFAULT_TARGET) {
  targetRoot = path.resolve(targetRoot);
  if (path.basename(targetRoot).toLocaleLowerCase("en") !== "subtitles") {
    throw new Error("Subtitle runtime target must be a directory named subtitles");
  }
  const parent = path.dirname(targetRoot);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(targetRoot)}.import-${process.pid}`);
  const backup = path.join(parent, `.${path.basename(targetRoot)}.backup-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  try {
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "manifest.json"), validated.manifestBytes);
    for (const { pair, sourceBytes, chaptersBytes } of validated.records) {
      for (const [relative, bytes] of [[pair.source, sourceBytes], [pair.chapters, chaptersBytes]]) {
        const destination = inside(staging, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes);
      }
    }
    if (fs.existsSync(targetRoot)) fs.renameSync(targetRoot, backup);
    fs.renameSync(staging, targetRoot);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(targetRoot) && fs.existsSync(backup)) fs.renameSync(backup, targetRoot);
    throw error;
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

async function main() {
  const packageRoot = argumentValue("--package");
  if (!packageRoot) throw new Error("Usage: --package <directory> [--manifest <file>] [--dry-run]");
  const manifestPath = argumentValue("--manifest") ?? path.join(packageRoot, "manifest.json");
  const target = DEFAULT_TARGET;
  const validated = validateSubtitlePackage(packageRoot, manifestPath);
  if (!process.argv.includes("--dry-run")) installSubtitlePackage(validated, target);
  console.log(JSON.stringify({
    mode: process.argv.includes("--dry-run") ? "dry-run" : "installed",
    pairs: validated.records.length,
    target,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
