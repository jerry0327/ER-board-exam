import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManagedAudioState,
  validateManagedAudioMarker,
} from "./lib/managed-audio-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const runtimeRoot = resolve(publicRoot, "static-snac");
const audioRoot = resolve(publicRoot, "audio/snac");
const managedAudioNamespace = "managed-audio/v1/";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, ""));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const markerPath = resolve(audioRoot, "r2-migration-complete.json");
let exactR2MarkerVerified = false;
if (await exists(markerPath)) {
  const [marker, hosting, managedState] = await Promise.all([
    readJson(markerPath),
    readJson(resolve(root, ".openai/hosting.json")),
    loadManagedAudioState(root),
  ]);
  validateManagedAudioMarker(marker, {
    state: managedState,
    projectId: hosting.project_id,
  });
  exactR2MarkerVerified = true;
}

const compressionManifest = await readJson(
  resolve(runtimeRoot, "compression-manifest.json"),
);

const audioCompressionManifest = await readJson(
  resolve(audioRoot, "compression-manifest.json"),
);
invariant(
  audioCompressionManifest.schema === "snac-audio-compression-v3",
  "Unexpected SNAC audio compression manifest",
);
invariant(
  audioCompressionManifest.algorithm === "brotli" && audioCompressionManifest.quality === 11,
  "SNAC audio must use Brotli quality 11",
);
const compressedAudioAssets = new Map(
  audioCompressionManifest.assets.map((asset) => [asset.logicalPath, asset]),
);
invariant(
  audioCompressionManifest.delivery === "r2-primary-static-fallback"
    && audioCompressionManifest.releaseScoped === true
    && audioCompressionManifest.assets.every(
      (asset) => asset.r2Key === `${managedAudioNamespace}${asset.logicalPath.slice(1)}.brp`,
    ),
  "SNAC R2 upload keys are missing or invalid",
);

async function readCompressedAudioLogical(logicalPath) {
  const asset = compressedAudioAssets.get(logicalPath);
  invariant(asset, `Compressed SNAC asset is missing: ${logicalPath}`);
  const storedPath = resolve(publicRoot, asset.storedPath.slice(1));
  if (!await exists(storedPath)) {
    invariant(exactR2MarkerVerified, `Unverified remote-only SNAC asset: ${logicalPath}`);
    invariant(!(await exists(resolve(publicRoot, logicalPath.slice(1)))), `Uncompressed SNAC duplicate remains: ${logicalPath}`);
    return null;
  }
  const stored = await readFile(storedPath);
  invariant(stored.byteLength === asset.storedBytes, `Stored SNAC size mismatch: ${logicalPath}`);
  invariant(sha256(stored) === asset.storedSha256, `Stored SNAC hash mismatch: ${logicalPath}`);
  invariant(!(await exists(resolve(publicRoot, logicalPath.slice(1)))), `Uncompressed SNAC duplicate remains: ${logicalPath}`);
  const raw = brotliDecompressSync(stored, { maxOutputLength: asset.rawBytes });
  invariant(raw.byteLength === asset.rawBytes, `Raw SNAC size mismatch: ${logicalPath}`);
  invariant(sha256(raw) === asset.rawSha256, `Raw SNAC hash mismatch: ${logicalPath}`);
  return raw;
}

