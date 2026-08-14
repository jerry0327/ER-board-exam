import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const MANAGED_AUDIO_NAMESPACE = "managed-audio/v1/";
export const MANAGED_AUDIO_MARKER_SCHEMA = "sites-managed-audio-migration-v2";
export const MANAGED_AUDIO_OBJECT_SCHEMA = "sites-managed-audio-v1";
export const EXPECTED_MANAGED_AUDIO_ORIGIN = "https://emergency-board-questions.jerry3627613.chatgpt.site";
export const MANAGED_AUDIO_MANIFEST_PATHS = [
  "public/audio/snac/compression-manifest.json",
  "public/static-snac/compression-manifest.json",
];

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RELEASE_ASSET_PATTERN = /^\/audio\/snac\/releases\/[a-f0-9]{20}\/[^/]+\.snac(?:\.json)?$/u;
const RUNTIME_ASSET_PATTERN = /^\/static-snac\/(?:ort-wasm-simd-threaded\.asyncify\.wasm|model\/snac24-static\.part0[0-6])$/u;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isSafeLogicalPath(path) {
  if (typeof path !== "string" || path !== path.normalize("NFC")) return false;
  if (
    path.includes("..")
    || path.includes("\\")
    || path.includes("%")
    || path.includes("//")
    || /[\u0000-\u001f\u007f?#]/u.test(path)
  ) {
    return false;
  }
  return path === "/audio/snac/catalog.json"
    || RELEASE_ASSET_PATTERN.test(path)
    || RUNTIME_ASSET_PATTERN.test(path);
}

function expectedContentType(logicalPath) {
  if (logicalPath.endsWith(".json")) return "application/json; charset=utf-8";
  if (logicalPath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

export function expectedR2Key(logicalPath) {
  return `${MANAGED_AUDIO_NAMESPACE}${logicalPath.slice(1)}.brp`;
}

export function validateManagedAudioAsset(asset, seenLogicalPaths, seenKeys) {
  invariant(asset && typeof asset === "object" && !Array.isArray(asset), "Managed audio entry must be an object");
  invariant(isSafeLogicalPath(asset.logicalPath), `Unsafe managed audio logicalPath: ${asset.logicalPath}`);
  invariant(asset.storedPath === `${asset.logicalPath}.brp`, `Invalid storedPath: ${asset.logicalPath}`);
  invariant(asset.r2Key === expectedR2Key(asset.logicalPath), `Invalid R2 namespace/key: ${asset.logicalPath}`);
  invariant(asset.contentType === expectedContentType(asset.logicalPath), `Invalid content type: ${asset.logicalPath}`);
  invariant(Number.isSafeInteger(asset.rawBytes) && asset.rawBytes > 0, `Invalid raw size: ${asset.logicalPath}`);
  invariant(Number.isSafeInteger(asset.storedBytes) && asset.storedBytes > 0, `Invalid stored size: ${asset.logicalPath}`);
  invariant(SHA256_PATTERN.test(asset.rawSha256), `Invalid raw SHA-256: ${asset.logicalPath}`);
  invariant(SHA256_PATTERN.test(asset.storedSha256), `Invalid stored SHA-256: ${asset.logicalPath}`);
  invariant(!seenLogicalPaths.has(asset.logicalPath), `Duplicate managed logicalPath: ${asset.logicalPath}`);
  invariant(!seenKeys.has(asset.r2Key), `Duplicate managed R2 key: ${asset.r2Key}`);
  seenLogicalPaths.add(asset.logicalPath);
  seenKeys.add(asset.r2Key);
  return asset;
}

function merkleRoot(entries) {
  let level = entries.map((entry) => Buffer.from(sha256(Buffer.from(canonicalJson(entry))), "hex"));
  invariant(level.length > 0, "Managed audio allowlist cannot be empty");
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(Buffer.from(sha256(Buffer.concat([left, right])), "hex"));
    }
    level = next;
  }
  return level[0].toString("hex");
}

export async function loadManagedAudioState(projectRoot) {
  const manifestRecords = await Promise.all(MANAGED_AUDIO_MANIFEST_PATHS.map(async (relativePath) => {
    const bytes = await readFile(resolve(projectRoot, relativePath));
    const manifest = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
    return { relativePath, manifest };
  }));

  invariant(manifestRecords[0].manifest.schema === "snac-audio-compression-v3", "Unexpected SNAC manifest schema");
  invariant(manifestRecords[1].manifest.schema === "audio-runtime-compression-v1", "Unexpected runtime manifest schema");
  invariant(manifestRecords.every(({ manifest }) => Array.isArray(manifest.assets)), "Managed manifests require asset arrays");

  const seenLogicalPaths = new Set();
  const seenKeys = new Set();
  const assets = manifestRecords
    .flatMap(({ manifest }) => manifest.assets)
    .sort((left, right) => left.logicalPath < right.logicalPath ? -1 : left.logicalPath > right.logicalPath ? 1 : 0)
    .map((asset) => validateManagedAudioAsset(asset, seenLogicalPaths, seenKeys));

  invariant(assets.some((asset) => asset.logicalPath === "/audio/snac/catalog.json"), "Managed catalog entry is missing");
  invariant(assets.filter((asset) => asset.logicalPath.startsWith("/static-snac/")).length === 8, "Managed runtime allowlist must contain eight assets");

  const manifestSha256 = Object.fromEntries(manifestRecords.map(({ relativePath, manifest }) => [
    `/${relativePath.replace(/^public\//u, "")}`,
    sha256(Buffer.from(canonicalJson(manifest))),
  ]));
  const manifestSetSha256 = sha256(Buffer.from(canonicalJson(manifestSha256)));
  const assetsMerkleRoot = merkleRoot(assets);
  const storedBytes = assets.reduce((sum, asset) => sum + asset.storedBytes, 0);

  return {
    assets,
    assetsMerkleRoot,
    manifestSetSha256,
    manifestSha256,
    storedBytes,
  };
}

export function createManagedAudioMarker({ state, origin, projectId, verifiedAt = new Date() }) {
  invariant(origin === EXPECTED_MANAGED_AUDIO_ORIGIN, `Verification origin must be ${EXPECTED_MANAGED_AUDIO_ORIGIN}`);
  invariant(typeof projectId === "string" && projectId.length > 0, "Site project id is required");
  const timestamp = verifiedAt instanceof Date ? verifiedAt.toISOString() : new Date(verifiedAt).toISOString();
  return {
    schema: MANAGED_AUDIO_MARKER_SCHEMA,
    verified: true,
    namespace: MANAGED_AUDIO_NAMESPACE,
    projectId,
    origin,
    verifiedAt: timestamp,
    verification: "authenticated-r2-get-sha256",
    manifestSha256: state.manifestSha256,
    manifestSetSha256: state.manifestSetSha256,
    assetsMerkleRoot: state.assetsMerkleRoot,
    assets: state.assets.length,
    storedBytes: state.storedBytes,
  };
}

export function validateManagedAudioMarker(marker, { state, projectId }) {
  const exactKeys = [
    "assets",
    "assetsMerkleRoot",
    "manifestSetSha256",
    "manifestSha256",
    "namespace",
    "origin",
    "projectId",
    "schema",
    "storedBytes",
    "verification",
    "verified",
    "verifiedAt",
  ];
  invariant(marker && typeof marker === "object" && !Array.isArray(marker), "R2 migration marker must be an object");
  invariant(JSON.stringify(Object.keys(marker).sort()) === JSON.stringify(exactKeys), "R2 migration marker fields are not exact");
  invariant(marker.schema === MANAGED_AUDIO_MARKER_SCHEMA, "R2 migration marker schema mismatch");
  invariant(marker.verified === true, "R2 migration marker is not verified");
  invariant(marker.namespace === MANAGED_AUDIO_NAMESPACE, "R2 migration namespace mismatch");
  invariant(marker.projectId === projectId, "R2 migration marker belongs to another Site");
  invariant(marker.origin === EXPECTED_MANAGED_AUDIO_ORIGIN, "R2 migration marker origin mismatch");
  invariant(marker.verification === "authenticated-r2-get-sha256", "R2 migration verification method mismatch");
  invariant(
    typeof marker.verifiedAt === "string"
      && !Number.isNaN(Date.parse(marker.verifiedAt))
      && new Date(marker.verifiedAt).toISOString() === marker.verifiedAt,
    "R2 migration verifiedAt is invalid",
  );
  invariant(canonicalJson(marker.manifestSha256) === canonicalJson(state.manifestSha256), "R2 migration manifest hashes changed");
  invariant(marker.manifestSetSha256 === state.manifestSetSha256, "R2 migration manifest-set hash changed");
  invariant(marker.assetsMerkleRoot === state.assetsMerkleRoot, "R2 migration asset Merkle root changed");
  invariant(marker.assets === state.assets.length, "R2 migration asset count changed");
  invariant(marker.storedBytes === state.storedBytes, "R2 migration byte total changed");
  return marker;
}
