/** Cloudflare Worker entry point for the vinext-starter template. */
import { brotliDecompressSync } from "node:zlib";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { createPackedStaticHandler } from "./content-packs";
import { handleContentPackOperator } from "./content-pack-r2";
import { serveSemanticTimingSidecar } from "./semantic-subtitle-sidecars";
import {
  applyBuildAssetCachePolicy,
  IMMUTABLE_CACHE_CONTROL,
  serveWorkerFirstStaticAsset,
} from "./static-asset-cache";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET?: R2Bucket;
  MANAGED_AUDIO_OPERATOR_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const NO_BODY_STATUSES = new Set([204, 205, 304]);
const MAX_LEARNING_DOCUMENT_RAW_BYTES = 64 * 1024 * 1024;
const servePackedLogicalStatic = createPackedStaticHandler();

interface ManagedCompressedAsset {
  logicalPath: string;
  storedPath: string;
  r2Key: string;
  contentType: string;
  rawBytes: number;
  storedBytes: number;
  rawSha256: string;
  storedSha256: string;
}

interface ManagedAudioState {
  assets: ManagedCompressedAsset[];
  byLogicalPath: Map<string, ManagedCompressedAsset>;
}

const MANAGED_AUDIO_NAMESPACE = "managed-audio/v1/";
let managedAudioStateRequest: Promise<ManagedAudioState> | null = null;

function loadManagedAudioState() {
  if (!managedAudioStateRequest) {
    managedAudioStateRequest = import("./managed-audio-manifest.generated")
      .then((manifest) => {
        if (manifest.MANAGED_AUDIO_NAMESPACE !== MANAGED_AUDIO_NAMESPACE) {
          throw new Error("Managed-audio namespace mismatch.");
        }
        const assets: ManagedCompressedAsset[] = manifest.MANAGED_AUDIO_ASSET_ROWS.map(([
          logicalPath,
          storedPath,
          r2Key,
          contentType,
          rawBytes,
          storedBytes,
          rawSha256,
          storedSha256,
        ]) => ({
          logicalPath,
          storedPath,
          r2Key,
          contentType,
          rawBytes,
          storedBytes,
          rawSha256,
          storedSha256,
        }));
        return {
          assets,
          byLogicalPath: new Map(assets.map((asset) => [asset.logicalPath, asset])),
        };
      })
      .catch((error: unknown) => {
        managedAudioStateRequest = null;
        throw error;
      });
  }
  return managedAudioStateRequest;
}
const MANAGED_AUDIO_OBJECT_SCHEMA = "sites-managed-audio-v1";
const MANAGED_AUDIO_OPERATOR_SEED_PATH = "/_ops/managed-audio/seed";
const MANAGED_AUDIO_OPERATOR_OBJECT_PATH = "/_ops/managed-audio/object";

function optionalDefaultEdgeCache() {
  try {
    return (globalThis as typeof globalThis & {
      caches?: CacheStorage & { default?: Cache };
    }).caches?.default ?? null;
  } catch {
    // Some Sites runtimes expose CacheStorage but forbid access to its default
    // cache. Audio delivery must continue through R2 or static assets there.
    return null;
  }
}

async function matchOptionalEdgeCache(cache: Cache | null, key: Request) {
  if (!cache) return null;
  try {
    return await cache.match(key);
  } catch {
    return null;
  }
}

function putOptionalEdgeCache(
  cache: Cache | null,
  key: Request,
  response: Response,
  ctx: ExecutionContext,
) {
  if (!cache) return;
  try {
    ctx.waitUntil(cache.put(key, response).catch(() => undefined));
  } catch {
    // Cache writes are an optimization. Never fail SNAC playback for them.
  }
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stableBytes = new Uint8Array(input.byteLength);
  stableBytes.set(input);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", stableBytes.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validManagedR2Metadata(object: R2Object, entry: ManagedCompressedAsset) {
  return object.key === entry.r2Key
    && entry.r2Key.startsWith(MANAGED_AUDIO_NAMESPACE)
    && object.size === entry.storedBytes
    && object.customMetadata?.schema === MANAGED_AUDIO_OBJECT_SCHEMA
    && object.customMetadata?.logicalPath === entry.logicalPath
    && object.customMetadata?.storedSha256 === entry.storedSha256;
}

