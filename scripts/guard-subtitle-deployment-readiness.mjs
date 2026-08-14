import fs from "node:fs";
import path from "node:path";

import { validateSectionTitleLocalePackage } from "./import-section-title-locale-pack.mjs";
import { validateSemanticRuntimePackage } from "./import-subtitle-runtime-semantic-pack.mjs";
import { logicalContentEntries, publicRoot } from "./lib/static-content-codec.mjs";

const EXPECTED = 1433;
const projectRoot = path.resolve(import.meta.dirname, "..");
const semanticRoot = path.join(publicRoot, "subtitles-runtime");
const localeRoot = path.join(publicRoot, "subtitles-title-locales");
const forbiddenCanonicalRoot = path.join(publicRoot, "subtitles");

function materializePackedSemanticRuntime() {
  const runtimeRoot = path.join(projectRoot, ".sites-runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(runtimeRoot, "subtitle-readiness-"));
  const copySupplementalFiles = (directory, relative = "") => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const source = path.join(directory, entry.name);
      const destination = path.resolve(temporaryRoot, ...childRelative.split("/"));
      if (!destination.startsWith(`${temporaryRoot}${path.sep}`)) {
        throw new Error(`Supplemental semantic runtime path escapes temporary root: ${childRelative}`);
      }
      if (entry.isDirectory()) copySupplementalFiles(source, childRelative);
      else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
      }
    }
  };
  // HXM timing sidecars remain direct immutable assets; only the manifest and
  // HXT bundles live inside content packs.  Reassemble both storage classes in
  // one temporary package so the same strict validator covers the built form.
  copySupplementalFiles(semanticRoot);
  let files = 0;
  for (const [logicalPath, bytes] of logicalContentEntries(publicRoot)) {
    if (!logicalPath.startsWith("subtitles-runtime/")) continue;
    const relative = logicalPath.slice("subtitles-runtime/".length);
    if (!relative || relative.includes("\\") || relative.split("/").includes("..")) {
      throw new Error(`Unsafe packed semantic runtime path: ${logicalPath}`);
    }
    const destination = path.resolve(temporaryRoot, ...relative.split("/"));
    if (!destination.startsWith(`${temporaryRoot}${path.sep}`)) {
      throw new Error(`Packed semantic runtime path escapes temporary root: ${logicalPath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(bytes)) {
      throw new Error(`Packed and supplemental semantic runtime conflict: ${logicalPath}`);
    }
    fs.writeFileSync(destination, bytes);
    files += 1;
  }
  if (files === 0) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw new Error("Semantic subtitle runtime is absent from both raw assets and content packs");
  }
  return { temporaryRoot, files };
}

if (fs.existsSync(forbiddenCanonicalRoot)) {
  throw new Error("Deployment public root must not contain timestamp-duplicating canonical subtitles.");
}

let packedRuntime = null;
let semantic;
try {
  const runtimeRoot = fs.existsSync(path.join(semanticRoot, "manifest.json"))
    ? semanticRoot
    : (packedRuntime = materializePackedSemanticRuntime()).temporaryRoot;
  semantic = await validateSemanticRuntimePackage(runtimeRoot, undefined, { requireFormalCorpus: true });
} finally {
  if (packedRuntime) fs.rmSync(packedRuntime.temporaryRoot, { recursive: true, force: true });
}
if (
  semantic.manifest.counts.pair_count !== EXPECTED
  || semantic.manifest.entries.length !== EXPECTED
  || semantic.manifest.terminal_unavailable_sha256 !== null
) throw new Error(`Semantic subtitle runtime must contain ${EXPECTED} formal pairs and no unavailable partition.`);

const locales = validateSectionTitleLocalePackage(localeRoot);
if (locales.manifest.counts.pair_count !== EXPECTED || locales.manifest.entries.length !== EXPECTED) {
  throw new Error(`Section title locale runtime must contain ${EXPECTED} exact pairs.`);
}

const semanticBySource = new Map(semantic.manifest.entries.map((entry) => [entry.source, entry]));
for (const locale of locales.manifest.entries) {
  const pair = semanticBySource.get(locale.source);
  if (
    !pair
    || pair.source_sha256 !== locale.source_sha256
    || pair.chapters_sha256 !== locale.chapters_sha256
  ) throw new Error(`Section title locale hash drift for ${locale.source}.`);
}

console.log(JSON.stringify({
  ready: true,
  semantic_pairs: semantic.manifest.counts.pair_count,
  locale_pairs: locales.manifest.counts.pair_count,
  terminal_unavailable: 0,
  canonical_timestamp_payloads: 0,
  semantic_storage: packedRuntime ? "content-pack" : "raw",
}));
