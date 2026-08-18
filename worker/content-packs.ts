import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from "node:zlib";
import { createHash } from "node:crypto";
import { loadR2ContentPackBytes, type ContentPackR2Env } from "./content-pack-r2";

const INDEX_PATH = "/content-packs/index.brp";
const PACK_ROOT = "/content-packs/packs/";
const DIGEST_ROOT = "/content-packs/digests/";
const INDEX_VERSION = 3;
const INLINE_DIGEST_INDEX_VERSION = 2;
const LEGACY_INDEX_VERSION = 1;
const MAX_INDEX_COMPRESSED_BYTES = 1024 * 1024;
const MAX_INDEX_RAW_BYTES = 4 * 1024 * 1024;
const MAX_PACK_RAW_BYTES = 32 * 1024 * 1024;
const MAX_PACK_COMPRESSED_BYTES = 33 * 1024 * 1024;
const MAX_PACK_COUNT = 2048;
const MAX_ENTRY_COUNT = 20_000;
const MAX_LOGICAL_PATH_BYTES = 256;
const MAX_DECODED_CACHE_BYTES = 32 * 1024 * 1024;
const DECOMPRESSION_SLACK_BYTES = 64 * 1024;
const CONTENT_DIGEST_BYTES = 32;
const MAX_DIGEST_SIDECAR_BYTES = MAX_ENTRY_COUNT * CONTENT_DIGEST_BYTES;
const safeLogicalPath = /^(?:(?:data|guides)\/[A-Za-z0-9._@+()/+-]+\.(?:json|md)|subtitles\/(?:manifest\.json|[A-Za-z0-9._@+()/+-]+\/(?:[A-Za-z0-9._@+()-]+\.(?:src|chapters\.json)))|subtitles-runtime\/(?:manifest\.json|bundles\/[a-f0-9]{64}\.hxtb))$/u;
const safePackName = /^[a-f0-9]{64}\.brp$/u;
const safeDigestName = /^[a-f0-9]{64}\.bin$/u;
const safeContentVersion = /^[a-f0-9]{16,64}$/u;
const questionDetailPath = /^data\/questions\/[^/]+\/[^/]+\.json$/u;

type PackTuple = [name: string, rawBytes: number, sha256: string];
type DigestTuple = [name: string, bytes: number, sha256: string];
type EntryTuple = [
  path: string,
  packNumber: number,
  offset: number,
  length: number,
  contentSha256?: string,
];
type SelectedEncoding = "br" | "identity";

interface PackedIndex {
  v: number;
  t: number;
  s?: number;
  p: PackTuple[];
  d?: DigestTuple;
  q?: string;
  e: EntryTuple[];
}

interface PackedEntry {
  entryNumber: number;
  packNumber: number;
  offset: number;
  length: number;
  contentSha256: string | null;
}

interface LoadedIndex {
  id: string;
  generation: number;
  packs: PackTuple[];
  entries: Map<string, PackedEntry>;
  digestAsset: DigestTuple | null;
  questionDataRevision: string | null;
}

interface ParsedIndex {
  packs: PackTuple[];
  entries: Map<string, PackedEntry>;
  digestAsset: DigestTuple | null;
  questionDataRevision: string | null;
}

interface ResolvedEntry {
  index: LoadedIndex;
  entry: PackedEntry;
}

export type PackedStaticEnv = ContentPackR2Env;

function logicalStaticContentType(pathname: string) {
  const managedPath = pathname.startsWith("/data/")
    || pathname.startsWith("/guides/")
    || pathname.startsWith("/subtitles/")
    || pathname.startsWith("/subtitles-runtime/");
  if (!managedPath) return null;
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (pathname.endsWith(".src")) return "application/x-ndjson; charset=utf-8";
  if (pathname.endsWith(".hxtb")) return "application/octet-stream";
  return null;
}

