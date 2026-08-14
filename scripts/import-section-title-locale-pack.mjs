import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), "..");
const TARGET = path.join(ROOT, "public", "subtitles-title-locales");
const HASH = /^[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._@+()/-]*\.json$/u;
const EXPECTED_PAIRS = 1433;

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(bytes, label) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(`${label} is not valid UTF-8`); }
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) throw new Error(`${label} is not canonical JSON`);
  return value;
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is not an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new Error(`${label} has unexpected fields`);
  return value;
}

function stableRead(file) {
  const before = fs.statSync(file, { bigint: true });
  const bytes = fs.readFileSync(file);
  const after = fs.statSync(file, { bigint: true });
  if (!before.isFile() || before.size !== after.size || before.mtimeNs !== after.mtimeNs || BigInt(bytes.length) !== after.size) {
    throw new Error(`File changed while being read: ${file}`);
  }
  return bytes;
}

function inside(root, relative) {
  if (!SAFE.test(relative) || relative.includes("..")) throw new Error(`Unsafe locale bundle path: ${relative}`);
  const result = path.resolve(root, ...relative.split("/"));
  if (!result.startsWith(`${root}${path.sep}`)) throw new Error(`Locale bundle path escapes package: ${relative}`);
  return result;
}

export function validateSectionTitleLocalePackage(packageRoot) {
  packageRoot = path.resolve(packageRoot);
  const manifestBytes = stableRead(path.join(packageRoot, "manifest.json"));
  const manifest = exact(canonical(manifestBytes, "locale manifest"), ["schema", "generated_at", "counts", "bundles", "entries"], "locale manifest");
  if (manifest.schema !== "section-title-locale-pack-v1" || !Array.isArray(manifest.bundles) || !Array.isArray(manifest.entries)) {
    throw new Error("Locale manifest identity is invalid");
  }
  exact(manifest.counts, ["collection_count", "pair_count", "title_count"], "locale counts");
  if (manifest.counts.pair_count !== EXPECTED_PAIRS || manifest.entries.length !== EXPECTED_PAIRS) {
    throw new Error(`Locale package must contain exactly ${EXPECTED_PAIRS} pairs`);
  }
  const sources = new Set();
  let titles = 0;
  const bundles = manifest.bundles.map((raw, index) => {
    const item = exact(raw, ["collection", "path", "sha256", "bytes", "entry_count", "title_count"], `bundle ${index + 1}`);
    if (!HASH.test(item.sha256) || !Number.isInteger(item.bytes) || item.bytes < 1) throw new Error(`Bundle ${index + 1} identity is invalid`);
    const bytes = stableRead(inside(packageRoot, item.path));
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error(`Bundle ${item.path} hash or size mismatch`);
    const bundle = exact(canonical(bytes, `bundle ${item.path}`), ["schema", "collection", "entries"], `bundle ${item.path}`);
    if (bundle.schema !== "section-title-locale-bundle-v1" || bundle.collection !== item.collection) throw new Error(`Bundle ${item.path} identity mismatch`);
    if (Object.keys(bundle.entries).length !== item.entry_count) throw new Error(`Bundle ${item.path} entry count mismatch`);
    return { item, bytes, bundle };
  });
  for (const raw of manifest.entries) {
    const entry = exact(raw, ["source", "source_sha256", "chapters_sha256", "bundle", "title_count"], "locale entry");
    if (sources.has(entry.source) || !HASH.test(entry.source_sha256) || !HASH.test(entry.chapters_sha256)) throw new Error("Locale entry identity is invalid");
    sources.add(entry.source);
    const bundle = bundles.find(({ item }) => item.path === entry.bundle)?.bundle;
    const payload = bundle?.entries?.[entry.source];
    if (!payload || payload.source_sha256 !== entry.source_sha256 || payload.chapters_sha256 !== entry.chapters_sha256) {
      throw new Error(`Locale entry ${entry.source} is missing or hash-unbound`);
    }
    if (Object.keys(payload.titles ?? {}).length !== entry.title_count) throw new Error(`Locale entry ${entry.source} title count mismatch`);
    for (const [id, title] of Object.entries(payload.titles)) {
      exact(title, ["zh-TW", "en"], `${entry.source}:${id}`);
      if (typeof title["zh-TW"] !== "string" || !title["zh-TW"] || typeof title.en !== "string" || !title.en || /[\u2e80-\u9fff]/u.test(title.en)) {
        throw new Error(`Locale entry ${entry.source}:${id} language is invalid`);
      }
    }
    titles += entry.title_count;
  }
  if (
    manifest.counts.collection_count !== bundles.length
    || manifest.counts.title_count !== titles
    || bundles.reduce((sum, { item }) => sum + item.entry_count, 0) !== EXPECTED_PAIRS
  ) throw new Error("Locale package counts are inconsistent");
  return { manifest, manifestBytes, bundles };
}

export function installSectionTitleLocalePackage(validated, target = TARGET) {
  target = path.resolve(target);
  if (path.basename(target) !== "subtitles-title-locales") throw new Error("Locale target name is invalid");
  const parent = path.dirname(target);
  const staging = path.join(parent, `.${path.basename(target)}.import-${process.pid}`);
  const backup = path.join(parent, `.${path.basename(target)}.backup-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(staging, "bundles"), { recursive: true });
    fs.writeFileSync(path.join(staging, "manifest.json"), validated.manifestBytes);
    for (const { item, bytes } of validated.bundles) {
      const destination = inside(staging, item.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    fs.renameSync(staging, target);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

async function main() {
  const packageRoot = argument("--package");
  if (!packageRoot) throw new Error("Usage: --package <directory> [--dry-run]");
  const validated = validateSectionTitleLocalePackage(packageRoot);
  if (!process.argv.includes("--dry-run")) installSectionTitleLocalePackage(validated);
  console.log(JSON.stringify({ mode: process.argv.includes("--dry-run") ? "dry-run" : "installed", pairs: validated.manifest.counts.pair_count }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
