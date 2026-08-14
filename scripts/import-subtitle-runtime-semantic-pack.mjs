#!/usr/bin/env node
/* Install a fully verified HXT2/HXM2 subtitle runtime pack atomically.
 *
 * This is intentionally separate from import-subtitle-section-pack.mjs: the
 * legacy SRC + chapters package stays available as a fail-safe until the
 * semantic pack's complete-corpus proof is accepted. Neither importer touches
 * the other namespace.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  decodeRuntimeSemanticSubtitle,
} from "../app/lib/subtitle-runtime-semantic-codec.ts";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultTarget = path.join(projectRoot, "public", "subtitles-runtime");
const schema = "subtitle-runtime-semantic-manifest-v2";
const codec = "subtitle-runtime-semantic-hxt-hxm-v2";
const topKeys = ["schema", "codec", "generated_at", "terminal_unavailable_sha256", "counts", "bundles", "entries"];
const countKeys = ["collection_count", "pair_count", "cue_count", "chapter_count", "by_collection", "hxt_bytes", "hxm_bytes"];
const bundleKeys = ["path", "sha256", "bytes", "member_count"];
const entryKeys = [
  "collection", "source", "source_sha256", "chapters_sha256", "profile", "cue_count", "chapter_count", "duration",
  "hxt_bundle", "hxt_offset", "hxt_bytes", "hxt_sha256", "hxm", "hxm_sha256", "hxm_bytes",
];
const hashPattern = /^[a-f0-9]{64}$/u;
const timestampPattern = /^\d{2,}:[0-5]\d:[0-5]\d\.\d{3}$/u;
const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9._@+()-]*$/u;
const formalCorpusCounts = {
  "board-guides": 39,
  ems: 24,
  goldfrank: 140,
  "question-bank": 664,
  rosens: 236,
  tintinalli: 330,
};
const formalCorpusPairs = 1433;
const terminalRegistryName = "terminal-unavailable.json";
const terminalRegistrySchema = "subtitle-terminal-unavailable-registry-v1";
const terminalTopKeys = ["schema", "generated_at", "expected_audio_count", "counts", "entries"];
const terminalCountKeys = ["unavailable_count", "available_pair_target", "by_collection"];
const terminalEntryKeys = [
  "collection", "source", "chapter_key", "status", "decision_id", "authority", "raw_sha256",
  "evidence_sha256", "evidence_path",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    throw new Error(`${label} is not strict UTF-8`);
  }
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label));
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported or noncanonical fields`);
  }
  return value;
}

function positive(value, label, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} is not a valid integer`);
  return value;
}

function requiredHash(value, label) {
  if (typeof value !== "string" || !hashPattern.test(value)) throw new Error(`${label} is not a valid SHA-256`);
  return value;
}

function safePath(value, suffix, label) {
  if (typeof value !== "string" || !value.endsWith(suffix)) throw new Error(`${label} suffix is invalid`);
  const parts = value.split("/");
  if (parts.length < 2 || parts.some((part) => !segmentPattern.test(part) || part === "." || part === "..")) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

function inside(root, relative) {
  const target = path.resolve(root, ...relative.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes package root: ${relative}`);
  return target;
}

function safeEvidencePath(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const parts = value.split("/");
  if (!parts.length || parts.some((part) => !segmentPattern.test(part) || part === "." || part === "..")) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

function sourceCueEnd(source) {
  return source.cues.at(-1)?.end ?? null;
}

function validateTerminalUnavailableRegistry(packageRoot) {
  const registryPath = path.join(packageRoot, terminalRegistryName);
  if (!fs.existsSync(registryPath)) {
    return { registry: null, bytes: null, sources: new Set(), byCollection: Object.fromEntries(Object.keys(formalCorpusCounts).map((key) => [key, 0])) };
  }
  const bytes = stableRead(registryPath);
  let registry;
  try { registry = JSON.parse(strictUtf8(bytes, "terminal-unavailable registry")); } catch {
    throw new Error("Terminal-unavailable registry is invalid JSON");
  }
  if (!bytes.equals(Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8"))) {
    throw new Error("Terminal-unavailable registry is not canonical JSON");
  }
  exactKeys(registry, terminalTopKeys, "terminal-unavailable registry");
  if (
    registry.schema !== terminalRegistrySchema
    || typeof registry.generated_at !== "string"
    || !Number.isFinite(Date.parse(registry.generated_at))
    || registry.expected_audio_count !== formalCorpusPairs
  ) throw new Error("Terminal-unavailable registry identity is invalid");
  const counts = exactKeys(registry.counts, terminalCountKeys, "terminal-unavailable registry counts");
  if (!Array.isArray(registry.entries)) throw new Error("Terminal-unavailable registry entries are invalid");
  const sources = new Set();
  const byCollection = Object.fromEntries(Object.keys(formalCorpusCounts).map((key) => [key, 0]));
  let previous = "";
  for (const [index, raw] of registry.entries.entries()) {
    const entry = exactKeys(raw, terminalEntryKeys, `terminal-unavailable entry ${index + 1}`);
    const source = safePath(entry.source, ".src", `terminal-unavailable entry ${index + 1} source`);
    if (source <= previous || sources.has(source) || source.split("/")[0] !== entry.collection) {
      throw new Error(`Terminal-unavailable entry ${index + 1} source is unsorted, duplicate, or mismatched`);
    }
    previous = source;
    if (
      entry.chapter_key !== source.slice(0, -4)
      || entry.status !== "terminal-unavailable"
      || typeof entry.decision_id !== "string"
      || !entry.decision_id
      || !["manager-terminal-adjudication", "external-terminal-block-packet"].includes(entry.authority)
    ) throw new Error(`Terminal-unavailable entry ${index + 1} identity is invalid`);
    requiredHash(entry.raw_sha256, `terminal-unavailable entry ${index + 1} RAW hash`);
    requiredHash(entry.evidence_sha256, `terminal-unavailable entry ${index + 1} evidence hash`);
    safeEvidencePath(entry.evidence_path, `terminal-unavailable entry ${index + 1} evidence path`);
    if (!(entry.collection in byCollection)) throw new Error(`Terminal-unavailable entry ${index + 1} collection is invalid`);
    sources.add(source);
    byCollection[entry.collection] += 1;
  }
  const expectedCounts = {
    unavailable_count: registry.entries.length,
    available_pair_target: formalCorpusPairs - registry.entries.length,
    by_collection: byCollection,
  };
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
    throw new Error("Terminal-unavailable registry counts do not match entries");
  }
  return { registry, bytes, sources, byCollection };
}

function formalCorpusReady(counts, terminalUnavailable) {
  return terminalUnavailable.sources.size === 0
    && counts.pair_count === formalCorpusPairs
    && Object.entries(formalCorpusCounts).every(([collection, expected]) => (
      (counts.by_collection[collection] ?? 0) === expected
    ));
}

export async function validateSemanticRuntimePackage(
  packageRoot,
  manifestPath = path.join(packageRoot, "manifest.json"),
  { requireFormalCorpus = false } = {},
) {
  packageRoot = path.resolve(packageRoot);
  manifestPath = path.resolve(manifestPath);
  if (manifestPath !== path.join(packageRoot, "manifest.json")) throw new Error("Semantic runtime manifest must be packageRoot/manifest.json");
  const manifestBytes = stableRead(manifestPath);
  let manifest;
  try { manifest = JSON.parse(strictUtf8(manifestBytes, "semantic runtime manifest")); } catch {
    throw new Error("Semantic runtime manifest is invalid JSON");
  }
  if (!manifestBytes.equals(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"))) {
    throw new Error("Semantic runtime manifest is not canonical player JSON");
  }
  exactKeys(manifest, topKeys, "semantic runtime manifest");
  if (manifest.schema !== schema || manifest.codec !== codec || typeof manifest.generated_at !== "string" || !Number.isFinite(Date.parse(manifest.generated_at))) {
    throw new Error("Semantic runtime manifest identity is invalid");
  }
  if (manifest.terminal_unavailable_sha256 !== null) {
    throw new Error("Semantic runtime may not bind terminal-unavailable placeholders");
  }
  const counts = exactKeys(manifest.counts, countKeys, "semantic runtime manifest counts");
  if (!Array.isArray(manifest.bundles) || !manifest.bundles.length || !Array.isArray(manifest.entries) || !manifest.entries.length) {
    throw new Error("Semantic runtime manifest has no bundles or entries");
  }
  const terminalUnavailable = validateTerminalUnavailableRegistry(packageRoot);
  if (terminalUnavailable.bytes !== null) {
    throw new Error("Semantic runtime package may not contain terminal-unavailable placeholders");
  }
  if (
    (terminalUnavailable.bytes === null) !== (manifest.terminal_unavailable_sha256 === null)
    || (terminalUnavailable.bytes && sha256(terminalUnavailable.bytes) !== manifest.terminal_unavailable_sha256)
  ) throw new Error("Terminal-unavailable registry is not bound by the semantic runtime manifest");
  const bundles = new Map();
  const expectedFiles = new Set(["manifest.json"]);
  if (terminalUnavailable.registry) expectedFiles.add(terminalRegistryName);
  for (const [index, raw] of manifest.bundles.entries()) {
    const bundle = exactKeys(raw, bundleKeys, `semantic bundle ${index + 1}`);
    const hash = requiredHash(bundle.sha256, `semantic bundle ${index + 1} hash`);
    const relative = safePath(bundle.path, ".hxtb", `semantic bundle ${index + 1} path`);
    if (relative !== `bundles/${hash}.hxtb` || bundles.has(relative)) throw new Error(`Semantic bundle ${index + 1} identity is invalid`);
    const bytes = stableRead(inside(packageRoot, relative));
    if (bytes.length !== positive(bundle.bytes, `semantic bundle ${index + 1} bytes`) || sha256(bytes) !== hash) {
      throw new Error(`Semantic bundle ${index + 1} bytes/hash mismatch`);
    }
    bundles.set(relative, { ...bundle, bytes });
    expectedFiles.add(relative);
  }
  const seen = new Set();
  const byCollection = {};
  const bundlePartitions = new Map();
  let cueCount = 0;
  let chapterCount = 0;
  let hxtBytes = 0;
  let hxmBytes = 0;
  let previousSource = "";
  for (const [index, raw] of manifest.entries.entries()) {
    const entry = exactKeys(raw, entryKeys, `semantic entry ${index + 1}`);
    const source = safePath(entry.source, ".src", `semantic entry ${index + 1} source`);
    if (source <= previousSource || seen.has(source) || source.split("/")[0] !== entry.collection) {
      throw new Error(`Semantic entry ${index + 1} source is unsorted, duplicate, or mismatched`);
    }
    previousSource = source;
    seen.add(source);
    if (terminalUnavailable.sources.has(source)) throw new Error(`Semantic entry ${index + 1} is also terminal-unavailable`);
    if (typeof entry.collection !== "string" || !segmentPattern.test(entry.collection) || !["question-bank-five", "textbook-study"].includes(entry.profile)) {
      throw new Error(`Semantic entry ${index + 1} collection/profile is invalid`);
    }
    for (const key of ["source_sha256", "chapters_sha256", "hxt_sha256", "hxm_sha256"]) requiredHash(entry[key], `semantic entry ${index + 1} ${key}`);
    for (const key of ["cue_count", "chapter_count", "hxt_bytes", "hxm_bytes"]) positive(entry[key], `semantic entry ${index + 1} ${key}`);
    const hxtOffset = positive(entry.hxt_offset, `semantic entry ${index + 1} hxt_offset`, true);
    if (typeof entry.duration !== "string" || !timestampPattern.test(entry.duration)) throw new Error(`Semantic entry ${index + 1} duration is invalid`);
    const bundlePath = safePath(entry.hxt_bundle, ".hxtb", `semantic entry ${index + 1} hxt bundle`);
    const bundle = bundles.get(bundlePath);
    if (!bundle || hxtOffset + entry.hxt_bytes > bundle.bytes.length) throw new Error(`Semantic entry ${index + 1} HXT bounds are invalid`);
    const partition = bundlePartitions.get(bundlePath) ?? { offset: 0, count: 0 };
    if (hxtOffset !== partition.offset) throw new Error(`Semantic entry ${index + 1} HXT partition is invalid`);
    bundlePartitions.set(bundlePath, { offset: hxtOffset + entry.hxt_bytes, count: partition.count + 1 });
    const hxt = bundle.bytes.subarray(hxtOffset, hxtOffset + entry.hxt_bytes);
    const hxmPath = safePath(entry.hxm, ".hxm", `semantic entry ${index + 1} HXM`);
    if (hxmPath !== `timing/${entry.hxm_sha256}.hxm`) throw new Error(`Semantic entry ${index + 1} HXM identity is invalid`);
    const hxm = stableRead(inside(packageRoot, hxmPath));
    if (sha256(hxt) !== entry.hxt_sha256 || hxm.length !== entry.hxm_bytes || sha256(hxm) !== entry.hxm_sha256) {
      throw new Error(`Semantic entry ${index + 1} sidecar hash mismatch`);
    }
    let decoded;
    try {
      decoded = await decodeRuntimeSemanticSubtitle(new Uint8Array(hxt), new Uint8Array(hxm), {
        sourceSha256: entry.source_sha256,
        chaptersSha256: entry.chapters_sha256,
        hxtSha256: entry.hxt_sha256,
        hxmSha256: entry.hxm_sha256,
      });
    } catch (error) {
      throw new Error(`Semantic entry ${index + 1} decoder verification failed`, { cause: error });
    }
    if (
      decoded.cueCount !== entry.cue_count
      || decoded.metadata.profile !== entry.profile
      || decoded.metadata.chapters.length !== entry.chapter_count
      || sourceCueEnd(decoded.subtitle) !== entry.duration
    ) throw new Error(`Semantic entry ${index + 1} decoded metadata mismatch`);
    expectedFiles.add(hxmPath);
    byCollection[entry.collection] = (byCollection[entry.collection] ?? 0) + 1;
    cueCount += entry.cue_count;
    chapterCount += entry.chapter_count;
    hxtBytes += entry.hxt_bytes;
    hxmBytes += entry.hxm_bytes;
  }
  for (const [bundlePath, bundle] of bundles) {
    const partition = bundlePartitions.get(bundlePath);
    if (!partition || partition.offset !== bundle.bytes.length || partition.count !== bundle.member_count) {
      throw new Error(`Semantic bundle ${bundlePath} does not have a complete entry partition`);
    }
  }
  const expectedCounts = {
    collection_count: Object.keys(byCollection).length,
    pair_count: seen.size,
    cue_count: cueCount,
    chapter_count: chapterCount,
    by_collection: Object.fromEntries(Object.entries(byCollection).sort(([left], [right]) => left.localeCompare(right, "en"))),
    hxt_bytes: hxtBytes,
    hxm_bytes: hxmBytes,
  };
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error("Semantic runtime manifest counts do not match payloads");
  const actualFiles = new Set(fs.readdirSync(packageRoot, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => item.parentPath ? path.relative(packageRoot, path.join(item.parentPath, item.name)).split(path.sep).join("/") : item.name));
  if (actualFiles.size !== expectedFiles.size || [...actualFiles].some((file) => !expectedFiles.has(file))) {
    throw new Error("Semantic runtime package has missing or orphan payloads");
  }
  const formalReady = formalCorpusReady(expectedCounts, terminalUnavailable);
  if (requireFormalCorpus && !formalReady) {
    throw new Error("Semantic runtime package does not satisfy the formal 1,433-file deployment gate");
  }
  return {
    packageRoot,
    manifest,
    manifestBytes,
    pairs: seen.size,
    bundles: bundles.size,
    counts: expectedCounts,
    terminalUnavailable: terminalUnavailable.registry,
    terminalUnavailableCount: terminalUnavailable.sources.size,
    formalReady,
  };
}

function copyVerifiedPackageTree(sourceRoot, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  const pending = [""];
  while (pending.length) {
    const relativeDirectory = pending.pop();
    const sourceDirectory = path.join(sourceRoot, relativeDirectory);
    const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const source = path.join(sourceRoot, relative);
      const target = path.join(targetRoot, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: false });
        pending.push(relative);
      } else if (entry.isFile()) {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      } else {
        throw new Error(`Semantic runtime package contains an unsupported filesystem entry: ${relative}`);
      }
    }
  }
}

export function installSemanticRuntimePackage(validated, targetRoot = defaultTarget, { allowPartial = false } = {}) {
  if (!allowPartial && !validated.formalReady) {
    throw new Error("Refusing to install a semantic runtime package before the formal 1,433-audio gate passes");
  }
  targetRoot = path.resolve(targetRoot);
  if (path.basename(targetRoot) !== "subtitles-runtime") throw new Error("Semantic runtime target must be named subtitles-runtime");
  const parent = path.dirname(targetRoot);
  const staging = path.join(parent, `.${path.basename(targetRoot)}.import-${process.pid}`);
  const backup = path.join(parent, `.${path.basename(targetRoot)}.backup-${process.pid}`);
  fs.mkdirSync(parent, { recursive: true });
  fs.rmSync(staging, { force: true, recursive: true });
  fs.rmSync(backup, { force: true, recursive: true });
  try {
    // Node's recursive cp implementation has crashed natively on Windows when
    // the workspace path contains non-ASCII segments. Copy the already
    // validated, regular-file-only package explicitly before the same-volume
    // atomic rename. COPYFILE_EXCL also keeps a stale staging directory from
    // being merged silently.
    copyVerifiedPackageTree(validated.packageRoot, staging);
    if (fs.existsSync(targetRoot)) fs.renameSync(targetRoot, backup);
    fs.renameSync(staging, targetRoot);
    fs.rmSync(backup, { force: true, recursive: true });
  } catch (error) {
    fs.rmSync(staging, { force: true, recursive: true });
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
  const allowPartial = process.argv.includes("--allow-partial");
  if (!packageRoot) throw new Error("Usage: --package <directory> [--dry-run] [--allow-partial]");
  const validated = await validateSemanticRuntimePackage(packageRoot, undefined, { requireFormalCorpus: !allowPartial });
  if (!process.argv.includes("--dry-run")) installSemanticRuntimePackage(validated, defaultTarget, { allowPartial });
  process.stdout.write(`${JSON.stringify({
    mode: process.argv.includes("--dry-run") ? "dry-run" : "installed",
    pairs: validated.pairs,
    bundles: validated.bundles,
    counts: validated.counts,
    terminal_unavailable: validated.terminalUnavailableCount,
    formal_ready: validated.formalReady,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