const audioCatalogBytes = await readCompressedAudioLogical("/audio/snac/catalog.json");
invariant(audioCatalogBytes, "The managed audio catalog must remain available as a local audit fixture");
const audioCatalog = JSON.parse(audioCatalogBytes.toString("utf8"));
invariant(
  audioCatalog.schema === "em-board-audio-catalog-v2"
    && /^[a-f0-9]{20}$/u.test(audioCatalog.catalogRevision)
    && Array.isArray(audioCatalog.entries)
    && audioCatalog.entries.length > 0,
  "Audio catalog is missing or invalid",
);
invariant(
  sha256(Buffer.from(JSON.stringify(audioCatalog.entries))).slice(0, 20)
    === audioCatalog.catalogRevision,
  "Audio catalog revision does not match its entries",
);
const importConfigPath = resolve(root, "scripts/snac-library.config.json");
const importConfig = await readJson(importConfigPath);
for (const collection of importConfig.collections) {
  const collectionEntries = audioCatalog.entries.filter((entry) => entry.collectionId === collection.id);
  invariant(
    collectionEntries.length === collection.expectedItems,
    `${collection.id}: catalog count does not match expectedItems`,
  );
  invariant(
    collectionEntries.every(
      (entry) => entry.kind === collection.kind && entry.textbook === collection.textbook,
    ),
    `${collection.id}: stable learning-resource identity is inconsistent`,
  );
  invariant(
    collectionEntries.every((entry) => entry.collectionTitle === collection.title),
    `${collection.id}: catalog collection title does not match its configured display title`,
  );
  if (collection.libraryId) {
    invariant(
      collectionEntries.every(
        (entry) => entry.libraryId === collection.libraryId
          && entry.libraryTitle === (collection.libraryTitle || collection.title),
      ),
      `${collection.id}: catalog library title does not match its configured display title`,
    );
  }
  if (collection.canonicalTitleCatalog) {
    const titleCatalog = await readJson(resolve(
      dirname(importConfigPath),
      collection.canonicalTitleCatalog,
    ));
    const titleByChapterId = new Map(
      titleCatalog.chapters.map((chapter) => [chapter.id, chapter.title]),
    );
    invariant(
      titleCatalog.schema === collection.canonicalTitleCatalogSchema
        && titleCatalog.chapterCount === collection.expectedItems
        && collectionEntries.every(
          (entry) => entry.title === titleByChapterId.get(entry.chapterId),
        ),
      `${collection.id}: catalog chapter titles do not match the canonical title catalog`,
    );
  }
  if (collection.itemTitles) {
    invariant(
      collectionEntries.every(
        (entry) => collection.itemTitles[entry.chapterId] === undefined
          || entry.title === collection.itemTitles[entry.chapterId],
      ),
      `${collection.id}: catalog item title does not match its configured display title`,
    );
  }
}
const stableResourceKeys = new Set();
for (const entry of audioCatalog.entries) {
  const stableResourceKey = entry.kind === "question-set"
    ? `question:${entry.questionExam}:${entry.questionStart}:${entry.questionEnd}`
    : `${entry.kind}:${entry.textbook}:${entry.sectionId ?? entry.chapterId}`;
  invariant(!stableResourceKeys.has(stableResourceKey), `Duplicate stable audio locator: ${stableResourceKey}`);
  stableResourceKeys.add(stableResourceKey);
  if (entry.kind === "question-set") {
    invariant(
      /^\d{3}[AB]?$/u.test(entry.questionExam)
        && Number.isInteger(entry.questionStart)
        && Number.isInteger(entry.questionEnd)
        && entry.questionStart > 0
        && entry.questionEnd >= entry.questionStart,
      `Invalid question audio locator: ${entry.id}`,
    );
  } else {
    invariant(
      /^[a-z0-9][a-z0-9_-]*$/u.test(entry.textbook)
        && typeof entry.chapterId === "string"
        && entry.chapterId.length > 0,
      `Invalid learning audio locator: ${entry.id}`,
    );
  }
}
const catalogEntryByFile = new Map(audioCatalog.entries.map((entry) => [entry.file, entry]));
const expectedChapters = new Set(catalogEntryByFile.keys());
invariant(
  compressionManifest.schema === "audio-runtime-compression-v1",
  "Unexpected audio runtime compression manifest",
);
invariant(
  compressionManifest.algorithm === "brotli" && compressionManifest.quality === 11,
  "Audio runtime must use Brotli quality 11",
);
invariant(
  compressionManifest.assets.length === 8,
  "Audio runtime must contain one WASM core and seven model parts",
);
invariant(
  compressionManifest.assets.every(
    (asset) => asset.r2Key === `${managedAudioNamespace}${asset.logicalPath.slice(1)}.brp`,
  ),
  "Audio runtime R2 upload keys are missing or invalid",
);