async function readValidatedR2Object(
  bucket: R2Bucket | undefined,
  entry: ManagedCompressedAsset,
  method: "GET" | "HEAD",
) {
  if (!bucket || !entry.r2Key.startsWith(MANAGED_AUDIO_NAMESPACE)) return null;
  try {
    const object = method === "HEAD"
      ? await bucket.head(entry.r2Key)
      : await bucket.get(entry.r2Key);
    return object && validManagedR2Metadata(object, entry) ? object : null;
  } catch {
    return null;
  }
}

function logicalStaticContentType(pathname: string) {
  const managedPath = pathname.startsWith("/data/")
    || pathname.startsWith("/guides/")
    || pathname.startsWith("/subtitles/")
    || pathname.startsWith("/subtitles-runtime/")
    || pathname.startsWith("/subtitles-title-locales/");
  if (!managedPath) return null;
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (pathname.endsWith(".src")) return "application/x-ndjson; charset=utf-8";
  if (pathname.endsWith(".hxtb")) return "application/octet-stream";
  return null;
}

function requestAcceptsBrotli(request: Request) {
  const header = request.headers.get("accept-encoding");
  if (!header) return false;
  let wildcard = false;
  for (const entry of header.toLowerCase().split(",")) {
    const [name, ...parameters] = entry.trim().split(";");
    const qualityParameter = parameters.find((value) => value.trim().startsWith("q="));
    const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
    const accepted = Number.isFinite(quality) && quality > 0;
    if (name === "br") return accepted;
    if (name === "*") wildcard = accepted;
  }
  return wildcard;
}

function appendVary(headers: Headers, token: string) {
  const current = headers.get("vary");
  const values = current?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (!values.includes(token.toLowerCase())) {
    headers.set("vary", current ? `${current}, ${token}` : token);
  }
}

