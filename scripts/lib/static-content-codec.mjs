import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from "node:zlib";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const publicRoot = path.join(projectRoot, "public");
export const brotliQuality = 11;
export const contentPackTargetBytes = 8 * 1024 * 1024;
export const contentPackSingletonBytes = 1024 * 1024;
export const contentPackMaxRawBytes = 32 * 1024 * 1024;
export const contentPackMaxCompressedBytes = 33 * 1024 * 1024;
export const contentPackDirectoryName = "content-packs";
export const contentPackIndexName = "index.brp";
export const contentPackSchemaVersion = 3;
const inlineDigestContentPackSchemaVersion = 2;
const legacyContentPackSchemaVersion = 1;
const contentDigestBytes = 32;
export const startupSingletonLogicalPaths = new Set([
  "data/explanation-packs/manifest.json",
  "data/index.json",
  "data/manifest.json",
  "data/startup-index.json",
  "guides/links.json",
  "guides/manifest.json",
  "guides/rosens/manifest.json",
  "guides/tintinalli/manifest.json",
  "guides/ems/manifest.json",
  "guides/goldfrank/manifest.json",
  // The semantic subtitle manifest is a small startup lookup. HXT bundles are
  // separately forced to singleton packs below so their q11 body can stream
  // intact instead of being inflated and re-compressed per request.
  "subtitles-runtime/manifest.json",
]);
const boardRuntimeSingletonPattern = /^(?:data\/board-trace\/routes\/\d{3}[AB]?\.json|guides\/board\/manifest\.json|guides\/board\/units\/\d{1,2}[A-Z]\d?\.(?:json|md))$/u;
const semanticSubtitleBundlePattern = /^subtitles-runtime\/bundles\/[a-f0-9]{64}\.hxtb$/u;

export function singletonLogicalPath(logicalPath) {
  return startupSingletonLogicalPaths.has(logicalPath)
    || boardRuntimeSingletonPattern.test(logicalPath)
    || semanticSubtitleBundlePattern.test(logicalPath);
}

const managedDirectoryNames = ["data", "guides", "subtitles", "subtitles-runtime"];
const maxIndexCompressedBytes = 1024 * 1024;
const maxIndexRawBytes = 4 * 1024 * 1024;
const maxPackCount = 2048;
const maxEntryCount = 20_000;
const maxLogicalPathBytes = 256;
const rawPattern = /\.(?:json|md|src|hxtb)$/u;
const legacyBrotliPattern = /\.(?:json|md|src)\.br$/u;
const legacyGzipPattern = /\.(?:json|md|src)\.gz$/u;
const packedAssetPattern = /^[a-f0-9]{64}\.brp$/u;
const digestAssetPattern = /^[a-f0-9]{64}\.bin$/u;
const managedLogicalPattern = /^(?:(?:data|guides)\/[A-Za-z0-9._@+()/+-]+\.(?:json|md)|subtitles\/(?:manifest\.json|[A-Za-z0-9._@+()/+-]+\/(?:[A-Za-z0-9._@+()-]+\.(?:src|chapters\.json)))|subtitles-runtime\/(?:manifest\.json|bundles\/[a-f0-9]{64}\.hxtb))$/u;
const questionDetailPattern = /^data\/questions\/[^/]+\/[^/]+\.json$/u;
const lockPath = path.join(projectRoot, ".sites-runtime", "static-content.lock");
const binaryCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function walk(directory, predicate, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => binaryCompare(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, predicate, files);
    else if (entry.isFile() && predicate(absolute)) files.push(absolute);
  }
  return files;
}

function managedFiles(contentRoot, predicate) {
  return managedDirectoryNames.flatMap((directory) => walk(path.join(contentRoot, directory), predicate));
}

function relativePath(contentRoot, file) {
  return path.relative(contentRoot, file).split(path.sep).join("/");
}

function managedLogicalPath(value) {
  return managedLogicalPattern.test(value)
    && Buffer.byteLength(value, "utf8") <= maxLogicalPathBytes
    && !value.includes("\\")
    && !value.includes("//")
    && !value.split("/").includes("..");
}

