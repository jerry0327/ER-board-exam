import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { brotliCompress, brotliDecompressSync, constants } from "node:zlib";
import { cpus } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const audioRoot = resolve(publicRoot, "audio/snac");
const manifestPath = resolve(audioRoot, "compression-manifest.json");
const quality = 11;
const concurrency = Math.max(1, Math.min(6, cpus().length));
const compress = promisify(brotliCompress);
const managedAudioNamespace = "managed-audio/v1/";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directory, relativeDirectory = "") {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listFiles(resolve(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      results.push(relative(audioRoot, resolve(directory, entry.name)));
    }
  }
  return results;
}

async function mapLimit(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

let previousManifest = null;
if (await exists(manifestPath)) {
  try {
    previousManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    previousManifest = null;
  }
}
const previousAssets = new Map(
  Array.isArray(previousManifest?.assets)
    ? previousManifest.assets.map((asset) => [asset.logicalPath, asset])
    : [],
);

async function expectedLogicalPathsFromCatalog() {
  const catalogPath = resolve(audioRoot, "catalog.json");
  if (!await exists(catalogPath)) return null;
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (catalog.schema !== "em-board-audio-catalog-v2" || !Array.isArray(catalog.entries)) {
    throw new Error("SNAC audio catalog is invalid.");
  }
  const expected = new Set(["/audio/snac/catalog.json"]);
  for (const entry of catalog.entries) {
    if (typeof entry.file !== "string" || !/^releases\/[a-f0-9]{12,64}\/.+/u.test(entry.file)) {
      throw new Error(`SNAC audio catalog file is invalid: ${entry.id ?? "unknown"}`);
    }
    expected.add(`/audio/snac/${entry.file}.snac`);
    expected.add(`/audio/snac/${entry.file}.snac.json`);
  }
  return expected;
}

const relativeNames = (await listFiles(audioRoot)).filter((name) => {
  const portable = name.replaceAll("\\", "/");
  return portable.endsWith(".snac")
    || portable.endsWith(".snac.json")
    || portable === "catalog.json";
});

if (!relativeNames.length) {
  if (previousManifest?.schema === "snac-audio-compression-v3") {
    const normalizedManifest = {
      ...previousManifest,
      assets: previousManifest.assets.map((asset) => ({
        ...asset,
        r2Key: `${managedAudioNamespace}${asset.logicalPath.slice(1)}.brp`,
      })),
    };
    await writeFile(manifestPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`, "utf8");
    console.log("SNAC audio is already stored as release-scoped Brotli assets; managed R2 keys are current.");
    process.exit(0);
  }
  throw new Error("No uncompressed SNAC chapter assets were found.");
}

const staged = await mapLimit(relativeNames, concurrency, async (relativeName) => {
  const rawPath = resolve(audioRoot, relativeName);
  const storedPath = `${rawPath}.brp`;
  const logicalPath = `/audio/snac/${relativeName.replaceAll("\\", "/")}`;
  const publicStoredPath = `/${relative(publicRoot, storedPath).replaceAll("\\", "/")}`;
  const raw = await readFile(rawPath);
  const rawHash = sha256(raw);
  const previous = previousAssets.get(logicalPath);

  if (
    previous?.rawSha256 === rawHash
    && previous.rawBytes === raw.byteLength
    && previous.storedPath === publicStoredPath
    && await exists(storedPath)
  ) {
    const stored = await readFile(storedPath);
    if (stored.byteLength === previous.storedBytes && sha256(stored) === previous.storedSha256) {
      return {
        asset: {
          ...previous,
          r2Key: `${managedAudioNamespace}${logicalPath.slice(1)}.brp`,
        },
        rawPath,
        storedPath,
        stagedPath: null,
      };
    }
  }

  const stored = await compress(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_MODE]: relativeName.endsWith(".json")
        ? constants.BROTLI_MODE_TEXT
        : constants.BROTLI_MODE_GENERIC,
    },
  });
  const roundTrip = brotliDecompressSync(stored, { maxOutputLength: raw.byteLength });
  if (!roundTrip.equals(raw)) throw new Error(`Brotli round-trip failed: ${relativeName}`);
  const stagedPath = `${storedPath}.part`;
  await mkdir(dirname(stagedPath), { recursive: true });
  await writeFile(stagedPath, stored);
  return {
    asset: {
      logicalPath,
      storedPath: publicStoredPath,
      r2Key: `${managedAudioNamespace}${logicalPath.slice(1)}.brp`,
      contentType: relativeName.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "application/octet-stream",
      rawBytes: raw.byteLength,
      storedBytes: stored.byteLength,
      rawSha256: rawHash,
      storedSha256: sha256(stored),
    },
    rawPath,
    storedPath,
    stagedPath,
  };
});
const expectedLogicalPaths = await expectedLogicalPathsFromCatalog();

// Commit only after every asset has compressed and round-tripped successfully.
for (const item of staged) {
  if (item.stagedPath) await rename(item.stagedPath, item.storedPath);
}
for (const item of staged) await unlink(item.rawPath);

const stagedLogicalPaths = new Set(staged.map((item) => item.asset.logicalPath));
const retainedAssets = expectedLogicalPaths
  ? await mapLimit(
    [...previousAssets.values()].filter((asset) => (
      expectedLogicalPaths.has(asset.logicalPath)
      && !stagedLogicalPaths.has(asset.logicalPath)
    )),
    concurrency,
    async (asset) => {
      const storedPath = resolve(publicRoot, asset.storedPath.slice(1));
      if (!await exists(storedPath)) throw new Error(`Retained SNAC asset is missing: ${asset.storedPath}`);
      const stored = await readFile(storedPath);
      if (stored.byteLength !== asset.storedBytes || sha256(stored) !== asset.storedSha256) {
        throw new Error(`Retained SNAC asset failed verification: ${asset.storedPath}`);
      }
      return {
        ...asset,
        r2Key: `${managedAudioNamespace}${asset.logicalPath.slice(1)}.brp`,
      };
    },
  )
  : [];
const assets = [...staged.map((item) => item.asset), ...retainedAssets]
  .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath, "en"));
const expectedStoredPaths = new Set(assets.map((asset) => resolve(publicRoot, asset.storedPath.slice(1))));
for (const relativeName of await listFiles(audioRoot)) {
  const absolutePath = resolve(audioRoot, relativeName);
  if (relativeName.endsWith(".brp") && !expectedStoredPaths.has(absolutePath)) {
    await unlink(absolutePath);
  }
}

const rawBytes = assets.reduce((sum, asset) => sum + asset.rawBytes, 0);
const storedBytes = assets.reduce((sum, asset) => sum + asset.storedBytes, 0);
const manifest = {
  schema: "snac-audio-compression-v3",
  algorithm: "brotli",
  quality,
  concurrency,
  delivery: "r2-primary-static-fallback",
  releaseScoped: true,
  catalogLogicalPath: "/audio/snac/catalog.json",
  rawBytes,
  storedBytes,
  savingsBytes: rawBytes - storedBytes,
  ratio: Number((storedBytes / rawBytes).toFixed(6)),
  assets,
};
const manifestPartPath = `${manifestPath}.part`;
await writeFile(manifestPartPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await rename(manifestPartPath, manifestPath);
console.log(
  `SNAC audio Brotli q${quality}: ${rawBytes} -> ${storedBytes} bytes `
  + `(${(manifest.ratio * 100).toFixed(2)}%) across ${assets.length} release-scoped assets.`,
);
