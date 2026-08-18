import { brotliDecompressSync } from "node:zlib";

const INDEX_PATH = "/content-packs/index.brp";
const PACK_ROOT = "/content-packs/packs/";
const R2_NAMESPACE = "managed-content/v1/packs/";
const R2_SCHEMA = "sites-managed-content-pack-v1";
const SEED_PATH = "/_ops/content-packs/seed";
const OBJECT_PATH = "/_ops/content-packs/object";
const MAX_INDEX_RAW_BYTES = 4 * 1024 * 1024;
const MAX_PACK_COMPRESSED_BYTES = 33 * 1024 * 1024;
const SAFE_PACK = /^[a-f0-9]{64}\.brp$/u;

type PackRow = [name: string, rawBytes: number, sha256: string];

export interface ContentPackR2Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BUCKET?: R2Bucket;
  MANAGED_AUDIO_OPERATOR_TOKEN?: string;
}

async function sha256Hex(bytes: Uint8Array) {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", stable.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadPackRows(requestUrl: string, env: ContentPackR2Env) {
  const response = await env.ASSETS.fetch(new Request(new URL(INDEX_PATH, requestUrl), {
    headers: { "accept-encoding": "identity" },
  }));
  if (!response.ok) throw new Error(`Content-pack index unavailable (${response.status})`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const decoded = brotliDecompressSync(compressed, { maxOutputLength: MAX_INDEX_RAW_BYTES });
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as { p?: unknown };
  if (!Array.isArray(parsed.p)) throw new Error("Content-pack index is missing pack rows");
  const rows = parsed.p.map((value, index) => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`Invalid pack row ${index}`);
    const [name, rawBytes, sha256] = value;
    if (typeof name !== "string" || !SAFE_PACK.test(name) || typeof sha256 !== "string" || name !== `${sha256}.brp` || !Number.isSafeInteger(rawBytes) || rawBytes <= 0) {
      throw new Error(`Invalid content-pack identity ${index}`);
    }
    return [name, rawBytes, sha256] as PackRow;
  });
  return new Map(rows.map((row) => [row[0], row]));
}

export async function loadR2ContentPackBytes(
  requestUrl: string,
  env: ContentPackR2Env,
  name: string,
  expectedSha256: string,
) {
  if (!env.BUCKET || !SAFE_PACK.test(name) || name !== `${expectedSha256}.brp`) return null;
  try {
    const object = await env.BUCKET.get(`${R2_NAMESPACE}${name}`);
    if (!object || object.size > MAX_PACK_COMPRESSED_BYTES) return null;
    if (object.customMetadata?.schema !== R2_SCHEMA || object.customMetadata?.sha256 !== expectedSha256) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== object.size || await sha256Hex(bytes) !== expectedSha256) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function operatorTokenMatches(request: Request, env: ContentPackR2Env) {
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
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifiedStaticPack(request: Request, env: ContentPackR2Env, name: string, expectedSha256: string) {
  const response = await env.ASSETS.fetch(new Request(new URL(`${PACK_ROOT}${name}`, request.url), {
    headers: { "accept-encoding": "identity" },
  }));
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PACK_COMPRESSED_BYTES || await sha256Hex(bytes) !== expectedSha256) return null;
  return bytes;
}

export async function handleContentPackOperator(request: Request, env: ContentPackR2Env) {
  const url = new URL(request.url);
  if (url.pathname !== SEED_PATH && url.pathname !== OBJECT_PATH) return null;
  if (!await operatorTokenMatches(request, env)) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  if (!env.BUCKET) return Response.json({ error: "Managed object storage is unavailable." }, { status: 503 });

  const packs = await loadPackRows(request.url, env);
  if (url.pathname === SEED_PATH) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    let payload: { packNames?: unknown };
    try { payload = await request.json() as { packNames?: unknown }; } catch { return Response.json({ error: "Invalid JSON payload." }, { status: 400 }); }
    if (!Array.isArray(payload.packNames) || payload.packNames.length < 1 || payload.packNames.length > 8 || payload.packNames.some((name) => typeof name !== "string") || new Set(payload.packNames).size !== payload.packNames.length) {
      return Response.json({ error: "packNames must contain 1–8 unique allowlisted names." }, { status: 400 });
    }
    let storedBytes = 0;
    for (const name of payload.packNames as string[]) {
      const row = packs.get(name);
      if (!row) return Response.json({ error: `Pack is outside the signed index: ${name}` }, { status: 400 });
      const bytes = await verifiedStaticPack(request, env, row[0], row[2]);
      if (!bytes) return Response.json({ error: `Packaged bytes failed verification: ${name}` }, { status: 503 });
      await env.BUCKET.put(`${R2_NAMESPACE}${name}`, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { schema: R2_SCHEMA, sha256: row[2] },
      });
      storedBytes += bytes.byteLength;
    }
    return Response.json({ seeded: payload.packNames.length, storedBytes }, { headers: { "cache-control": "no-store" } });
  }

  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const name = url.searchParams.get("name") ?? "";
  const row = packs.get(name);
  if (!row) return new Response(null, { status: 404 });
  const object = request.method === "HEAD" ? await env.BUCKET.head(`${R2_NAMESPACE}${name}`) : await env.BUCKET.get(`${R2_NAMESPACE}${name}`);
  if (!object || object.customMetadata?.schema !== R2_SCHEMA || object.customMetadata?.sha256 !== row[2]) return Response.json({ error: "R2 object missing or invalid." }, { status: 503 });
  const headers = new Headers({
    "cache-control": "no-store",
    "content-length": String(object.size),
    "content-type": "application/octet-stream",
    "x-content-pack-key": encodeURIComponent(`${R2_NAMESPACE}${name}`),
    "x-content-pack-sha256": row[2],
    "x-content-pack-storage": "r2-operator",
  });
  if (request.method === "HEAD") return new Response(null, { headers });
  const bytes = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
  if (bytes.byteLength !== object.size || await sha256Hex(bytes) !== row[2]) return Response.json({ error: "R2 object bytes failed SHA-256 verification." }, { status: 502 });
  return new Response(bytes, { headers });
}
