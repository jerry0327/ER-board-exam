import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MANAGED_AUDIO_NAMESPACE,
  MANAGED_AUDIO_OBJECT_SCHEMA,
  loadManagedAudioState,
} from "./lib/managed-audio-manifest.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = resolve(projectRoot, "dist/client");
const publicRoot = resolve(projectRoot, "public");
const workerPath = resolve(projectRoot, "dist/server/index.js");
const markerPath = resolve(publicRoot, "audio/snac/r2-migration-complete.json");
const state = await loadManagedAudioState(projectRoot);
const entryByKey = new Map(state.assets.map((entry) => [entry.r2Key, entry]));
const workerSource = await readFile(workerPath, "utf8");
const managedChunkNames = (await readdir(resolve(projectRoot, "dist/server/assets")))
  .filter((name) => /^managed-audio-manifest\.generated-[A-Za-z0-9_-]+\.js$/u.test(name));
assert(workerSource.length < 2_000_000, "Homepage Worker entry unexpectedly exceeds 2 MB");
assert.equal(managedChunkNames.length, 1, "Managed audio allowlist must build as one lazy server chunk");
for (const evidence of [
  state.manifestSetSha256,
  state.assetsMerkleRoot,
  state.assets[0]?.r2Key,
  state.assets[Math.floor(state.assets.length / 2)]?.r2Key,
  state.assets.at(-1)?.r2Key,
]) {
  assert(evidence && !workerSource.includes(evidence), "Managed audio rows leaked into the homepage Worker entry");
}
const managedChunkSource = await readFile(resolve(projectRoot, "dist/server/assets", managedChunkNames[0]), "utf8");
for (const entry of [state.assets[0], state.assets[Math.floor(state.assets.length / 2)], state.assets.at(-1)]) {
  assert(entry && managedChunkSource.includes(entry.r2Key), "Lazy managed-audio chunk is missing allowlist rows");
}

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