function learningDocumentContentType(pathname: string) {
  if (!/^\/learning-documents\/[a-z0-9][a-z0-9._-]*-[a-f0-9]{12,64}\.(?:pdf|docx?|pptx?)$/u.test(pathname)) {
    return null;
  }
  if (pathname.endsWith(".pdf")) return "application/pdf";
  if (pathname.endsWith(".doc")) return "application/msword";
  if (pathname.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (pathname.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (pathname.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  return null;
}

function requestEtagMatches(request: Request, etag: string) {
  const condition = request.headers.get("if-none-match");
  if (!condition) return false;
  return condition.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//u, "");
    return normalized === "*" || normalized === etag.replace(/^W\//u, "");
  });
}

function managedRepresentationEtag(entry: ManagedCompressedAsset, acceptsBrotli: boolean) {
  const digest = acceptsBrotli ? entry.storedSha256 : entry.rawSha256;
  return `W/"sha256-${digest}-${acceptsBrotli ? "br" : "identity"}"`;
}

type ManagedPathClassification =
  | { logicalPath: string }
  | { response: Response }
  | null;

function classifyManagedAssetPath(url: URL): ManagedPathClassification {
  const rawManagedAudio = url.pathname.startsWith("/audio/snac/");
  const rawManagedRuntime = url.pathname.startsWith("/static-snac/model/")
    || url.pathname === "/static-snac/ort-wasm-simd-threaded.asyncify.wasm";
  if (!rawManagedAudio && !rawManagedRuntime) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return { response: new Response(null, { status: 400 }) };
  }
  const unsafe = decodedPath.includes("..")
    || decodedPath.includes("\\")
    || decodedPath.includes("//")
    || /[\u0000-\u001f\u007f?#]/u.test(decodedPath);
  if (unsafe) {
    return { response: new Response(null, { status: 400 }) };
  }

  const managedAudioPath = decodedPath === "/audio/snac/catalog.json"
    || /^\/audio\/snac\/releases\/[a-f0-9]{20}\/[^/]+\.snac(?:\.json)?$/u.test(decodedPath);
  const managedRuntimePath = /^\/static-snac\/model\/snac24-static\.part0[0-6]$/u.test(decodedPath)
    || decodedPath === "/static-snac/ort-wasm-simd-threaded.asyncify.wasm";
  if (managedAudioPath || managedRuntimePath) return { logicalPath: decodedPath };
  return rawManagedAudio || rawManagedRuntime
    ? { response: new Response(null, { status: 404 }) }
    : null;
}

function managedCacheControl(entry: ManagedCompressedAsset) {
  return entry.logicalPath === "/audio/snac/catalog.json"
    ? "no-cache, must-revalidate"
    : IMMUTABLE_CACHE_CONTROL;
}

function managedResponseHeaders(
  entry: ManagedCompressedAsset,
  acceptsBrotli: boolean,
  storage: "static" | "r2",
) {
  const headers = new Headers({
    "cache-control": managedCacheControl(entry),
    "content-type": entry.contentType,
    "etag": managedRepresentationEtag(entry, acceptsBrotli),
    "x-content-type-options": "nosniff",
    "x-managed-asset-sha256": acceptsBrotli ? entry.storedSha256 : entry.rawSha256,
    "x-managed-asset-storage": storage,
  });
  headers.set("content-length", String(acceptsBrotli ? entry.storedBytes : entry.rawBytes));
  appendVary(headers, "Accept-Encoding");
  if (acceptsBrotli) headers.set("content-encoding", "br");
  return headers;
}

async function responseFromStoredBrotli(
  request: Request,
  entry: ManagedCompressedAsset,
  storedBody: ReadableStream | null,
  storage: "static" | "r2",
) {
  const acceptsBrotli = requestAcceptsBrotli(request);
  const headers = managedResponseHeaders(entry, acceptsBrotli, storage);
  const etag = headers.get("etag")!;
  if (requestEtagMatches(request, etag)) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { headers });
  if (!storedBody) return null;

  if (acceptsBrotli) {
    return new Response(storedBody.pipeThrough(new TransformStream()), {
      headers,
      encodeBody: "manual",
    });
  }

  try {
    const storedBytes = new Uint8Array(await new Response(storedBody).arrayBuffer());
    if (storedBytes.byteLength !== entry.storedBytes) return null;
    const decoded = new Uint8Array(brotliDecompressSync(storedBytes, {
      maxOutputLength: entry.rawBytes,
    }));
    if (decoded.byteLength !== entry.rawBytes) return null;
    return new Response(decoded, { headers });
  } catch {
    return null;
  }
}

async function serveManagedAssetFromStatic(request: Request, env: Env, entry: ManagedCompressedAsset) {
  const storedUrl = new URL(entry.storedPath, request.url);
  const headers = new Headers({ "accept-encoding": "identity" });
  let asset: Response;
  try {
    asset = await env.ASSETS.fetch(new Request(storedUrl, {
      method: request.method,
      headers,
    }));
  } catch {
    return null;
  }
  if (asset.status === 404 || asset.status >= 500) return null;
  if (!asset.ok) return asset;
  return responseFromStoredBrotli(request, entry, asset.body, "static");
}

async function serveManagedAssetFromR2(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  entry: ManagedCompressedAsset,
) {
  const acceptsBrotli = requestAcceptsBrotli(request);
  const isMutable = managedCacheControl(entry).includes("no-cache");
  const edgeCache = optionalDefaultEdgeCache();
  const cacheUrl = new URL(entry.logicalPath, request.url);
  cacheUrl.searchParams.set("__managed_encoding", acceptsBrotli ? "br" : "identity");
  const edgeCacheKey = new Request(cacheUrl, { method: "GET" });
  if (request.method === "GET" && !isMutable) {
    const cached = await matchOptionalEdgeCache(edgeCache, edgeCacheKey);
    if (cached) return cached;
  }

  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const object = await readValidatedR2Object(env.BUCKET, entry, method);
  if (!object) return null;
  const body = method === "GET" ? (object as R2ObjectBody).body : null;
  const response = await responseFromStoredBrotli(request, entry, body, "r2");
  if (response && request.method === "GET" && !isMutable && response.ok) {
    putOptionalEdgeCache(edgeCache, edgeCacheKey, response.clone(), ctx);
  }
  return response;
}

async function serveManagedAudio(request: Request, env: Env, ctx: ExecutionContext) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const classified = classifyManagedAssetPath(new URL(request.url));
  if (!classified) return null;
  if ("response" in classified) return classified.response;

  let state: ManagedAudioState;
  try {
    state = await loadManagedAudioState();
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "30" },
    });
  }
  const entry = state.byLogicalPath.get(classified.logicalPath);
  if (!entry) return new Response(null, { status: 404 });

  const r2Response = await serveManagedAssetFromR2(request, env, ctx, entry);
  if (r2Response) return r2Response;
  const staticResponse = await serveManagedAssetFromStatic(request, env, entry);
  if (staticResponse) return staticResponse;
  return new Response(null, {
    status: 503,
    statusText: "Managed audio temporarily unavailable",
    headers: {
      "cache-control": "no-store",
      "retry-after": "30",
      "x-managed-asset-storage": "unavailable",
    },
  });
}

