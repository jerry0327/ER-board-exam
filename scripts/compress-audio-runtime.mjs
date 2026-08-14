import { createHash } from "node:crypto";
import {
  access,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  brotliCompress,
  brotliDecompressSync,
  constants,
} from "node:zlib";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const runtimeRoot = resolve(publicRoot, "static-snac");
const compressionManifestPath = resolve(runtimeRoot, "compression-manifest.json");
const brotliQuality = 11;
const compressBrotli = promisify(brotliCompress);
const managedAudioNamespace = "managed-audio/v1/";

const logicalAssets = [
  {
    path: "/static-snac/ort-wasm-simd-threaded.asyncify.wasm",
    contentType: "application/wasm",
  },
  ...Array.from({ length: 7 }, (_, index) => ({
    path: `/static-snac/model/snac24-static.part${String(index).padStart(2, "0")}`,
    contentType: "application/octet-stream",
  })),
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBrotli(bytes) {
  return compressBrotli(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: brotliQuality,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
    },
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const assets = await Promise.all(logicalAssets.map(async (logical) => {
  const rawPath = resolve(publicRoot, logical.path.slice(1));
  const storedPath = `${rawPath}.brp`;
  const rawExists = await exists(rawPath);
  const storedExists = await exists(storedPath);

  if (!rawExists && !storedExists) {
    throw new Error(`Missing audio runtime asset: ${logical.path}`);
  }

  let raw;
  let stored;
  if (rawExists) {
    raw = await readFile(rawPath);
    stored = await canonicalBrotli(raw);
    const roundTrip = brotliDecompressSync(stored, {
      maxOutputLength: raw.byteLength,
    });
    if (!roundTrip.equals(raw)) {
      throw new Error(`Brotli round-trip failed: ${logical.path}`);
    }
    await writeFile(storedPath, stored);
    await unlink(rawPath);
  } else {
    stored = await readFile(storedPath);
    raw = brotliDecompressSync(stored, {
      maxOutputLength: 64 * 1024 * 1024,
    });
  }

  return {
    logicalPath: logical.path,
    storedPath: `/${relative(publicRoot, storedPath).replaceAll("\\", "/")}`,
    r2Key: `${managedAudioNamespace}${relative(publicRoot, storedPath).replaceAll("\\", "/")}`,
    contentType: logical.contentType,
    rawBytes: raw.byteLength,
    storedBytes: stored.byteLength,
    rawSha256: sha256(raw),
    storedSha256: sha256(stored),
  };
}));

const rawBytes = assets.reduce((sum, asset) => sum + asset.rawBytes, 0);
const storedBytes = assets.reduce((sum, asset) => sum + asset.storedBytes, 0);
const manifest = {
  schema: "audio-runtime-compression-v1",
  algorithm: "brotli",
  quality: brotliQuality,
  rawBytes,
  storedBytes,
  savingsBytes: rawBytes - storedBytes,
  ratio: Number((storedBytes / rawBytes).toFixed(6)),
  assets,
};

await writeFile(
  compressionManifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  `Audio runtime Brotli q${brotliQuality}: ${rawBytes} -> ${storedBytes} bytes `
  + `(${(manifest.ratio * 100).toFixed(2)}%).`,
);
