/* Content-addressed identity delivery for opaque HXM timing sidecars. */

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const HXM_PATH = /^\/subtitles-runtime\/timing\/([a-f0-9]{64})\.hxm$/u;

export interface SemanticSubtitleSidecarEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copied));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function versionMatches(url: URL, sha256: string) {
  const versions = url.searchParams.getAll("v");
  return versions.length === 1 && versions[0] === sha256;
}

function etagMatches(request: Request, sha256: string) {
  const expected = `"sha256-${sha256}"`;
  return request.headers.get("if-none-match")?.split(",").some((candidate) => (
    candidate.trim().replace(/^W\//u, "") === expected || candidate.trim() === "*"
  )) ?? false;
}

function unavailable(message: string) {
  return new Response(message, {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "1",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * HXM is already compact/high entropy, so it is never sent through the text
 * Brotli pack. The filename and exact `?v=` must equal the SHA-256 of the
 * identity bytes; any mismatch fails closed before a decoder sees the data.
 */
export async function serveSemanticTimingSidecar(
  request: Request,
  env: SemanticSubtitleSidecarEnv,
) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const match = HXM_PATH.exec(url.pathname);
  if (!match) return null;
  const expectedSha256 = match[1];
  if (!versionMatches(url, expectedSha256)) {
    return new Response("Semantic subtitle sidecar requires its exact content version", {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const headers = new Headers(request.headers);
  headers.set("accept-encoding", "identity");
  headers.delete("range");
  headers.delete("if-range");
  const asset = await env.ASSETS.fetch(new Request(url, { method: "GET", headers }));
  if (asset.status === 404) return unavailable("Semantic subtitle sidecar is unavailable");
  if (!asset.ok) return asset;
  const bytes = new Uint8Array(await asset.arrayBuffer());
  if (await sha256Hex(bytes) !== expectedSha256) return unavailable("Semantic subtitle sidecar hash mismatch");
  const responseHeaders = new Headers({
    "cache-control": IMMUTABLE_CACHE_CONTROL,
    "content-type": "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "etag": `W/\"sha256-${expectedSha256}\"`,
    "x-content-type-options": "nosniff",
  });
  if (etagMatches(request, expectedSha256)) return new Response(null, { status: 304, headers: responseHeaders });
  return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers: responseHeaders });
}