const compressedAssets = new Map(
  compressionManifest.assets.map((asset) => [asset.logicalPath, asset]),
);
async function readCompressedLogical(logicalPath) {
  const asset = compressedAssets.get(logicalPath);
  invariant(asset, `Compressed runtime asset is missing: ${logicalPath}`);
  const storedPath = resolve(publicRoot, asset.storedPath.slice(1));
  const stored = await readFile(storedPath);
  invariant(stored.byteLength === asset.storedBytes, `Stored size mismatch: ${logicalPath}`);
  invariant(sha256(stored) === asset.storedSha256, `Stored hash mismatch: ${logicalPath}`);
  invariant(
    !(await exists(resolve(publicRoot, logicalPath.slice(1)))),
    `Uncompressed runtime duplicate remains: ${logicalPath}`,
  );
  const raw = brotliDecompressSync(stored, {
    maxOutputLength: asset.rawBytes,
  });
  invariant(raw.byteLength === asset.rawBytes, `Raw size mismatch: ${logicalPath}`);
  invariant(sha256(raw) === asset.rawSha256, `Raw hash mismatch: ${logicalPath}`);
  return raw;
}

const modelManifest = await readJson(resolve(runtimeRoot, "model-manifest.json"));
invariant(modelManifest.format === "split-onnx-v1", "Unexpected model manifest format");
invariant(modelManifest.totalBytes === 52_719_137, "Unexpected decoder model size");
invariant(modelManifest.parts.length === 7, "The decoder model must have seven parts");