async function operatorTokenMatches(request: Request, env: Env) {
  const expected = env.MANAGED_AUDIO_OPERATOR_TOKEN;
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const encoder = new TextEncoder();
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const suppliedBytes = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ suppliedBytes[index];
  }
  return difference === 0;
}

async function readVerifiedStaticStoredBytes(
  request: Request,
  env: Env,
  entry: ManagedCompressedAsset,
) {
  let response: Response;
  try {
    response = await env.ASSETS.fetch(new Request(new URL(entry.storedPath, request.url), {
      headers: { "accept-encoding": "identity" },
    }));
  } catch {
    return null;
  }
  if (!response.ok || !response.body) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength !== entry.storedBytes
    || await sha256Hex(bytes) !== entry.storedSha256
  ) {
    return null;
  }
  return bytes;
}

async function handleManagedAudioOperator(request: Request, env: Env) {
  const url = new URL(request.url);
  const operatorRoute = url.pathname === MANAGED_AUDIO_OPERATOR_SEED_PATH
    || url.pathname === MANAGED_AUDIO_OPERATOR_OBJECT_PATH;
  if (!operatorRoute) return null;
  if (!await operatorTokenMatches(request, env)) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (!env.BUCKET) {
    return Response.json({ error: "Managed object storage is unavailable." }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  let state: ManagedAudioState;
  try {
    state = await loadManagedAudioState();
  } catch {
    return Response.json({ error: "Managed object manifest is unavailable." }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  if (url.pathname === MANAGED_AUDIO_OPERATOR_SEED_PATH) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
      return new Response(null, { status: 413 });
    }
    let payload: { logicalPaths?: unknown };
    try {
      payload = await request.json() as { logicalPaths?: unknown };
    } catch {
      return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
    }
    if (
      !payload
      || typeof payload !== "object"
      || Array.isArray(payload)
      || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(["logicalPaths"])
      || !Array.isArray(payload.logicalPaths)
      || payload.logicalPaths.length < 1
      || payload.logicalPaths.length > 8
      || payload.logicalPaths.some((path) => typeof path !== "string")
      || new Set(payload.logicalPaths).size !== payload.logicalPaths.length
    ) {
      return Response.json({ error: "logicalPaths must contain 1–8 unique allowlisted paths." }, { status: 400 });
    }
    const entries = payload.logicalPaths.map((path) => state.byLogicalPath.get(path as string));
    if (entries.some((entry) => !entry)) {
      return Response.json({ error: "A requested path is outside the managed-audio allowlist." }, { status: 400 });
    }

    let storedBytes = 0;
    for (const entry of entries as ManagedCompressedAsset[]) {
      const bytes = await readVerifiedStaticStoredBytes(request, env, entry);
      if (!bytes) {
        return Response.json({ error: `Packaged seed bytes failed verification: ${entry.logicalPath}` }, {
          status: 503,
          headers: { "cache-control": "no-store" },
        });
      }
      await env.BUCKET.put(entry.r2Key, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
          schema: MANAGED_AUDIO_OBJECT_SCHEMA,
          logicalPath: entry.logicalPath,
          storedSha256: entry.storedSha256,
        },
      });
      storedBytes += bytes.byteLength;
    }
    return Response.json({ seeded: entries.length, storedBytes }, {
      headers: { "cache-control": "no-store" },
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const logicalPath = url.searchParams.get("logicalPath");
  const entry = logicalPath ? state.byLogicalPath.get(logicalPath) : null;
  if (!entry) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const object = await readValidatedR2Object(env.BUCKET, entry, request.method === "HEAD" ? "HEAD" : "GET");
  if (!object) {
    return Response.json({ error: "R2 object is missing or has invalid metadata." }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const headers = new Headers({
    "cache-control": "no-store",
    "content-length": String(entry.storedBytes),
    "content-type": "application/octet-stream",
    "etag": `W/"sha256-${entry.storedSha256}-stored"`,
    "x-content-type-options": "nosniff",
    // Custom HTTP header values are byte strings on the wire. Keep the R2 key
    // evidence ASCII-only so Unicode filenames cannot be mojibaked in transit.
    "x-managed-asset-key": encodeURIComponent(entry.r2Key),
    "x-managed-asset-sha256": entry.storedSha256,
    "x-managed-asset-storage": "r2-operator",
  });
  if (request.method === "HEAD") return new Response(null, { headers });
  const bytes = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
  if (
    bytes.byteLength !== entry.storedBytes
    || await sha256Hex(bytes) !== entry.storedSha256
  ) {
    return Response.json({ error: "R2 object bytes failed SHA-256 verification." }, {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response(bytes, { headers });
}

async function serveCompressedLearningDocument(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const contentType = learningDocumentContentType(url.pathname);
  if (!contentType) return null;

  const storedUrl = new URL(url);
  storedUrl.pathname = `${storedUrl.pathname}.brp`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("range");
  requestHeaders.delete("if-range");
  requestHeaders.set("accept-encoding", "identity");
  const asset = await env.ASSETS.fetch(new Request(storedUrl, {
    method: request.method,
    headers: requestHeaders,
  }));
  if (asset.status === 404) return null;
  if (!asset.ok && asset.status !== 304) return asset;

  const headers = new Headers(asset.headers);
  headers.set("content-type", contentType);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  headers.set("x-content-type-options", "nosniff");
  headers.delete("content-length");
  headers.delete("content-range");
  headers.delete("accept-ranges");
  appendVary(headers, "Accept-Encoding");

  const noBody = request.method === "HEAD" || NO_BODY_STATUSES.has(asset.status);
  if (!requestAcceptsBrotli(request)) {
    headers.delete("content-encoding");
    const decoded = noBody || !asset.body
      ? null
      : new Uint8Array(brotliDecompressSync(
        new Uint8Array(await asset.arrayBuffer()),
        { maxOutputLength: MAX_LEARNING_DOCUMENT_RAW_BYTES },
      ));
    return new Response(decoded, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  }

  headers.set("content-encoding", "br");
  const encodedBody = noBody || !asset.body
    ? null
    : asset.body.pipeThrough(new TransformStream());
  return new Response(encodedBody, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
    encodeBody: "manual",
  });
}

async function serveLegacyLogicalStatic(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const contentType = logicalStaticContentType(url.pathname);
  if (!contentType) return null;

  const compressedUrl = new URL(url);
  compressedUrl.pathname = `${compressedUrl.pathname}.br`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("range");
  requestHeaders.delete("if-range");
  const asset = await env.ASSETS.fetch(new Request(compressedUrl, {
    method: request.method,
    headers: requestHeaders,
  }));
  if (asset.status === 404) return null;
  if (!asset.ok && asset.status !== 304) return asset;

  const headers = new Headers(asset.headers);
  headers.set("content-type", contentType);
  headers.delete("content-range");
  headers.delete("accept-ranges");
  appendVary(headers, "Accept-Encoding");

  const noBody = request.method === "HEAD" || NO_BODY_STATUSES.has(asset.status);
  if (!requestAcceptsBrotli(request)) {
    headers.delete("content-encoding");
    headers.delete("content-length");
    const decoded = noBody || !asset.body
      ? null
      : new Uint8Array(brotliDecompressSync(new Uint8Array(await asset.arrayBuffer())));
    return new Response(decoded, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  }

  headers.set("content-encoding", "br");
  return new Response(noBody ? null : asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
    encodeBody: "manual",
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const workerFirstStatic = await serveWorkerFirstStaticAsset(request, env.ASSETS);
    if (workerFirstStatic) return workerFirstStatic;

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/logo.png") {
      return Response.redirect(new URL("/brand/jizhuan-rosc-icon-512.png", request.url), 308);
    }

    const managedAudioOperator = await handleManagedAudioOperator(request, env);
    if (managedAudioOperator) return managedAudioOperator;

    const contentPackOperator = await handleContentPackOperator(request, env);
    if (contentPackOperator) return contentPackOperator;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const managedAudio = await serveManagedAudio(request, env, ctx);
    if (managedAudio) return managedAudio;

    const learningDocument = await serveCompressedLearningDocument(request, env);
    if (learningDocument) return learningDocument;

    const semanticTiming = await serveSemanticTimingSidecar(request, env);
    if (semanticTiming) return semanticTiming;

    const packedStatic = await servePackedLogicalStatic(request, env);
    if (packedStatic) return packedStatic;

    const legacyStatic = await serveLegacyLogicalStatic(request, env);
    if (legacyStatic) return legacyStatic;

    return applyBuildAssetCachePolicy(request, await handler.fetch(request, env, ctx));
  },
};

export default worker;
