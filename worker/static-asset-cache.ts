const NO_BODY_STATUSES = new Set([204, 205, 304]);

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const HASHED_BUILD_ASSET_PATH =
  /^\/assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;
const VERSIONED_KATEX_FONT_PATH = /^\/fonts\/katex-0\.16\.22\/(?:[^/]+\/)*[^/]+$/u;
const WORKER_FIRST_STATIC_PATH = /^\/(?:assets|fonts\/katex-0\.16\.22)\//u;

interface StaticAssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export function isImmutableStaticAssetPath(pathname: string) {
  return HASHED_BUILD_ASSET_PATH.test(pathname) || VERSIONED_KATEX_FONT_PATH.test(pathname);
}

export function applyBuildAssetCachePolicy(request: Request, response: Response) {
  const pathname = new URL(request.url).pathname;
  if (
    (request.method !== "GET" && request.method !== "HEAD")
    || !isImmutableStaticAssetPath(pathname)
    || response.status !== 200
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  const noBody = request.method === "HEAD" || NO_BODY_STATUSES.has(response.status);
  return new Response(noBody ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function serveWorkerFirstStaticAsset(
  request: Request,
  assets: StaticAssetFetcher,
) {
  const pathname = new URL(request.url).pathname;
  if (
    (request.method !== "GET" && request.method !== "HEAD")
    || !WORKER_FIRST_STATIC_PATH.test(pathname)
  ) {
    return null;
  }

  return applyBuildAssetCachePolicy(request, await assets.fetch(request));
}