function assetPathFor(root, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const path = resolve(root, `.${pathname}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  return path;
}

function createAssets(mode = "success") {
  const calls = [];
  return {
    calls,
    async fetch(request) {
      calls.push(new URL(request.url).pathname);
      if (mode === "throw") throw new Error("fixture ASSETS failure");
      if (mode === "404") return new Response(null, { status: 404 });
      if (mode === "500") return new Response(null, { status: 500 });
      const path = assetPathFor(publicRoot, request.url);
      if (!path) return new Response(null, { status: 400 });
      try {
        const bytes = await readFile(path);
        return new Response(request.method === "HEAD" ? null : bytes, {
          headers: { "content-length": String(bytes.byteLength) },
        });
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          return new Response(null, { status: 404 });
        }
        throw error;
      }
    },
  };
}

async function fixtureStoredBytes(entry, bodyMode = "valid") {
  const stored = new Uint8Array(await readFile(resolve(publicRoot, `.${entry.storedPath}`)));
  assert.equal(stored.byteLength, entry.storedBytes, `R2 fixture size mismatch: ${entry.r2Key}`);
  assert.equal(sha256(stored), entry.storedSha256, `R2 fixture hash mismatch: ${entry.r2Key}`);
  if (bodyMode === "corrupt-body") {
    const corrupted = stored.slice();
    corrupted[0] ^= 0xff;
    return corrupted;
  }
  return stored;
}

function createBucket(mode = "valid") {
  const calls = [];
  const puts = [];
  const overrides = new Map();

  async function objectFor(key, includeBody) {
    calls.push({ operation: includeBody ? "get" : "head", key });
    assert(key.startsWith(MANAGED_AUDIO_NAMESPACE), `Worker attempted non-managed R2 key: ${key}`);
    if (mode === "throw") throw new Error("fixture R2 failure");
    if (mode === "missing") return null;
    const entry = entryByKey.get(key);
    if (!entry) return null;
    const override = overrides.get(key);
    const metadata = override?.customMetadata ?? {
      schema: MANAGED_AUDIO_OBJECT_SCHEMA,
      logicalPath: entry.logicalPath,
      storedSha256: entry.storedSha256,
    };
    if (mode === "bad-schema") metadata.schema = "wrong-schema";
    if (mode === "bad-logical-path") metadata.logicalPath = "/private/evidence";
    if (mode === "bad-stored-sha") metadata.storedSha256 = "0".repeat(64);
    const base = {
      key,
      size: mode === "bad-size" ? entry.storedBytes + 1 : override?.bytes.byteLength ?? entry.storedBytes,
      httpEtag: `"${entry.storedSha256.slice(0, 32)}"`,
      customMetadata: metadata,
      writeHttpMetadata(headers) {
        headers.set("content-type", "application/octet-stream");
      },
    };
    if (!includeBody) return base;
    const stored = override?.bytes ?? await fixtureStoredBytes(entry, mode);
    return {
      ...base,
      body: new Response(stored).body,
      async arrayBuffer() {
        return stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength);
      },
    };
  }

  return {
    calls,
    puts,
    get(key) {
      return objectFor(key, true);
    },
    head(key) {
      return objectFor(key, false);
    },
    async put(key, body, options) {
      assert(key.startsWith(MANAGED_AUDIO_NAMESPACE), `Seed attempted non-managed R2 key: ${key}`);
      const entry = entryByKey.get(key);
      assert(entry, `Seed attempted a key outside the exact allowlist: ${key}`);
      const bytes = body instanceof Uint8Array
        ? body.slice()
        : new Uint8Array(await new Response(body).arrayBuffer());
      overrides.set(key, { bytes, customMetadata: { ...options.customMetadata } });
      puts.push({ key, bytes, options });
      return { key };
    },
  };
}

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("managed-audio-security-audit", `${process.pid}-${Date.now()}`);
const worker = (await import(workerUrl.href)).default;
assert.equal(typeof worker?.fetch, "function", "Built Worker fetch handler is missing");

function createContext() {
  const pending = [];
  return {
    pending,
    ctx: {
      passThroughOnException() {},
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
    },
  };
}

async function invoke(pathname, {
  assets = createAssets(),
  bucket,
  headers = {},
  method = "GET",
  body,
  token,
} = {}) {
  const { ctx, pending } = createContext();
  const response = await worker.fetch(new Request(new URL(pathname, "https://audit.invalid"), {
    method,
    headers,
    body,
  }), {
    ASSETS: assets,
    BUCKET: bucket,
    MANAGED_AUDIO_OPERATOR_TOKEN: token,
  }, ctx);
  await Promise.all(pending);
  return response;
}

const catalogEntry = state.assets.find((entry) => entry.logicalPath === "/audio/snac/catalog.json");
let chapterEntry = null;
for (const entry of state.assets) {
  if (
    entry.logicalPath.endsWith(".snac")
    && await exists(resolve(publicRoot, `.${entry.storedPath}`))
  ) {
    chapterEntry = entry;
    break;
  }
}
const runtimeEntry = state.assets.find((entry) => entry.logicalPath.endsWith(".part06"));
const encodedKeyEntry = state.assets.find((entry) => entry.logicalPath.includes("/releases/") && entry.logicalPath.endsWith(".snac"));
assert(catalogEntry && chapterEntry && runtimeEntry && encodedKeyEntry, "Managed audio fixtures are incomplete");

// The public route is R2-first, and the retired query parameter cannot change
// source selection or trigger a write.
{
  const assets = createAssets("success");
  const bucket = createBucket("valid");
  const response = await invoke(`${catalogEntry.logicalPath}?__asset_source=r2`, {
    assets,
    bucket,
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-managed-asset-storage"), "r2");
  assert.equal(assets.calls.length, 0, "R2 success unnecessarily consulted static assets");
  assert.equal(bucket.puts.length, 0, "Public request unexpectedly seeded R2");
}

// A validated R2 object must bypass ASSETS even when the static binding would
// throw, miss, or fail.
for (const staticMode of ["throw", "404", "500"]) {
  const assets = createAssets(staticMode);
  const bucket = createBucket("valid");
  const response = await invoke(catalogEntry.logicalPath, {
    assets,
    bucket,
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(response.status, 200, `ASSETS ${staticMode} did not fall through to R2`);
  assert.equal(response.headers.get("x-managed-asset-storage"), "r2");
  assert.equal(assets.calls.length, 0, `R2 success consulted ASSETS ${staticMode}`);
  const raw = new Uint8Array(await response.arrayBuffer());
  assert.equal(raw.byteLength, catalogEntry.rawBytes);
  assert.equal(sha256(raw), catalogEntry.rawSha256);
}

// Missing or invalid R2 objects retain the verified v99 packaged files as a
// recovery source during source builds and migrations.
for (const bucketMode of ["missing", "throw", "bad-size", "bad-schema", "bad-logical-path", "bad-stored-sha", "corrupt-body"]) {
  const response = await invoke(catalogEntry.logicalPath, {
    assets: createAssets("success"),
    bucket: createBucket(bucketMode),
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(response.status, 200, `Invalid R2 mode ${bucketMode} did not use static fallback`);
  assert.equal(response.headers.get("x-managed-asset-storage"), "static");
}

// Both sources missing/unbound, or an R2 object with any invalid metadata,
// must fail closed with an explicit retryable 503.
for (const bucketMode of [null, "missing", "throw", "bad-size", "bad-schema", "bad-logical-path", "bad-stored-sha", "corrupt-body"]) {
  const response = await invoke(catalogEntry.logicalPath, {
    assets: createAssets("404"),
    bucket: bucketMode ? createBucket(bucketMode) : undefined,
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(response.status, 503, `Invalid/unbound R2 mode ${bucketMode} did not fail closed`);
  assert.equal(response.headers.get("x-managed-asset-storage"), "unavailable");
}

// Brotli and identity are distinct representations for GET and HEAD, with
// distinct weak ETags and correct representation byte lengths.
{
  const bucket = createBucket("valid");
  const base = { assets: createAssets("404"), bucket };
  const identity = await invoke(chapterEntry.logicalPath, {
    ...base,
    headers: { "accept-encoding": "identity" },
  });
  const brotli = await invoke(chapterEntry.logicalPath, {
    ...base,
    headers: { "accept-encoding": "br" },
  });
  assert.equal(identity.status, 200);
  assert.equal(brotli.status, 200);
  assert.equal(identity.headers.get("content-encoding"), null);
  assert.equal(brotli.headers.get("content-encoding"), "br");
  assert.equal(Number(identity.headers.get("content-length")), chapterEntry.rawBytes);
  assert.equal(Number(brotli.headers.get("content-length")), chapterEntry.storedBytes);
  assert.match(identity.headers.get("etag"), /^W\/".+-identity"$/u);
  assert.match(brotli.headers.get("etag"), /^W\/".+-br"$/u);
  assert.notEqual(identity.headers.get("etag"), brotli.headers.get("etag"));
  const identityBytes = new Uint8Array(await identity.arrayBuffer());
  const brotliBytes = new Uint8Array(await brotli.arrayBuffer());
  assert.equal(sha256(identityBytes), chapterEntry.rawSha256);
  assert.equal(sha256(brotliBytes), chapterEntry.storedSha256);
  assert.equal(sha256(brotliDecompressSync(brotliBytes)), chapterEntry.rawSha256);

  for (const [encoding, expectedBytes, expectedEtag] of [
    ["identity", chapterEntry.rawBytes, identity.headers.get("etag")],
    ["br", chapterEntry.storedBytes, brotli.headers.get("etag")],
  ]) {
    const head = await invoke(chapterEntry.logicalPath, {
      ...base,
      method: "HEAD",
      headers: { "accept-encoding": encoding },
    });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get("content-length")), expectedBytes);
    assert.equal(head.headers.get("etag"), expectedEtag);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const notModified = await invoke(chapterEntry.logicalPath, {
      ...base,
      headers: { "accept-encoding": encoding, "if-none-match": expectedEtag },
    });
    assert.equal(notModified.status, 304);
  }
}

// Legacy encoded release slashes still resolve to the same exact allowlist
// entry; unknown, traversal-shaped and private paths never reach R2.
{
  const legacyPath = encodeURIComponent(chapterEntry.logicalPath.slice("/audio/snac/".length));
  const bucket = createBucket("valid");
  const legacy = await invoke(`/audio/snac/${legacyPath}`, {
    assets: createAssets("404"),
    bucket,
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.get("x-managed-asset-storage"), "r2");

  const before = bucket.calls.length;
  for (const unsafePath of [
    "/audio/snac/releases%2Fnot-allowlisted%2Fprivate.snac",
    "/audio/snac/%252e%252e/private.snac",
    "/audio/snac/managed-audio%2Fv1%2Fprivate.snac",
    "/static-snac/model/snac24-static.part07",
  ]) {
    const response = await invoke(unsafePath, {
      assets: createAssets("404"),
      bucket,
      headers: { "accept-encoding": "identity" },
    });
    assert([400, 404].includes(response.status), `Unsafe path returned ${response.status}: ${unsafePath}`);
  }
  assert.equal(bucket.calls.length, before, "An unknown/traversal/private path reached R2");
}

// Operator endpoints are indistinguishable from missing routes without a Sites
// secret and cannot seed/read anything outside the exact allowlist.
{
  const token = "managed-audio-audit-token-32-characters-minimum";
  const bucket = createBucket("valid");
  const unauthorized = await invoke("/_ops/managed-audio/object?logicalPath=%2Faudio%2Fsnac%2Fcatalog.json", {
    assets: createAssets("success"),
    bucket,
  });
  assert.equal(unauthorized.status, 404);
  assert.equal(bucket.calls.length, 0);

  const unauthorizedSeed = await invoke("/_ops/managed-audio/seed", {
    assets: createAssets("success"),
    bucket,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ logicalPaths: [catalogEntry.logicalPath] }),
  });
  assert.equal(unauthorizedSeed.status, 404);
  assert.equal(bucket.puts.length, 0);

  const privateAttempt = await invoke("/_ops/managed-audio/object?logicalPath=%2Fprivate%2Fboard-prep%2Fevidence", {
    assets: createAssets("success"),
    bucket,
    token,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(privateAttempt.status, 404);
  assert.equal(bucket.calls.length, 0);

  const seedBucket = createBucket("valid");
  const seed = await invoke("/_ops/managed-audio/seed", {
    assets: createAssets("success"),
    bucket: seedBucket,
    token,
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ logicalPaths: [runtimeEntry.logicalPath] }),
  });
  assert.equal(seed.status, 200, await seed.text());
  assert.equal(seedBucket.puts.length, 1);
  assert.equal(seedBucket.puts[0].key, runtimeEntry.r2Key);
  assert.deepEqual(seedBucket.puts[0].options.customMetadata, {
    schema: MANAGED_AUDIO_OBJECT_SCHEMA,
    logicalPath: runtimeEntry.logicalPath,
    storedSha256: runtimeEntry.storedSha256,
  });

  const operatorObject = await invoke(`/_ops/managed-audio/object?logicalPath=${encodeURIComponent(runtimeEntry.logicalPath)}`, {
    assets: createAssets("404"),
    bucket: seedBucket,
    token,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(operatorObject.status, 200);
  assert.equal(operatorObject.headers.get("x-managed-asset-storage"), "r2-operator");
  const stored = new Uint8Array(await operatorObject.arrayBuffer());
  assert.equal(stored.byteLength, runtimeEntry.storedBytes);
  assert.equal(sha256(stored), runtimeEntry.storedSha256);

  const encodedKeyOperatorObject = await invoke(`/_ops/managed-audio/object?logicalPath=${encodeURIComponent(encodedKeyEntry.logicalPath)}`, {
    assets: createAssets("404"),
    bucket: createBucket("valid"),
    method: "HEAD",
    token,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(encodedKeyOperatorObject.status, 200);
  const encodedManagedKey = encodedKeyOperatorObject.headers.get("x-managed-asset-key");
  assert.equal(encodedManagedKey, encodeURIComponent(encodedKeyEntry.r2Key));
  assert.match(encodedManagedKey, /^[\x21-\x7e]+$/u, "Operator key evidence must remain ASCII-safe");

  const corruptOperator = await invoke(`/_ops/managed-audio/object?logicalPath=${encodeURIComponent(catalogEntry.logicalPath)}`, {
    assets: createAssets("404"),
    bucket: createBucket("corrupt-body"),
    token,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(corruptOperator.status, 502);
}

if (await exists(markerPath)) {
  for (const entry of state.assets) {
    assert.equal(
      await exists(resolve(clientRoot, `.${entry.storedPath}`)),
      false,
      `Slim artifact still includes remotely verified bytes: ${entry.storedPath}`,
    );
  }
  for (const buildOnlyPath of [
    "/audio/snac/compression-manifest.json",
    "/static-snac/compression-manifest.json",
    "/audio/snac/r2-migration-complete.json",
  ]) {
    assert.equal(
      await exists(resolve(clientRoot, `.${buildOnlyPath}`)),
      false,
      `Slim artifact still includes build-only metadata: ${buildOnlyPath}`,
    );
  }
} else {
  for (const entry of state.assets) {
    assert.equal(
      await exists(resolve(clientRoot, `.${entry.storedPath}`)),
      true,
      `Marker-free artifact lost its static fallback: ${entry.storedPath}`,
    );
  }
}

console.log(`Validated fail-closed R2 delivery and operator isolation for ${state.assets.length} exact managed-audio assets.`);