function parseEncodingQuality(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

function selectEncoding(request: Request, preferBrotli: boolean): SelectedEncoding | null {
  const header = request.headers.get("accept-encoding");
  if (!header) return "identity";

  const qualities = new Map<string, number>();
  for (const item of header.toLowerCase().split(",")) {
    const [rawName, ...parameters] = item.trim().split(";");
    const name = rawName.trim();
    if (!name) continue;
    const rawQuality = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("q="))
      ?.slice(2);
    qualities.set(name, parseEncodingQuality(rawQuality) ?? 1);
  }

  const wildcard = qualities.get("*");
  const brotliQuality = qualities.get("br") ?? wildcard ?? 0;
  const identityQuality = qualities.get("identity") ?? wildcard ?? 1;
  if (preferBrotli && brotliQuality > 0) return "br";
  if (identityQuality > 0) return "identity";
  if (brotliQuality > 0) return "br";
  return null;
}

function appendVary(headers: Headers, token: string) {
  const current = headers.get("vary");
  const values = current?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (!values.includes(token.toLowerCase())) {
    headers.set("vary", current ? `${current}, ${token}` : token);
  }
}

function weakEtagValue(value: string) {
  return value.trim().replace(/^W\//iu, "");
}

function etagMatches(request: Request, etag: string) {
  const current = request.headers.get("if-none-match");
  if (!current) return false;
  const expected = weakEtagValue(etag);
  return current.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || weakEtagValue(normalized) === expected;
  });
}

function canonicalFastBrotli(bytes: Uint8Array) {
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  });
}

function ownedArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseIndex(bytes: Uint8Array): ParsedIndex {
  if (bytes.byteLength > MAX_INDEX_COMPRESSED_BYTES) {
    throw new Error("Packed content index exceeds the compressed size limit");
  }

  let parsed: PackedIndex;
  try {
    const decoded = brotliDecompressSync(bytes, { maxOutputLength: MAX_INDEX_RAW_BYTES });
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as PackedIndex;
  } catch (error) {
    throw new Error("Packed content index is invalid", { cause: error });
  }

  if (
    !parsed
    || (
      parsed.v !== LEGACY_INDEX_VERSION
      && parsed.v !== INLINE_DIGEST_INDEX_VERSION
      && parsed.v !== INDEX_VERSION
    )
    || !Number.isSafeInteger(parsed.t)
    || parsed.t <= 0
    || parsed.t > MAX_PACK_RAW_BYTES
  ) {
    throw new Error("Packed content index version or target is invalid");
  }
  const singletonBytes = parsed.s ?? parsed.t;
  if (
    !Number.isSafeInteger(singletonBytes)
    || singletonBytes <= 0
    || singletonBytes > parsed.t
    || singletonBytes > 1024 * 1024
  ) {
    throw new Error("Packed content singleton threshold is invalid");
  }
  if (
    !Array.isArray(parsed.p)
    || !parsed.p.length
    || parsed.p.length > MAX_PACK_COUNT
    || !Array.isArray(parsed.e)
    || !parsed.e.length
    || parsed.e.length > MAX_ENTRY_COUNT
  ) {
    throw new Error("Packed content index is incomplete or exceeds its limits");
  }

  const packNames = new Set<string>();
  const packs = parsed.p.map((pack, packNumber): PackTuple => {
    if (!Array.isArray(pack) || pack.length !== 3) {
      throw new Error(`Packed content pack ${packNumber} is invalid`);
    }
    const [name, rawBytes, sha256] = pack;
    if (
      typeof name !== "string"
      || !safePackName.test(name)
      || packNames.has(name)
      || typeof sha256 !== "string"
      || name !== `${sha256}.brp`
      || !Number.isSafeInteger(rawBytes)
      || rawBytes <= 0
      || rawBytes > MAX_PACK_RAW_BYTES
    ) {
      throw new Error(`Packed content pack ${packNumber} is invalid`);
    }
    packNames.add(name);
    return [name, rawBytes, sha256];
  });

  const nextOffsets = new Array(packs.length).fill(0) as number[];
  const entries = new Map<string, PackedEntry>();
  let previousPath = "";
  const entriesHaveInlineDigests = parsed.v === INLINE_DIGEST_INDEX_VERSION;
  for (let entryNumber = 0; entryNumber < parsed.e.length; entryNumber += 1) {
    const entry = parsed.e[entryNumber];
    if (
      !Array.isArray(entry)
      || entry.length !== (entriesHaveInlineDigests ? 5 : 4)
    ) {
      throw new Error("Packed content entry is invalid");
    }
    const [logicalPath, packNumber, offset, length, contentSha256 = null] = entry;
    if (
      typeof logicalPath !== "string"
      || new TextEncoder().encode(logicalPath).byteLength > MAX_LOGICAL_PATH_BYTES
      || !safeLogicalPath.test(logicalPath)
      || logicalPath.includes("//")
      || logicalPath.split("/").includes("..")
      || logicalPath <= previousPath
      || entries.has(logicalPath)
      || !Number.isSafeInteger(packNumber)
      || packNumber < 0
      || packNumber >= packs.length
      || !Number.isSafeInteger(offset)
      || offset !== nextOffsets[packNumber]
      || !Number.isSafeInteger(length)
      || length <= 0
      || offset + length > packs[packNumber][1]
      || (
        entriesHaveInlineDigests
        && (
          typeof contentSha256 !== "string"
          || !/^[a-f0-9]{64}$/u.test(contentSha256)
        )
      )
    ) {
      throw new Error(`Packed content entry is invalid: ${String(logicalPath)}`);
    }
    entries.set(logicalPath, {
      entryNumber,
      packNumber,
      offset,
      length,
      contentSha256,
    });
    nextOffsets[packNumber] += length;
    previousPath = logicalPath;
  }

  for (let packNumber = 0; packNumber < packs.length; packNumber += 1) {
    if (nextOffsets[packNumber] !== packs[packNumber][1]) {
      throw new Error(`Packed content pack coverage is invalid: ${packs[packNumber][0]}`);
    }
  }

  let digestAsset: DigestTuple | null = null;
  if (parsed.v === INDEX_VERSION) {
    if (!Array.isArray(parsed.d) || parsed.d.length !== 3) {
      throw new Error("Packed content digest sidecar is missing");
    }
    const [name, bytes, sha256] = parsed.d;
    if (
      typeof name !== "string"
      || !safeDigestName.test(name)
      || typeof sha256 !== "string"
      || name !== `${sha256}.bin`
      || !Number.isSafeInteger(bytes)
      || bytes !== entries.size * CONTENT_DIGEST_BYTES
      || bytes > MAX_DIGEST_SIDECAR_BYTES
    ) {
      throw new Error("Packed content digest sidecar is invalid");
    }
    digestAsset = [name, bytes, sha256];
  }

  const hasQuestionDetails = [...entries.keys()].some((path) => questionDetailPath.test(path));
  const questionDataRevision = parsed.v === INDEX_VERSION ? (parsed.q ?? null) : null;
  if (
    parsed.v === INDEX_VERSION
    && (
      (hasQuestionDetails && (typeof questionDataRevision !== "string" || !/^[a-f0-9]{64}$/u.test(questionDataRevision)))
      || (!hasQuestionDetails && questionDataRevision !== null)
    )
  ) {
    throw new Error("Packed question data revision is invalid");
  }

  return { packs, entries, digestAsset, questionDataRevision };
}

async function fetchAssetBytes(
  env: PackedStaticEnv,
  requestUrl: string,
  assetPath: string,
  maxBytes: number,
) {
  const headers = new Headers({ "accept-encoding": "identity" });
  const response = await env.ASSETS.fetch(new Request(new URL(assetPath, requestUrl), { headers }));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Packed content asset failed with ${response.status}: ${assetPath}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Packed content asset exceeds its size limit: ${assetPath}`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Packed content asset exceeds its size limit");
        throw new Error(`Packed content asset exceeds its size limit: ${assetPath}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function unavailableResponse() {
  return new Response("Content temporarily unavailable", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "1",
      "x-content-type-options": "nosniff",
    },
  });
}

