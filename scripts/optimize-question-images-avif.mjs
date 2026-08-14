import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imageRoot = path.join(projectRoot, "public", "data", "images");
const contentRoots = [
  path.join(projectRoot, "public", "data"),
  path.join(projectRoot, "public", "guides"),
  path.join(projectRoot, "app"),
];
const stageRoot = path.join(projectRoot, ".sites-runtime", "question-image-avif-stage");

// Start with the smallest candidate and raise quality only when the decoded
// result misses the clinical-detail floor.
const candidateCrfs = [30, 28, 26, 24, 22, 20, 18];
const minimumLumaSsim = 0.985;
const minimumAllSsim = 0.975;
const maximumStoredRatio = 0.85;

function walk(directory, predicate, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, predicate, files);
    else if (entry.isFile() && predicate(absolute)) files.push(absolute);
  }
  return files;
}

function runFfmpeg(args, label) {
  const result = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label}：${result.stderr?.trim() || `ffmpeg exited ${result.status}`}`);
  }
  return result.stderr ?? "";
}

function encodeCandidate(source, output, crf) {
  runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", source,
    "-c:v", "libaom-av1",
    "-crf", String(crf),
    "-cpu-used", "4",
    "-still-picture", "1",
    "-pix_fmt", "yuv420p10le",
    output,
  ], `無法轉換 ${path.basename(source)} (CRF ${crf})`);
}

function measureCandidate(source, candidate) {
  const stderr = runFfmpeg([
    "-hide_banner",
    "-i", source,
    "-i", candidate,
    "-lavfi",
    "[0:v]format=yuv420p10le[source];"
      + "[1:v]format=yuv420p10le[candidate];"
      + "[source][candidate]ssim",
    "-f", "null",
    "-",
  ], `無法量測 ${path.basename(candidate)}`);
  const match = stderr.match(/SSIM Y:([0-9.]+).*All:([0-9.]+)/u);
  if (!match) throw new Error(`無法讀取 ${path.basename(candidate)} 的 SSIM`);
  return {
    lumaSsim: Number(match[1]),
    allSsim: Number(match[2]),
  };
}

function atomicWrite(target, contents) {
  const temporary = `${target}.tmp-avif-${process.pid}`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, target);
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function contentFiles() {
  return contentRoots.flatMap((root) => walk(
    root,
    (file) => /\.(?:css|json|md|tsx?)$/u.test(file),
  ));
}

if (!fs.existsSync(imageRoot)) throw new Error(`找不到題目圖片目錄：${imageRoot}`);
fs.rmSync(stageRoot, { force: true, recursive: true });
fs.mkdirSync(stageRoot, { recursive: true });

const sources = walk(imageRoot, (file) => file.endsWith(".webp"))
  .sort((left, right) => left.localeCompare(right, "en"));
if (!sources.length) {
  console.log("Question image AVIF optimization: no WebP sources remain");
  process.exit(0);
}

const textFiles = contentFiles();
const textByFile = new Map(textFiles.map((file) => [file, fs.readFileSync(file, "utf8")]));
const selected = [];
const rejected = [];

try {
  for (const source of sources) {
    const sourceBytes = fs.statSync(source).size;
    const basename = path.basename(source, ".webp");
    const logicalSource = `/data/images/${path.basename(source)}`;
    const references = [...textByFile.values()]
      .reduce((total, text) => total + text.split(logicalSource).length - 1, 0);
    if (!references) {
      rejected.push({ source, reason: "unreferenced" });
      continue;
    }

    let accepted = null;
    for (const crf of candidateCrfs) {
      const candidate = path.join(stageRoot, `${basename}-crf${crf}.avif`);
      encodeCandidate(source, candidate, crf);
      const metrics = measureCandidate(source, candidate);
      const candidateBytes = fs.statSync(candidate).size;
      const storedRatio = candidateBytes / sourceBytes;
      if (
        metrics.lumaSsim >= minimumLumaSsim
        && metrics.allSsim >= minimumAllSsim
      ) {
        if (storedRatio <= maximumStoredRatio) {
          accepted = {
            source,
            sourceBytes,
            logicalSource,
            references,
            candidate,
            candidateBytes,
            storedRatio,
            crf,
            ...metrics,
          };
        }
        break;
      }
      fs.rmSync(candidate, { force: true });
    }
    if (accepted) selected.push(accepted);
    else rejected.push({ source, reason: "quality-or-savings-floor" });
  }

  const canonicalByHash = new Map();
  const mappings = new Map();
  for (const entry of selected) {
    const hash = hashFile(entry.candidate);
    const existing = canonicalByHash.get(hash);
    if (existing) {
      entry.duplicateOf = existing.logicalTarget;
      mappings.set(entry.logicalSource, existing.logicalTarget);
      fs.rmSync(entry.candidate, { force: true });
      continue;
    }
    const targetName = `${path.basename(entry.source, ".webp")}.avif`;
    const target = path.join(imageRoot, targetName);
    entry.target = target;
    entry.logicalTarget = `/data/images/${targetName}`;
    canonicalByHash.set(hash, entry);
    mappings.set(entry.logicalSource, entry.logicalTarget);
  }

  const rewritten = new Map();
  let changedContentFiles = 0;
  for (const [file, original] of textByFile) {
    let next = original;
    for (const [source, target] of mappings) next = next.replaceAll(source, target);
    if (next !== original) {
      rewritten.set(file, next);
      changedContentFiles += 1;
    }
  }
  for (const logicalSource of mappings.keys()) {
    if ([...rewritten.values(), ...[...textByFile.entries()]
      .filter(([file]) => !rewritten.has(file))
      .map(([, text]) => text)].some((text) => text.includes(logicalSource))) {
      throw new Error(`仍有舊圖片路徑未更新：${logicalSource}`);
    }
  }

  for (const [file, contents] of rewritten) atomicWrite(file, contents);
  for (const entry of canonicalByHash.values()) fs.renameSync(entry.candidate, entry.target);
  for (const entry of selected) fs.rmSync(entry.source);

  const sourceBytes = selected.reduce((total, entry) => total + entry.sourceBytes, 0);
  const avifBytes = [...canonicalByHash.values()]
    .reduce((total, entry) => total + entry.candidateBytes, 0);
  const summary = {
    sources: sources.length,
    converted: selected.length,
    retainedWebp: rejected.length,
    deduplicated: selected.length - canonicalByHash.size,
    changedContentFiles,
    sourceBytes,
    avifBytes,
    savedBytes: sourceBytes - avifBytes,
    storedRatio: Number((avifBytes / sourceBytes).toFixed(4)),
    qualityFloor: {
      minimumLumaSsim,
      minimumAllSsim,
      maximumStoredRatio,
    },
    selectedCrfs: Object.fromEntries(candidateCrfs.map((crf) => [
      String(crf),
      selected.filter((entry) => entry.crf === crf).length,
    ])),
    minimumMeasuredLumaSsim: Math.min(...selected.map((entry) => entry.lumaSsim)),
    minimumMeasuredAllSsim: Math.min(...selected.map((entry) => entry.allSsim)),
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.rmSync(stageRoot, { force: true, recursive: true });
}
