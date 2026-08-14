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
const documentsRoot = resolve(publicRoot, "learning-documents");
const compressionManifestPath = resolve(documentsRoot, "compression-manifest.json");
const brotliQuality = 11;
const maxRawBytes = 64 * 1024 * 1024;
const compressBrotli = promisify(brotliCompress);

const logicalAssets = [
  {
    path: "/learning-documents/emergency-clinical-decision-atlas-9273814f8395.pdf",
    contentType: "application/pdf",
  },
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
    throw new Error(`Missing learning document: ${logical.path}`);
  }

  let raw;
  let stored;
  if (rawExists) {
    raw = await readFile(rawPath);
    if (raw.byteLength > maxRawBytes) {
      throw new Error(`Learning document exceeds ${maxRawBytes} bytes: ${logical.path}`);
    }
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
      maxOutputLength: maxRawBytes,
    });
  }

  return {
    logicalPath: logical.path,
    storedPath: `/${relative(publicRoot, storedPath).replaceAll("\\", "/")}`,
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
  schema: "learning-document-compression-v1",
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
  `Learning documents Brotli q${brotliQuality}: ${rawBytes} -> ${storedBytes} bytes `
  + `(${(manifest.ratio * 100).toFixed(2)}%).`,
);