export function computeQuestionDataRevision(entries) {
  const questions = entries
    .filter(([logicalPath]) => questionDetailPattern.test(logicalPath))
    .sort(([left], [right]) => binaryCompare(left, right));
  if (!questions.length) return null;
  const hash = crypto.createHash("sha256");
  for (const [logicalPath, bytes] of questions) {
    hash.update(logicalPath, "utf8");
    hash.update("\0");
    hash.update(String(bytes.length), "ascii");
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function rawFiles(contentRoot = publicRoot) {
  return managedFiles(contentRoot, (file) => rawPattern.test(file));
}

export function legacyBrotliFiles(contentRoot = publicRoot) {
  return managedFiles(contentRoot, (file) => legacyBrotliPattern.test(file));
}

// Kept as a compatibility alias for older maintenance scripts.
export const brotliFiles = legacyBrotliFiles;

export function legacyGzipFiles(contentRoot = publicRoot) {
  return managedFiles(contentRoot, (file) => legacyGzipPattern.test(file));
}

export function contentPackDirectory(contentRoot = publicRoot) {
  return path.join(contentRoot, contentPackDirectoryName);
}

export function contentPackIndexPath(contentRoot = publicRoot) {
  return path.join(contentPackDirectory(contentRoot), contentPackIndexName);
}

export function contentPackFiles(contentRoot = publicRoot) {
  const directory = path.join(contentPackDirectory(contentRoot), "packs");
  return walk(directory, (file) => packedAssetPattern.test(path.basename(file)));
}

function canonicalBrotli(bytes, quality = brotliQuality) {
  const windowBits = Math.min(24, Math.max(22, Math.ceil(Math.log2(Math.max(1, bytes.length)))));
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: quality,
      [zlibConstants.BROTLI_PARAM_LGWIN]: windowBits,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
}

function atomicWrite(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-static-${process.pid}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function validateDecoded(logicalPath, decoded) {
  if (decoded.length === 0) throw new Error(`壓縮內容不可為空：${logicalPath}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  if (logicalPath.endsWith(".json")) JSON.parse(text);
}

function parsePackIndexBytes(compressed, label) {
  if (compressed.length > maxIndexCompressedBytes) {
    throw new Error(`內容索引壓縮大小超過上限：${label}`);
  }
  let decoded;
  try {
    decoded = brotliDecompressSync(compressed, { maxOutputLength: maxIndexRawBytes });
  } catch (error) {
    throw new Error(`無法解壓內容索引：${label}`, { cause: error });
  }

  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch (error) {
    throw new Error(`內容索引不是有效 JSON：${label}`, { cause: error });
  }
  return normalizePackIndex(value, label);
}

function normalizePackIndex(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`內容索引格式錯誤：${label}`);
  }
  if (
    value.v !== legacyContentPackSchemaVersion
    && value.v !== inlineDigestContentPackSchemaVersion
    && value.v !== contentPackSchemaVersion
  ) {
    throw new Error(`內容索引版本不支援：${label}`);
  }
  if (!Number.isSafeInteger(value.t) || value.t <= 0 || value.t > contentPackMaxRawBytes) {
    throw new Error(`內容索引缺少有效分塊大小：${label}`);
  }
  const singletonBytes = value.s ?? value.t;
  if (
    !Number.isSafeInteger(singletonBytes)
    || singletonBytes <= 0
    || singletonBytes > value.t
    || singletonBytes > contentPackSingletonBytes
  ) {
    throw new Error(`內容索引缺少有效單檔分塊門檻：${label}`);
  }
  if (
    !Array.isArray(value.p)
    || value.p.length === 0
    || value.p.length > maxPackCount
    || !Array.isArray(value.e)
    || value.e.length === 0
    || value.e.length > maxEntryCount
  ) {
    throw new Error(`內容索引缺少分塊或檔案：${label}`);
  }

  const packNames = new Set();
  const packs = value.p.map((entry, packNumber) => {
    if (!Array.isArray(entry) || entry.length !== 3) {
      throw new Error(`內容索引的分塊 ${packNumber} 格式錯誤：${label}`);
    }
    const [name, rawBytes, sha256] = entry;
    if (typeof name !== "string" || !packedAssetPattern.test(name) || name !== `${sha256}.brp`) {
      throw new Error(`內容索引的分塊名稱錯誤：${label}`);
    }
    if (packNames.has(name)) throw new Error(`內容索引含重複分塊：${name}`);
    if (!Number.isSafeInteger(rawBytes) || rawBytes <= 0 || rawBytes > contentPackMaxRawBytes) {
      throw new Error(`內容索引的分塊大小錯誤：${name}`);
    }
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error(`內容索引的分塊摘要錯誤：${name}`);
    }
    packNames.add(name);
    return [name, rawBytes, sha256];
  });

  const paths = new Set();
  const nextOffset = new Array(packs.length).fill(0);
  let previousPath = "";
  const entriesHaveInlineDigests = value.v === inlineDigestContentPackSchemaVersion;
  const entries = value.e.map((entry, entryNumber) => {
    if (
      !Array.isArray(entry)
      || entry.length !== (entriesHaveInlineDigests ? 5 : 4)
    ) {
      throw new Error(`內容索引的檔案 ${entryNumber} 格式錯誤：${label}`);
    }
    const [logicalPath, packNumber, offset, length, contentSha256 = null] = entry;
    if (typeof logicalPath !== "string" || !managedLogicalPath(logicalPath)) {
      throw new Error(`內容索引含不安全或無效路徑：${String(logicalPath)}`);
    }
    if (logicalPath <= previousPath || paths.has(logicalPath)) {
      throw new Error(`內容索引路徑未嚴格排序或重複：${logicalPath}`);
    }
    if (!Number.isSafeInteger(packNumber) || packNumber < 0 || packNumber >= packs.length) {
      throw new Error(`內容索引的分塊編號錯誤：${logicalPath}`);
    }
    if (!Number.isSafeInteger(offset) || offset !== nextOffset[packNumber]) {
      throw new Error(`內容索引的位移不連續：${logicalPath}`);
    }
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > packs[packNumber][1]) {
      throw new Error(`內容索引的長度錯誤：${logicalPath}`);
    }
    if (
      entriesHaveInlineDigests
      && (
        typeof contentSha256 !== "string"
        || !/^[a-f0-9]{64}$/u.test(contentSha256)
      )
    ) {
      throw new Error(`Invalid packed content entry digest: ${logicalPath}`);
    }
    previousPath = logicalPath;
    paths.add(logicalPath);
    nextOffset[packNumber] += length;
    return entriesHaveInlineDigests
      ? [logicalPath, packNumber, offset, length, contentSha256]
      : [logicalPath, packNumber, offset, length];
  });

  for (let packNumber = 0; packNumber < packs.length; packNumber += 1) {
    if (nextOffset[packNumber] !== packs[packNumber][1]) {
      throw new Error(`內容分塊未被索引完整覆蓋：${packs[packNumber][0]}`);
    }
  }

  let digestAsset = null;
  if (value.v === contentPackSchemaVersion) {
    if (!Array.isArray(value.d) || value.d.length !== 3) {
      throw new Error(`內容索引缺少檔案摘要 sidecar：${label}`);
    }
    const [name, bytes, sha256] = value.d;
    if (
      typeof name !== "string"
      || !digestAssetPattern.test(name)
      || typeof sha256 !== "string"
      || name !== `${sha256}.bin`
      || !Number.isSafeInteger(bytes)
      || bytes !== entries.length * contentDigestBytes
    ) {
      throw new Error(`內容索引的檔案摘要 sidecar 格式錯誤：${label}`);
    }
    digestAsset = [name, bytes, sha256];
  }

  const hasQuestionDetails = entries.some(([logicalPath]) => questionDetailPattern.test(logicalPath));
  const questionDataRevision = value.v === contentPackSchemaVersion ? (value.q ?? null) : null;
  if (
    value.v === contentPackSchemaVersion
    && (
      (hasQuestionDetails && (typeof questionDataRevision !== "string" || !/^[a-f0-9]{64}$/u.test(questionDataRevision)))
      || (!hasQuestionDetails && questionDataRevision !== null)
    )
  ) {
    throw new Error(`內容索引的題庫版本摘要格式錯誤：${label}`);
  }

  return {
    v: value.v,
    t: value.t,
    s: singletonBytes,
    p: packs,
    e: entries,
    d: digestAsset,
    q: questionDataRevision,
  };
}

export function readContentPackIndex(contentRoot = publicRoot) {
  const indexPath = contentPackIndexPath(contentRoot);
  if (!fs.existsSync(indexPath)) return null;
  return parsePackIndexBytes(fs.readFileSync(indexPath), relativePath(contentRoot, indexPath));
}

function decodePackedEntries(contentRoot, index = readContentPackIndex(contentRoot)) {
  if (!index) return [];
  const directory = contentPackDirectory(contentRoot);
  const expectedAssets = new Set([
    contentPackIndexName,
    ...index.p.map(([name]) => `packs/${name}`),
    ...(index.d ? [`digests/${index.d[0]}`] : []),
  ]);
  const actualAssets = new Set(walk(directory, () => true).map((file) => relativePath(directory, file)));
  if (actualAssets.size !== expectedAssets.size) {
    throw new Error(`內容分塊資產數量不符：${actualAssets.size}，索引預期 ${expectedAssets.size}`);
  }
  for (const expected of expectedAssets) {
    if (!actualAssets.has(expected)) throw new Error(`內容分塊資產遺失：${expected}`);
  }

  const decodedPacks = index.p.map(([name, rawBytes, sha256]) => {
    const packedPath = path.join(directory, "packs", name);
    const compressed = fs.readFileSync(packedPath);
    if (compressed.length > contentPackMaxCompressedBytes) {
      throw new Error(`內容分塊壓縮大小超過上限：${name}`);
    }
    if (digest(compressed) !== sha256) throw new Error(`內容分塊摘要不符：${name}`);
    let decoded;
    try {
      decoded = brotliDecompressSync(compressed, { maxOutputLength: rawBytes });
    } catch (error) {
      throw new Error(`無法解壓內容分塊：${name}`, { cause: error });
    }
    if (decoded.length !== rawBytes) throw new Error(`內容分塊還原大小不符：${name}`);
    return decoded;
  });

  let sidecarDigests = null;
  if (index.d) {
    const [name, expectedBytes, expectedSha256] = index.d;
    const digestPath = path.join(directory, "digests", name);
    sidecarDigests = fs.readFileSync(digestPath);
    if (
      sidecarDigests.length !== expectedBytes
      || digest(sidecarDigests) !== expectedSha256
    ) {
      throw new Error(`內容檔案摘要 sidecar 驗證失敗：${name}`);
    }
  }

  return index.e.map(([logicalPath, packNumber, offset, length, inlineSha256], entryNumber) => {
    const decoded = decodedPacks[packNumber].subarray(offset, offset + length);
    const contentSha256 = inlineSha256 || (sidecarDigests
      ? sidecarDigests.subarray(
          entryNumber * contentDigestBytes,
          (entryNumber + 1) * contentDigestBytes,
        ).toString("hex")
      : null);
    if (contentSha256 && digest(decoded) !== contentSha256) {
      throw new Error(`Packed content entry digest mismatch: ${logicalPath}`);
    }
    validateDecoded(logicalPath, decoded);
    return [logicalPath, Buffer.from(decoded)];
  });
}

function decodeLegacyEntries(contentRoot) {
  return legacyBrotliFiles(contentRoot).map((file) => {
    const logicalPath = relativePath(contentRoot, file.slice(0, -3));
    const compressed = fs.readFileSync(file);
    if (compressed.length > contentPackMaxCompressedBytes) {
      throw new Error(`舊 Brotli 資產壓縮大小超過上限：${logicalPath}`);
    }
    const decoded = brotliDecompressSync(compressed, { maxOutputLength: contentPackMaxRawBytes });
    validateDecoded(logicalPath, decoded);
    return [logicalPath, decoded];
  });
}

export function logicalContentEntries(contentRoot = publicRoot) {
  const index = readContentPackIndex(contentRoot);
  if (index) return decodePackedEntries(contentRoot, index);
  return decodeLegacyEntries(contentRoot);
}

function directoryBytes(directory) {
  if (!fs.existsSync(directory)) return null;
  return new Map(walk(directory, () => true).map((file) => [
    relativePath(directory, file),
    fs.readFileSync(file),
  ]));
}

function transactionPath(contentRoot) {
  if (path.resolve(contentRoot) === path.resolve(publicRoot)) {
    return path.join(projectRoot, ".sites-runtime", "static-content-transaction.json");
  }
  return path.join(path.dirname(contentRoot), `.${path.basename(contentRoot)}.static-content-transaction.json`);
}

function packedFingerprint(contentRoot) {
  const indexPath = contentPackIndexPath(contentRoot);
  return fs.existsSync(indexPath) ? digest(fs.readFileSync(indexPath)) : null;
}

function legacyFingerprint(contentRoot) {
  const hash = crypto.createHash("sha256");
  const files = legacyBrotliFiles(contentRoot);
  if (!files.length) return null;
  for (const file of files) {
    hash.update(relativePath(contentRoot, file));
    hash.update("\0");
    hash.update(digest(fs.readFileSync(file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sourceDescriptor(contentRoot) {
  const packed = packedFingerprint(contentRoot);
  if (packed) return { kind: "packed", fingerprint: packed };
  const legacy = legacyFingerprint(contentRoot);
  if (legacy) return { kind: "legacy", fingerprint: legacy };
  return null;
}

function readTransaction(contentRoot) {
  const marker = transactionPath(contentRoot);
  if (!fs.existsSync(marker)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (
      value?.v !== 1
      || (value.kind !== "packed" && value.kind !== "legacy")
      || !["ready", "running", "succeeded", "discarding", "cleanup"].includes(value.phase)
      || typeof value.fingerprint !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.fingerprint)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writeTransaction(contentRoot, descriptor, phase = "ready") {
  atomicWrite(transactionPath(contentRoot), Buffer.from(JSON.stringify({
    v: 1,
    ...descriptor,
    phase,
  }), "utf8"));
}

export function removeStaticContentTransaction(contentRoot = publicRoot) {
  fs.rmSync(transactionPath(contentRoot), { force: true });
}

function transactionMatches(
  contentRoot,
  descriptor = sourceDescriptor(contentRoot),
  phases = ["ready", "succeeded"],
) {
  const transaction = readTransaction(contentRoot);
  return Boolean(
    transaction
    && descriptor
    && transaction.kind === descriptor.kind
    && transaction.fingerprint === descriptor.fingerprint
    && phases.includes(transaction.phase)
  );
}

function updateTransactionPhase(contentRoot, phase) {
  const descriptor = sourceDescriptor(contentRoot);
  const transaction = readTransaction(contentRoot);
  if (
    !descriptor
    || !transaction
    || transaction.kind !== descriptor.kind
    || transaction.fingerprint !== descriptor.fingerprint
  ) {
    throw new Error("找不到可安全更新的文字資產交易");
  }
  writeTransaction(contentRoot, descriptor, phase);
}

export function markStaticContentTransactionRunning(contentRoot = publicRoot) {
  updateTransactionPhase(contentRoot, "running");
}

export function markStaticContentTransactionSucceeded(contentRoot = publicRoot) {
  updateTransactionPhase(contentRoot, "succeeded");
}

function pruneOrphanPackFiles(contentRoot, index = readContentPackIndex(contentRoot)) {
  if (!index) return 0;
  const packsRoot = path.join(contentPackDirectory(contentRoot), "packs");
  const expectedPacks = new Set(index.p.map(([name]) => name));
  let removed = 0;
  for (const file of walk(packsRoot, () => true)) {
    if (!expectedPacks.has(relativePath(packsRoot, file))) {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
  const digestsRoot = path.join(contentPackDirectory(contentRoot), "digests");
  const expectedDigests = new Set(index.d ? [index.d[0]] : []);
  for (const file of walk(digestsRoot, () => true)) {
    if (!expectedDigests.has(relativePath(digestsRoot, file))) {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
  return removed;
}

function prunePackTemporaryArtifacts(contentRoot) {
  const target = contentPackDirectory(contentRoot);
  if (fs.existsSync(target)) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (
        entry.isFile()
        && entry.name.startsWith(`${contentPackIndexName}.tmp-static-`)
      ) {
        fs.unlinkSync(path.join(target, entry.name));
      }
    }
  }
  for (const entry of fs.readdirSync(contentRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory()
      && entry.name.startsWith(`${contentPackDirectoryName}.tmp-static-`)
    ) {
      fs.rmSync(path.join(contentRoot, entry.name), { force: true, recursive: true });
    }
  }
}

function commitPackDirectory(staging, target, contentRoot) {
  const stagedIndexPath = path.join(staging, contentPackIndexName);
  const stagedIndexBytes = fs.readFileSync(stagedIndexPath);
  const stagedIndex = parsePackIndexBytes(stagedIndexBytes, contentPackIndexName);
  const targetPacks = path.join(target, "packs");
  fs.mkdirSync(targetPacks, { recursive: true });

  let installedPacks = 0;
  for (const [name, , sha256] of stagedIndex.p) {
    const source = path.join(staging, "packs", name);
    const destination = path.join(targetPacks, name);
    if (fs.existsSync(destination)) {
      if (!fs.readFileSync(destination).equals(fs.readFileSync(source))) {
        throw new Error(`內容位址分塊發生衝突：${name}`);
      }
    } else {
      fs.renameSync(source, destination);
      installedPacks += 1;
    }
    if (digest(fs.readFileSync(destination)) !== sha256) {
      throw new Error(`提交後的內容分塊摘要不符：${name}`);
    }
  }

  let installedDigests = 0;
  if (stagedIndex.d) {
    const [name, expectedBytes, expectedSha256] = stagedIndex.d;
    const source = path.join(staging, "digests", name);
    const targetDigests = path.join(target, "digests");
    const destination = path.join(targetDigests, name);
    fs.mkdirSync(targetDigests, { recursive: true });
    if (fs.existsSync(destination)) {
      if (!fs.readFileSync(destination).equals(fs.readFileSync(source))) {
        throw new Error(`內容位址摘要 sidecar 發生衝突：${name}`);
      }
    } else {
      fs.renameSync(source, destination);
      installedDigests += 1;
    }
    const committed = fs.readFileSync(destination);
    if (committed.length !== expectedBytes || digest(committed) !== expectedSha256) {
      throw new Error(`提交後的內容摘要 sidecar 驗證失敗：${name}`);
    }
  }

  const destinationIndex = contentPackIndexPath(contentRoot);
  const previousIndex = fs.existsSync(destinationIndex) ? fs.readFileSync(destinationIndex) : null;
  const indexChanged = !previousIndex?.equals(stagedIndexBytes);
  if (indexChanged) atomicWrite(destinationIndex, stagedIndexBytes);
  pruneOrphanPackFiles(contentRoot, stagedIndex);
  fs.rmSync(staging, { force: true, recursive: true });
  return {
    indexChanged,
    installedPacks,
    updatedFiles: installedPacks + installedDigests + (indexChanged ? 1 : 0),
  };
}

function assertQuestionRevisionMetadata(records, questionDataRevision) {
  if (!questionDataRevision) return;
  const byPath = new Map(records.map((record) => [record.logicalPath, record.bytes]));
  for (const logicalPath of ["data/startup-index.json", "data/index.json"]) {
    const bytes = byPath.get(logicalPath);
    if (!bytes) throw new Error(`題庫缺少版本化索引：${logicalPath}`);
    const payload = JSON.parse(bytes.toString("utf8"));
    if (payload.questionDataRevision !== questionDataRevision) {
      throw new Error(`題庫版本摘要與題目內容不符：${logicalPath}`);
    }
    if (
      !Array.isArray(payload.questions)
      || payload.questions.some((question) => (
        !question
        || typeof question !== "object"
        || Object.hasOwn(question, "contentHash")
      ))
    ) {
      throw new Error(`題庫索引不得逐列重複內容摘要：${logicalPath}`);
    }
  }
}

function buildPackDirectory(files, staging, contentRoot, targetBytes) {
  fs.mkdirSync(path.join(staging, "packs"), { recursive: true });
  const records = files.map((source) => ({
    logicalPath: relativePath(contentRoot, source),
    bytes: fs.readFileSync(source),
  })).sort((left, right) => binaryCompare(left.logicalPath, right.logicalPath));

  for (const record of records) {
    if (!managedLogicalPath(record.logicalPath)) throw new Error(`不支援的內容路徑：${record.logicalPath}`);
    if (record.bytes.length > contentPackMaxRawBytes) {
      throw new Error(`單一文字資產超過 32 MiB 安全上限：${record.logicalPath}`);
    }
    validateDecoded(record.logicalPath, record.bytes);
  }
  if (records.length > maxEntryCount) throw new Error(`文字資產數量超過 ${maxEntryCount} 筆安全上限`);
  const questionDataRevision = computeQuestionDataRevision(
    records.map(({ logicalPath, bytes }) => [logicalPath, bytes]),
  );
  assertQuestionRevisionMetadata(records, questionDataRevision);

  const packs = [];
  const entries = [];
  const entryDigests = [];
  let pending = [];
  let pendingBytes = 0;

  const flush = () => {
    if (!pending.length) return;
    const packNumber = packs.length;
    const raw = Buffer.concat(pending.map((record) => record.bytes), pendingBytes);
    const compressed = canonicalBrotli(raw);
    if (compressed.length > contentPackMaxCompressedBytes) {
      throw new Error(`內容分塊壓縮大小超過上限：${packNumber}`);
    }
    if (!brotliDecompressSync(compressed, { maxOutputLength: raw.length }).equals(raw)) {
      throw new Error(`內容分塊往返驗證失敗：${packNumber}`);
    }
    const sha256 = digest(compressed);
    const name = `${sha256}.brp`;
    atomicWrite(path.join(staging, "packs", name), compressed);
    packs.push([name, raw.length, sha256]);
    if (packs.length > maxPackCount) throw new Error(`內容分塊數量超過 ${maxPackCount} 個安全上限`);

    let offset = 0;
    for (const record of pending) {
      entries.push([
        record.logicalPath,
        packNumber,
        offset,
        record.bytes.length,
      ]);
      entryDigests.push(Buffer.from(digest(record.bytes), "hex"));
      offset += record.bytes.length;
    }
    pending = [];
    pendingBytes = 0;
  };

  for (const record of records) {
    if (
      singletonLogicalPath(record.logicalPath)
      || record.bytes.length > Math.min(targetBytes, contentPackSingletonBytes)
    ) {
      flush();
      pending.push(record);
      pendingBytes = record.bytes.length;
      flush();
      continue;
    }
    if (pending.length && pendingBytes + record.bytes.length > targetBytes) flush();
    pending.push(record);
    pendingBytes += record.bytes.length;
  }
  flush();

  const digestBytes = Buffer.concat(entryDigests);
  if (digestBytes.length !== entries.length * contentDigestBytes) {
    throw new Error("內容檔案摘要 sidecar 長度不符");
  }
  const digestSha256 = digest(digestBytes);
  const digestName = `${digestSha256}.bin`;
  fs.mkdirSync(path.join(staging, "digests"), { recursive: true });
  atomicWrite(path.join(staging, "digests", digestName), digestBytes);

  const index = Buffer.from(JSON.stringify({
    v: contentPackSchemaVersion,
    t: targetBytes,
    s: Math.min(targetBytes, contentPackSingletonBytes),
    p: packs,
    d: [digestName, digestBytes.length, digestSha256],
    ...(questionDataRevision ? { q: questionDataRevision } : {}),
    e: entries,
  }), "utf8");
  const compressedIndex = canonicalBrotli(index);
  parsePackIndexBytes(compressedIndex, contentPackIndexName);
  atomicWrite(path.join(staging, contentPackIndexName), compressedIndex);

  return {
    files: records.length,
    logicalBytes: records.reduce((total, record) => total + record.bytes.length, 0),
    packs: packs.length,
  };
}

function startupSingletonLayoutSatisfied(index) {
  return index.e.every(([logicalPath, packNumber, offset, length]) => (
    !singletonLogicalPath(logicalPath)
    || (offset === 0 && length === index.p[packNumber][1])
  ));
}

export function compressRawFiles({
  contentRoot = publicRoot,
  targetBytes = contentPackTargetBytes,
} = {}) {
  if (
    !Number.isSafeInteger(targetBytes)
    || targetBytes <= 0
    || targetBytes > contentPackMaxRawBytes
  ) {
    throw new Error("內容分塊大小必須是 1 至 32 MiB 之間的正整數");
  }

  prunePackTemporaryArtifacts(contentRoot);
  let files = rawFiles(contentRoot);
  const existingIndex = readContentPackIndex(contentRoot);
  let legacy = legacyBrotliFiles(contentRoot);
  if (existingIndex && legacy.length) {
    pruneOrphanPackFiles(contentRoot, existingIndex);
    const packedEntries = new Map(decodePackedEntries(contentRoot, existingIndex));
    const transaction = readTransaction(contentRoot);
    const currentPackedFingerprint = packedFingerprint(contentRoot);
    const currentLegacyFingerprint = legacyFingerprint(contentRoot);
    const recoveringPostCommit = Boolean(
      transaction
      && (
        (
          transaction.kind === "packed"
          && transaction.phase === "cleanup"
          && transaction.fingerprint === currentPackedFingerprint
        )
        || (
          transaction.kind === "legacy"
          && ["ready", "succeeded"].includes(transaction.phase)
          && transaction.fingerprint === currentLegacyFingerprint
        )
      ),
    );
    const allLegacyIsRedundant = decodeLegacyEntries(contentRoot).every(([logicalPath, bytes]) => (
      packedEntries.get(logicalPath)?.equals(bytes) ?? false
    ));
    if (!allLegacyIsRedundant) {
      throw new Error(
        "索引式內容與殘留的舊 Brotli 內容不一致；為避免刪除額外或較新的資料，已停止清理",
      );
    }
    for (const file of legacy) fs.unlinkSync(file);
    if (recoveringPostCommit) {
      removeStaticContentTransaction(contentRoot);
      removeManagedRawFiles(contentRoot);
      files = rawFiles(contentRoot);
    }
    legacy = [];
  }
  if (existingIndex) pruneOrphanPackFiles(contentRoot, existingIndex);
  const descriptor = sourceDescriptor(contentRoot);
  const hasCompressedRemnants = fs.existsSync(contentPackDirectory(contentRoot))
    && walk(contentPackDirectory(contentRoot), () => true).length > 0;
  if (
    files.length
    && !descriptor
    && (fs.existsSync(transactionPath(contentRoot)) || hasCompressedRemnants)
  ) {
    throw new Error(
      "壓縮來源索引遺失或損壞，且仍有交易或分塊殘留；為避免只提交部分題庫，已停止壓縮",
    );
  }

  if (descriptor && transactionMatches(contentRoot, descriptor, ["running", "discarding"])) {
    discardExpandedStaticContent(contentRoot);
    files = rawFiles(contentRoot);
  }

  if (files.length && descriptor && !transactionMatches(contentRoot, descriptor)) {
    const baseline = new Map(logicalContentEntries(contentRoot));
    const rawIsUnchangedSubset = files.every((file) => {
      const logicalPath = relativePath(contentRoot, file);
      const expected = baseline.get(logicalPath);
      return expected?.equals(fs.readFileSync(file)) ?? false;
    });
    if (!rawIsUnchangedSubset) {
      throw new Error(
        "偵測到未受交易標記保護的部分文字變更；為避免遺失其他題庫內容，已保留檔案並停止壓縮",
      );
    }
    removeManagedRawFiles(contentRoot);
    expandCompressedFiles(contentRoot);
    files = rawFiles(contentRoot);
  }
  if (!files.length && descriptor && transactionMatches(contentRoot, descriptor)) {
    throw new Error("交易中的全部文字資產均被刪除；為避免誤清空題庫，已保留原壓縮內容並停止壓縮");
  }

  if (!files.length && existingIndex) {
    if (
      existingIndex.v === contentPackSchemaVersion
      && existingIndex.t === targetBytes
      && existingIndex.s === Math.min(targetBytes, contentPackSingletonBytes)
      && startupSingletonLayoutSatisfied(existingIndex)
    ) {
      removeStaticContentTransaction(contentRoot);
      const audited = auditCompressedRoot(contentRoot);
      return {
        ...audited,
        packs: existingIndex.p.length,
        updatedFiles: 0,
        reusedFiles: audited.files,
      };
    }
    expandCompressedFiles(contentRoot);
    files = rawFiles(contentRoot);
  }

  if (!files.length && legacy.length) {
    expandCompressedFiles(contentRoot);
    files = rawFiles(contentRoot);
  }

  if (!files.length) throw new Error(`找不到可壓縮的文字資產：${contentRoot}`);
  if (!descriptor) removeStaticContentTransaction(contentRoot);

  const target = contentPackDirectory(contentRoot);
  const staging = `${target}.tmp-static-${process.pid}`;
  fs.rmSync(staging, { force: true, recursive: true });

  let built;
  let committed;
  try {
    built = buildPackDirectory(files, staging, contentRoot, targetBytes);
    committed = commitPackDirectory(staging, target, contentRoot);
    const committedLegacy = legacyBrotliFiles(contentRoot);
    if (committedLegacy.length) {
      const committedDescriptor = sourceDescriptor(contentRoot);
      if (!committedDescriptor || committedDescriptor.kind !== "packed") {
        throw new Error("內容分塊提交後無法建立清理交易");
      }
      writeTransaction(contentRoot, committedDescriptor, "cleanup");
      for (const file of committedLegacy) fs.unlinkSync(file);
    }
    removeStaticContentTransaction(contentRoot);
    removeManagedRawFiles(contentRoot);
  } catch (error) {
    fs.rmSync(staging, { force: true, recursive: true });
    throw error;
  }

  const audited = auditCompressedRoot(contentRoot);
  return {
    ...audited,
    packs: built.packs,
    updatedFiles: committed.updatedFiles,
    reusedFiles: committed.updatedFiles ? 0 : built.files,
  };
}

export function expandCompressedFiles(contentRoot = publicRoot) {
  const existingRaw = rawFiles(contentRoot);
  if (existingRaw.length) {
    throw new Error(`展開前已有未壓縮文字資產：${relativePath(contentRoot, existingRaw[0])}`);
  }
  const descriptor = sourceDescriptor(contentRoot);
  if (!descriptor) throw new Error(`找不到可展開的壓縮來源：${contentRoot}`);
  const entries = logicalContentEntries(contentRoot);
  if (!entries.length) throw new Error(`找不到可展開的文字資產：${contentRoot}`);
  removeStaticContentTransaction(contentRoot);
  for (const [logicalPath, bytes] of entries) {
    atomicWrite(path.join(contentRoot, logicalPath), bytes);
  }
  writeTransaction(contentRoot, descriptor);
  return entries.map(([logicalPath]) => path.join(contentRoot, logicalPath));
}

export function removeManagedRawFiles(contentRoot = publicRoot) {
  for (const file of rawFiles(contentRoot)) fs.unlinkSync(file);
}

export function discardExpandedStaticContent(contentRoot = publicRoot) {
  const descriptor = sourceDescriptor(contentRoot);
  if (descriptor) writeTransaction(contentRoot, descriptor, "discarding");
  else removeStaticContentTransaction(contentRoot);
  removeManagedRawFiles(contentRoot);
  removeStaticContentTransaction(contentRoot);
}

export function preserveFailedExpandedStaticContent(contentRoot = publicRoot) {
  const files = rawFiles(contentRoot);
  const descriptor = sourceDescriptor(contentRoot);
  const transaction = readTransaction(contentRoot);
  const recoverableEmptyTransaction = Boolean(
    !files.length
    && descriptor
    && transaction
    && transaction.kind === descriptor.kind
    && transaction.fingerprint === descriptor.fingerprint
    && ["ready", "succeeded"].includes(transaction.phase)
  );
  if (!files.length && !recoverableEmptyTransaction) return null;
  const suffix = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${process.pid}`;
  const recoveryRoot = path.resolve(contentRoot) === path.resolve(publicRoot)
    ? path.join(projectRoot, ".sites-runtime", "static-content-recovery", suffix)
    : `${contentRoot}.static-content-recovery-${suffix}`;
  for (const file of files) {
    const destination = path.join(recoveryRoot, relativePath(contentRoot, file));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    if (!fs.readFileSync(destination).equals(fs.readFileSync(file))) {
      throw new Error(`失敗內容備份驗證不符：${relativePath(contentRoot, file)}`);
    }
  }
  atomicWrite(path.join(recoveryRoot, "recovery.json"), Buffer.from(JSON.stringify({
    v: 1,
    createdAt: new Date().toISOString(),
    files: files.length,
    transaction,
  }, null, 2), "utf8"));
  discardExpandedStaticContent(contentRoot);
  return recoveryRoot;
}

function packedStoredBytes(contentRoot) {
  return walk(contentPackDirectory(contentRoot), () => true)
    .reduce((total, file) => total + fs.statSync(file).size, 0);
}

function comparePackedDirectories(contentRoot, compareRoot) {
  const actual = directoryBytes(contentPackDirectory(contentRoot));
  const expected = directoryBytes(contentPackDirectory(compareRoot));
  if (!actual || !expected || actual.size !== expected.size) {
    throw new Error(`建置內容分塊數量不符：${actual?.size ?? 0}，來源為 ${expected?.size ?? 0}`);
  }
  for (const [relative, bytes] of expected) {
    const candidate = actual.get(relative);
    if (!candidate?.equals(bytes)) throw new Error(`建置內容分塊與來源不符：${relative}`);
  }
}

export function auditCompressedRoot(contentRoot = publicRoot, compareRoot = null) {
  const uncompressed = rawFiles(contentRoot);
  if (uncompressed.length) {
    throw new Error(`發現 ${uncompressed.length} 個未壓縮 runtime 文字檔，第一個是 ${relativePath(contentRoot, uncompressed[0])}`);
  }

  const legacyGzip = legacyGzipFiles(contentRoot);
  if (legacyGzip.length) {
    throw new Error(`發現 ${legacyGzip.length} 個舊 gzip 資產，第一個是 ${relativePath(contentRoot, legacyGzip[0])}`);
  }

  const legacyBrotli = legacyBrotliFiles(contentRoot);
  if (legacyBrotli.length) {
    throw new Error(`發現 ${legacyBrotli.length} 個舊逐檔 Brotli 資產，第一個是 ${relativePath(contentRoot, legacyBrotli[0])}`);
  }

  const index = readContentPackIndex(contentRoot);
  if (!index) throw new Error(`找不到內容分塊索引：${contentRoot}`);
  const entries = decodePackedEntries(contentRoot, index);
  const logicalBytes = entries.reduce((total, [, bytes]) => total + bytes.length, 0);
  const storedBytes = packedStoredBytes(contentRoot);

  if (compareRoot) {
    const comparison = auditCompressedRoot(compareRoot);
    if (comparison.files !== entries.length || comparison.logicalBytes !== logicalBytes) {
      throw new Error(`建置邏輯內容不符：${entries.length}，來源為 ${comparison.files}`);
    }
    comparePackedDirectories(contentRoot, compareRoot);
  }

  return {
    files: entries.length,
    packs: index.p.length,
    logicalBytes,
    storedBytes,
  };
}

export function withStaticContentLock(callback) {
  if (process.env.STATIC_CONTENT_LOCK_HELD === "1") return callback();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (process.platform === "win32") {
    const deadline = Date.now() + 120_000;
    let handle = null;
    while (handle === null) {
      try {
        handle = fs.openSync(lockPath, "wx");
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
          process.kill(Number(owner.pid), 0);
        } catch {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          process.exitCode = 75;
          console.error("Another static-content task still holds the build lock after 120 seconds.");
          return undefined;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }
    }

    try {
      return callback();
    } finally {
      fs.closeSync(handle);
      fs.rmSync(lockPath, { force: true });
    }
  }

  const child = spawnSync("flock", [
    "--exclusive",
    "--wait",
    "120",
    "--conflict-exit-code",
    "75",
    lockPath,
    process.execPath,
    ...process.execArgv,
    ...process.argv.slice(1),
  ], {
    stdio: "inherit",
    env: { ...process.env, STATIC_CONTENT_LOCK_HELD: "1" },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    process.exitCode = child.status ?? 1;
    if (child.status === 75) {
      console.error("另一個 build、test 或 import 已持有文字資產超過 120 秒。");
    }
  }
  return undefined;
}

export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