let modelOffset = 0;
const modelHash = createHash("sha256");
for (const part of modelManifest.parts) {
  invariant(part.offset === modelOffset, `Model part offset mismatch: ${part.url}`);
  const relativePath = new URL(part.url, "https://local.invalid").pathname
    .replace(/^\/static-snac\//u, "");
  const bytes = await readCompressedLogical(`/static-snac/${relativePath}`);
  invariant(bytes.byteLength === part.bytes, `Model part size mismatch: ${part.url}`);
  modelHash.update(bytes);
  modelOffset += bytes.byteLength;
}
invariant(modelOffset === modelManifest.totalBytes, "Decoder model byte total mismatch");
invariant(modelHash.digest("hex") === modelManifest.sha256, "Decoder model hash mismatch");

for (const [file, minimumBytes] of [
  ["decoder-worker.js", 4_000],
  ["snac-output.worklet.js", 4_000],
  ["ort.webgpu.min.mjs", 40_000],
  ["ort-wasm-simd-threaded.asyncify.mjs", 30_000],
]) {
  const details = await stat(resolve(runtimeRoot, file));
  invariant(details.size >= minimumBytes, `Missing or truncated runtime file: ${file}`);
}
const wasm = await readCompressedLogical(
  "/static-snac/ort-wasm-simd-threaded.asyncify.wasm",
);
invariant(wasm.byteLength >= 20_000_000, "Missing or truncated WASM runtime");
invariant(
  compressionManifest.rawBytes
    === compressionManifest.assets.reduce((sum, asset) => sum + asset.rawBytes, 0),
  "Compressed runtime raw byte total mismatch",
);
invariant(
  compressionManifest.storedBytes
    === compressionManifest.assets.reduce((sum, asset) => sum + asset.storedBytes, 0),
  "Compressed runtime stored byte total mismatch",
);
invariant(
  compressionManifest.ratio < 0.7,
  "Compressed runtime no longer saves the expected deployment size",
);

const workerSource = await readFile(resolve(runtimeRoot, "decoder-worker.js"), "utf8");
const ortRuntimeRevision = sha256(
  await readFile(resolve(runtimeRoot, "ort.webgpu.min.mjs")),
).slice(0, 12);
const modelManifestRevision = sha256(
  await readFile(resolve(runtimeRoot, "model-manifest.json")),
).slice(0, 12);
invariant(
  workerSource.includes(`import * as ort from "./ort.webgpu.min.mjs?v=${ortRuntimeRevision}"`),
  "Worker must use the revisioned local runtime",
);
invariant(
  workerSource.includes(`./model-manifest.json?v=${modelManifestRevision}`),
  "Worker must use the revisioned model manifest",
);
invariant(
  workerSource.includes("new URL(path, import.meta.url)")
    && workerSource.includes("/audio/snac/"),
  "Worker must resolve chapter URLs from the site origin",
);
invariant(workerSource.includes('event.data.kind === "warm"'), "Worker must support silent background preparation");
invariant(workerSource.includes('name: "webgpu"'), "Worker must prefer the validated WebGPU path");
invariant(workerSource.includes('executionProviders: ["wasm"]'), "Worker must retain the compatible local fallback");
invariant(workerSource.includes("let sessionPromise = null"), "Worker must share one decoder session");
invariant(workerSource.includes("activeLoadController?.abort()"), "Worker must cancel stale chapter downloads");
invariant(workerSource.includes('crypto.subtle.digest("SHA-256"'), "Worker must verify chapter payload integrity");
invariant(!workerSource.includes("/codecs/snac/v1"), "Worker still references the retired runtime");

const workletSource = await readFile(resolve(runtimeRoot, "snac-output.worklet.js"), "utf8");
invariant(workletSource.includes("class SnacRingOutput"), "AudioWorklet ring output is missing");
invariant(workletSource.includes("bestCandidate(expected)"), "Pitch-preserving time stretch is missing");
invariant(workletSource.includes("Math.min(2, Math.max(0.75"), "Playback-rate limits are missing");
invariant(workletSource.includes('registerProcessor("snac-ring-output"'), "AudioWorklet registration is missing");

const manifestFiles = audioCompressionManifest.assets
  .map((asset) => asset.logicalPath.replace(/^\/audio\/snac\//u, ""))
  .filter((file) => file.endsWith(".snac.json"));
invariant(
  manifestFiles.length === expectedChapters.size,
  "Audio chapter manifests must match the catalog",
);

let audioBytes = 0;
for (const manifestFile of manifestFiles) {
  const chapterName = manifestFile.slice(0, -".snac.json".length);
  invariant(expectedChapters.delete(chapterName), `Unexpected chapter asset: ${chapterName}`);
  const manifestBytes = await readCompressedAudioLogical(`/audio/snac/${manifestFile}`);
  const data = await readCompressedAudioLogical(`/audio/snac/${chapterName}.snac`);
  const catalogEntry = catalogEntryByFile.get(chapterName);
  if (!manifestBytes || !data) {
    const manifestAsset = compressedAudioAssets.get(`/audio/snac/${manifestFile}`);
    const dataAsset = compressedAudioAssets.get(`/audio/snac/${chapterName}.snac`);
    invariant(exactR2MarkerVerified && manifestAsset && dataAsset, `Remote-only chapter is not verified: ${chapterName}`);
    invariant(
      catalogEntry?.revision === chapterName.split("/").at(-2)
        && catalogEntry.dataBytes === dataAsset.rawBytes
        && catalogEntry.dataSha256 === dataAsset.rawSha256
        && catalogEntry.metadataBytes === manifestAsset.rawBytes
        && catalogEntry.metadataSha256 === manifestAsset.rawSha256
        && catalogEntry.revision
          === sha256(Buffer.from(`${dataAsset.rawSha256}:${manifestAsset.rawSha256}`)).slice(0, 20),
      `Remote catalog revision mismatch: ${chapterName}`,
    );
    audioBytes += dataAsset.rawBytes;
    continue;
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));

  invariant(manifest.schema === "snac-chapter-v1", `Invalid schema: ${chapterName}`);
  invariant(manifest.codec === "snac-24khz", `Invalid codec: ${chapterName}`);
  invariant(manifest.packetFormat === "SNC1", `Invalid packet format: ${chapterName}`);
  invariant(manifest.sampleRate === 24_000 && manifest.channels === 1, `Invalid audio layout: ${chapterName}`);
  invariant(manifest.tokenBits === 12 && manifest.codebookCount === 3, `Invalid token layout: ${chapterName}`);
  invariant(manifest.speed === 1.4 && manifest.speedMethod === "ffmpeg-atempo", `Invalid source speed: ${chapterName}`);
  invariant(manifest.dataBytes === data.byteLength, `Data size mismatch: ${chapterName}`);
  invariant(manifest.dataSha256 === sha256(data), `Data hash mismatch: ${chapterName}`);
  invariant(
    catalogEntry?.revision === chapterName.split("/").at(-2)
      && catalogEntry.dataBytes === data.byteLength
      && catalogEntry.dataSha256 === sha256(data)
      && catalogEntry.metadataBytes === manifestBytes.byteLength
      && catalogEntry.metadataSha256 === sha256(manifestBytes)
      && catalogEntry.revision
        === sha256(Buffer.from(`${manifest.dataSha256}:${sha256(manifestBytes)}`)).slice(0, 20),
    `Catalog revision mismatch: ${chapterName}`,
  );
  invariant(manifest.packetCount === manifest.packets.length, `Packet count mismatch: ${chapterName}`);
  invariant(manifest.playbackDurationSeconds > 300, `Implausible duration: ${chapterName}`);
  invariant(
    Math.abs(
      manifest.sourceDurationSeconds / manifest.playbackDurationSeconds
      - manifest.speed
    ) < 0.01,
    `Source/playback duration ratio mismatch: ${chapterName}`,
  );
  invariant(manifest.effectiveDataBitrateKbps < 1.1, `Unexpected bitrate: ${chapterName}`);

  let expectedOffset = 0;
  for (const packet of manifest.packets) {
    const [offset, length, contentSamples, packetSamples, trimStart, trimEnd] = packet;
    invariant(offset === expectedOffset, `Packet offset mismatch: ${chapterName}`);
    invariant(length > 25 && offset + length <= data.byteLength, `Packet bounds mismatch: ${chapterName}`);
    invariant(contentSamples > 0 && packetSamples >= contentSamples, `Packet sample count mismatch: ${chapterName}`);
    invariant(trimStart >= 0 && trimEnd >= 0, `Packet trim mismatch: ${chapterName}`);
    invariant(data.subarray(offset, offset + 4).toString("ascii") === "SNC1", `Packet magic mismatch: ${chapterName}`);
    expectedOffset += length;
  }
  invariant(expectedOffset === data.byteLength, `Packet coverage mismatch: ${chapterName}`);
  audioBytes += data.byteLength;
}
invariant(expectedChapters.size === 0, `Missing chapter assets: ${[...expectedChapters].join(", ")}`);
invariant(
  audioCompressionManifest.rawBytes
    === audioCompressionManifest.assets.reduce((sum, asset) => sum + asset.rawBytes, 0),
  "Compressed SNAC raw byte total mismatch",
);
invariant(
  audioCompressionManifest.storedBytes
    === audioCompressionManifest.assets.reduce((sum, asset) => sum + asset.storedBytes, 0),
  "Compressed SNAC stored byte total mismatch",
);

const headers = await readFile(resolve(root, "public/_headers"), "utf8");
invariant(
  !headers.includes("/static-snac/*")
    && headers.includes("/static-snac/compression-manifest.json")
    && headers.includes("/static-snac/model-manifest.json"),
  "Static runtime cache policy is missing or overlaps a mutable entry point",
);
invariant(
  !headers.includes("/audio/snac/*")
    && headers.includes("/audio/snac/compression-manifest.json")
    && headers.includes("/audio/snac/r2-migration-complete.json")
    && headers.includes("/audio/snac/catalog.json"),
  "Chapter audio cache policy is missing or overlaps a mutable entry point",
);
invariant(!headers.includes("/codecs/snac/v1"), "Retired runtime cache policy is still present");

const serverSource = await readFile(resolve(root, "worker/index.ts"), "utf8");
invariant(
  serverSource.includes("serveManagedAudio")
    && serverSource.includes("serveManagedAssetFromStatic")
    && serverSource.includes("serveManagedAssetFromR2")
    && serverSource.includes("readValidatedR2Object")
    && serverSource.includes("MANAGED_AUDIO_OPERATOR_TOKEN")
    && !serverSource.includes("__asset_source")
    && serverSource.includes('headers.set("content-encoding", "br")')
    && serverSource.includes('encodeBody: "manual"'),
  "Brotli audio runtime delivery is missing",
);

const providerSource = await readFile(resolve(root, "app/components/audio-player-provider.tsx"), "utf8");
const learningAudioHookSource = await readFile(resolve(root, "app/hooks/use-learning-audio.ts"), "utf8");
const learningAudioCatalogSource = await readFile(resolve(root, "app/lib/audio-summaries.ts"), "utf8");
const tintinalliReaderSource = await readFile(resolve(root, "app/views/guide-view.tsx"), "utf8");
const questionReaderSource = await readFile(resolve(root, "app/views/reader-view.tsx"), "utf8");
const workerRevision = sha256(Buffer.from(workerSource)).slice(0, 12);
const workletRevision = sha256(Buffer.from(workletSource)).slice(0, 12);
invariant(providerSource.includes("navigator.mediaSession"), "System playback controls are missing");
invariant(providerSource.includes("const preparePlayer = useCallback"), "On-demand preparation is missing");
invariant(providerSource.includes("const prepareShell = useCallback"), "Audio runtime shell warmup is missing");
invariant(providerSource.includes("const prefetchAudioSource = useCallback"), "Chapter source prefetch is missing");
invariant(providerSource.includes("decoderWarmRequestedRef.current = false"), "Decoder warmup retry reset is missing");
invariant(
  providerSource.includes("function shouldSpeculativelyWarmAudio()")
    && providerSource.includes('["slow-2g", "2g"]')
    && providerSource.includes("memory >= 4"),
  "Speculative decoder warmup must avoid constrained mobile devices",
);
invariant(
  workerSource.includes("const concurrency = constrained ? 1 : Math.min(2, manifest.parts.length)")
    && workerSource.includes("Promise.all(Array.from({ length: concurrency }, fetchNextPart))"),
  "Decoder model parts must use bounded adaptive concurrency",
);
invariant(
  providerSource.includes(`/static-snac/decoder-worker.js?v=\${DECODER_WORKER_REVISION}`)
    && providerSource.includes(`const DECODER_WORKER_REVISION = "${workerRevision}"`)
    && providerSource.includes(`/static-snac/snac-output.worklet.js?v=\${OUTPUT_WORKLET_REVISION}`)
    && providerSource.includes(`const OUTPUT_WORKLET_REVISION = "${workletRevision}"`)
    && providerSource.includes(`/static-snac/ort.webgpu.min.mjs?v=${ortRuntimeRevision}`)
    && providerSource.includes(`/static-snac/model-manifest.json?v=${modelManifestRevision}`),
  "Audio shell preload revisions do not match the decoder runtime",
);
invariant(
  providerSource.includes('type AudioSleepTimer = 15 | 30 | 45 | 60 | "chapter-end" | null'),
  "End-of-chapter sleep control is missing",
);
invariant(!providerSource.includes("requestIdleCallback"), "Decoder must not warm on unrelated pages");
invariant(providerSource.includes("connection?.saveData"), "Save-data preference is not respected");
invariant(providerSource.includes("PLAYER_STORAGE_KEY"), "Paused-state restoration is missing");
invariant(providerSource.includes("generationRef.current"), "Seek generation protection is missing");
invariant(providerSource.includes("dataSha256: source.dataSha256"), "Player must send chapter integrity metadata");
invariant(
  learningAudioHookSource.includes("audioSummaryForLearningResource(resource)")
    && learningAudioHookSource.includes("if (!contentReady || !source) return")
    && learningAudioHookSource.includes("prepareDecoder();")
    && learningAudioHookSource.includes("if (!primeSource(source)) prefetchSource(source);")
    && !learningAudioHookSource.includes("requestIdleCallback"),
  "Learning readers must share the stable-ID audio attachment and wait for explicit playback intent",
);
invariant(
  learningAudioCatalogSource.includes("type LearningAudioLocator")
    && learningAudioCatalogSource.includes("audioSummaryForLearningResource"),
  "The stable learning-audio locator contract is missing",
);
invariant(
  tintinalliReaderSource.includes('resource: { kind: "textbook-chapter", textbookId: "tintinalli", chapterId: selectedId }')
    && tintinalliReaderSource.includes("audioAction={selectedAudio ? ("),
  "Tintinalli chapter audio is no longer attached to its shared reader",
);
invariant(
  questionReaderSource.includes('resource: question ? { kind: "question", questionId: question.id } : null')
    && questionReaderSource.includes('{questionAudio && <button type="button" className="reading-toolbar-audio"')
    && questionReaderSource.includes('<small>本題組音檔</small>'),
  "Question explanation audio is no longer attached to its shared reader",
);
invariant(
  providerSource.includes("const AUDIO_PRIME_SECONDS = 3.4")
    && providerSource.includes("function shouldPredecodeAudio()")
    && providerSource.includes("scheduleDecoderRetentionRelease()"),
  "Adaptive bounded predecode or idle decoder retention is missing",
);

console.log(
  `Validated one ${modelManifest.totalBytes}-byte decoder inside a `
  + `${compressionManifest.storedBytes}-byte Brotli runtime and ${manifestFiles.length} chapters `
  + `(${audioBytes} SNAC data bytes).`,
);