function requestedContentVersion(url: URL) {
  const versions = url.searchParams.getAll("v");
  return versions.length === 1 && safeContentVersion.test(versions[0])
    ? versions[0]
    : null;
}

function bytesToHex(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

export function createPackedStaticHandler() {
  let currentIndex: LoadedIndex | null = null;
  let generation = 0;
  let digestCache: { indexId: string; bytes: Uint8Array } | null = null;
  let digestRequest: { indexId: string; request: Promise<Uint8Array | null> } | null = null;
  const decodedCache = new Map<string, Uint8Array>();
  const decodedRequests = new Map<string, Promise<Uint8Array | null>>();
  let decodedCacheBytes = 0;

  const clearPackCaches = () => {
    decodedCache.clear();
    decodedCacheBytes = 0;
  };

  const reserveDecodedCacheBytes = (expectedBytes: number) => {
    if (expectedBytes > MAX_DECODED_CACHE_BYTES) {
      clearPackCaches();
      return;
    }
    while (decodedCacheBytes + expectedBytes > MAX_DECODED_CACHE_BYTES && decodedCache.size) {
      const oldest = decodedCache.entries().next().value as [string, Uint8Array] | undefined;
      if (!oldest) break;
      decodedCache.delete(oldest[0]);
      decodedCacheBytes -= oldest[1].byteLength;
    }
  };

  const installIndex = async (bytes: Uint8Array) => {
    const id = sha256Hex(bytes);
    if (currentIndex?.id === id) return currentIndex;
    const parsed = parseIndex(bytes);
    generation += 1;
    currentIndex = { ...parsed, id, generation };
    digestCache = null;
    digestRequest = null;
    clearPackCaches();
    return currentIndex;
  };

  const loadDigestSidecar = async (
    requestUrl: string,
    env: PackedStaticEnv,
    index: LoadedIndex,
  ) => {
    if (!index.digestAsset) return null;
    if (digestCache?.indexId === index.id) return digestCache.bytes;
    if (digestRequest?.indexId === index.id) return digestRequest.request;

    const [name, expectedBytes, expectedSha256] = index.digestAsset;
    const pendingIndexId = index.id;
    const pending = (async () => {
      const bytes = await fetchAssetBytes(
        env,
        requestUrl,
        `${DIGEST_ROOT}${name}`,
        MAX_DIGEST_SIDECAR_BYTES,
      );
      if (
        !bytes
        || bytes.byteLength !== expectedBytes
        || sha256Hex(bytes) !== expectedSha256
      ) {
        throw new Error(`Packed content digest sidecar mismatch: ${name}`);
      }
      if (currentIndex?.id === index.id) digestCache = { indexId: index.id, bytes };
      return bytes;
    })().finally(() => {
      if (digestRequest?.indexId === pendingIndexId) digestRequest = null;
    });
    digestRequest = { indexId: index.id, request: pending };
    return pending;
  };

  const loadEntryDigest = async (
    requestUrl: string,
    env: PackedStaticEnv,
    index: LoadedIndex,
    entry: PackedEntry,
  ) => {
    if (entry.contentSha256) return entry.contentSha256;
    const digests = await loadDigestSidecar(requestUrl, env, index);
    if (!digests) return null;
    const start = entry.entryNumber * CONTENT_DIGEST_BYTES;
    return bytesToHex(digests.subarray(start, start + CONTENT_DIGEST_BYTES));
  };

  const fetchIndex = async (requestUrl: string, env: PackedStaticEnv) => {
    const bytes = await fetchAssetBytes(
      env,
      requestUrl,
      INDEX_PATH,
      MAX_INDEX_COMPRESSED_BYTES,
    );
    return bytes ? installIndex(bytes) : null;
  };

  const loadIndex = async (
    requestUrl: string,
    env: PackedStaticEnv,
    force = false,
  ): Promise<LoadedIndex | null> => {
    if (!force && currentIndex) return currentIndex;
    return (await fetchIndex(requestUrl, env)) ?? currentIndex;
  };

  const loadCompressedPack = async (
    requestUrl: string,
    env: PackedStaticEnv,
    index: LoadedIndex,
    packNumber: number,
  ) => {
    const [name, , expectedSha256] = index.packs[packNumber];
    const staticBytes = await fetchAssetBytes(
      env,
      requestUrl,
      `${PACK_ROOT}${name}`,
      MAX_PACK_COMPRESSED_BYTES,
    );
    const bytes = staticBytes ?? await loadR2ContentPackBytes(requestUrl, env, name, expectedSha256);
    if (bytes && sha256Hex(bytes) !== expectedSha256) {
      throw new Error(`Packed content digest mismatch: ${name}`);
    }
    return bytes;
  };

  const loadDecodedPack = async (
    requestUrl: string,
    env: PackedStaticEnv,
    index: LoadedIndex,
    packNumber: number,
  ) => {
    const [name, expectedBytes] = index.packs[packNumber];
    const cached = decodedCache.get(name);
    if (cached) {
      decodedCache.delete(name);
      decodedCache.set(name, cached);
      return cached;
    }

    const inFlight = decodedRequests.get(name);
    if (inFlight) return inFlight;

    const request = (async () => {
      const capturedGeneration = index.generation;
      // Evict before fetching and inflating the next pack. Normal packs target
      // 8 MiB, so the 32 MiB LRU can retain roughly four hot packs. A permitted
      // oversized singleton can still consume the full cache by itself.
      reserveDecodedCacheBytes(expectedBytes);
      const compressed = await loadCompressedPack(requestUrl, env, index, packNumber);
      if (!compressed) return null;
      let decoded: Uint8Array;
      try {
        // Workerd's zlib compatibility layer may need one internal output
        // chunk beyond an exact-size ceiling even though the final result is
        // exactly `expectedBytes`. Keep a small bounded allowance, then enforce
        // the signed index length immediately below.
        decoded = brotliDecompressSync(compressed, {
          maxOutputLength: expectedBytes + DECOMPRESSION_SLACK_BYTES,
        });
      } catch (error) {
        throw new Error(`Packed content decompression failed: ${name}`, { cause: error });
      }
      if (decoded.byteLength !== expectedBytes) {
        throw new Error(`Packed content length mismatch: ${name}`);
      }

      if (
        decoded.byteLength <= MAX_DECODED_CACHE_BYTES
        && currentIndex?.generation === capturedGeneration
      ) {
        const previous = decodedCache.get(name);
        if (previous) decodedCacheBytes -= previous.byteLength;
        decodedCache.set(name, decoded);
        decodedCacheBytes += decoded.byteLength;
        while (decodedCacheBytes > MAX_DECODED_CACHE_BYTES && decodedCache.size > 1) {
          const oldest = decodedCache.entries().next().value as [string, Uint8Array] | undefined;
          if (!oldest) break;
          decodedCache.delete(oldest[0]);
          decodedCacheBytes -= oldest[1].byteLength;
        }
      }
      return decoded;
    })().finally(() => {
      if (decodedRequests.get(name) === request) decodedRequests.delete(name);
    });
    decodedRequests.set(name, request);
    return request;
  };

  const resolve = async (
    request: Request,
    env: PackedStaticEnv,
    force = false,
  ): Promise<ResolvedEntry | null> => {
    const url = new URL(request.url);
    const logicalPath = url.pathname.slice(1);
    const index = await loadIndex(request.url, env, force);
    if (!index) return null;
    const entry = index.entries.get(logicalPath);
    return entry ? { index, entry } : null;
  };

  return async function servePackedLogicalStatic(
    request: Request,
    env: PackedStaticEnv,
  ): Promise<Response | null> {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const url = new URL(request.url);
    const logicalPath = url.pathname.slice(1);
    const contentType = logicalStaticContentType(url.pathname);
    if (!contentType || url.pathname.includes("%")) return null;

    let initial: ResolvedEntry | null;
    try {
      const index = await loadIndex(request.url, env);
      if (!index) return null;
      initial = index.entries.has(logicalPath)
        ? { index, entry: index.entries.get(logicalPath) as PackedEntry }
        : await resolve(request, env, true);
    } catch {
      try {
        initial = await resolve(request, env, true);
      } catch {
        return unavailableResponse();
      }
    }
    if (!initial) return null;

    const [, initialPackRawBytes] = initial.index.packs[initial.entry.packNumber];
    const initialIsWholePack = initial.entry.offset === 0
      && initial.entry.length === initialPackRawBytes;
    const forceIdentity = url.searchParams.get("__em_identity") === "1";
    const encoding = forceIdentity ? "identity" : selectEncoding(request, initialIsWholePack);
    if (!encoding) {
      return new Response("No acceptable content encoding", {
        status: 406,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }

    const respond = async (resolved: ResolvedEntry): Promise<Response> => {
      const requestedVersion = requestedContentVersion(url);
      const questionRevisionApplies = questionDetailPath.test(logicalPath)
        && Boolean(resolved.index.questionDataRevision);
      let contentSha256 = resolved.entry.contentSha256;
      let versioned = false;
      if (requestedVersion) {
        if (questionRevisionApplies) {
          versioned = resolved.index.questionDataRevision === requestedVersion;
        } else {
          contentSha256 = await loadEntryDigest(
            request.url,
            env,
            resolved.index,
            resolved.entry,
          );
          versioned = contentSha256?.startsWith(requestedVersion) === true;
        }
      }
      const responseHeaders = new Headers({
        "cache-control": versioned
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      });
      const [, packRawBytes, packSha256] = resolved.index.packs[resolved.entry.packNumber];
      const etag = contentSha256
        ? `W/"sha256-${contentSha256}"`
        : versioned && questionRevisionApplies
          ? `W/"questions-${resolved.index.questionDataRevision}-${resolved.entry.packNumber}-${resolved.entry.offset}-${resolved.entry.length}"`
          : `W/"${packSha256}-${resolved.entry.offset}-${resolved.entry.length}"`;
      responseHeaders.set("etag", etag);
      appendVary(responseHeaders, "Accept-Encoding");
      if (encoding === "br") responseHeaders.set("content-encoding", "br");

      if (etagMatches(request, etag)) {
        return new Response(null, { status: 304, headers: responseHeaders });
      }
      if (request.method === "HEAD") {
        if (encoding === "identity") {
          responseHeaders.set("content-length", String(resolved.entry.length));
        }
        return new Response(null, { status: 200, headers: responseHeaders });
      }

      const isWholePack = resolved.entry.offset === 0 && resolved.entry.length === packRawBytes;
      if (encoding === "br" && isWholePack) {
        const compressed = await loadCompressedPack(
          request.url,
          env,
          resolved.index,
          resolved.entry.packNumber,
        );
        if (!compressed) throw new Error("Packed content asset is missing");
        responseHeaders.set("content-length", String(compressed.byteLength));
        return new Response(ownedArrayBuffer(compressed), {
          status: 200,
          headers: responseHeaders,
          encodeBody: "manual",
        } as ResponseInit & { encodeBody: "manual" });
      }

      const decoded = await loadDecodedPack(
        request.url,
        env,
        resolved.index,
        resolved.entry.packNumber,
      );
      if (!decoded) throw new Error("Packed content asset is missing");
      const logical = decoded.subarray(
        resolved.entry.offset,
        resolved.entry.offset + resolved.entry.length,
      );
      const body = encoding === "br" ? canonicalFastBrotli(logical) : logical;
      responseHeaders.set("content-length", String(body.byteLength));
      return new Response(ownedArrayBuffer(body), {
        status: 200,
        headers: responseHeaders,
        ...(encoding === "br" ? { encodeBody: "manual" as const } : {}),
      } as ResponseInit & { encodeBody?: "manual" });
    };

    try {
      return await respond(initial);
    } catch {
      try {
        const refreshed = await resolve(request, env, true);
        if (refreshed) return await respond(refreshed);
      } catch {
        // A bounded refresh was already attempted; the response below must not be cached.
        return unavailableResponse();
      }
      return unavailableResponse();
    }
  };
}
