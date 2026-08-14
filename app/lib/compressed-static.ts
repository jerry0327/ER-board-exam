function splitSuffix(value: string) {
  const hashIndex = value.indexOf("#");
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf("?");
  return {
    pathname: queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash,
    query: queryIndex >= 0 ? withoutHash.slice(queryIndex) : "",
    hash,
  };
}

export function compressedStaticPath(value: string) {
  return value;
}

function identityFallbackPath(value: string) {
  const { pathname, query, hash } = splitSuffix(value);
  return `${pathname}${query}${query ? "&" : "?"}__em_identity=1${hash}`;
}

function logicalContentType(value: string) {
  const { pathname } = splitSuffix(value);
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (pathname.endsWith(".src")) return "application/x-ndjson; charset=utf-8";
  return "application/octet-stream";
}

async function decodedLogicalResponse(response: Response, logicalPath: string) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("content-range");
  headers.set("content-type", logicalContentType(logicalPath));

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function decodedBinaryResponse(response: Response, logicalPath: string) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("content-range");
  headers.set("content-type", logicalContentType(logicalPath));
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchLogicalResponse(logicalPath: string, init?: RequestInit) {
  const path = compressedStaticPath(logicalPath);
  let response = await fetch(path, init);
  const method = init?.method?.toUpperCase() ?? "GET";
  if (
    (method === "GET" || method === "HEAD")
    && (response.status === 500 || response.status === 503)
  ) {
    response = await fetch(path, { ...init, cache: "reload" });
  }
  return { path, response, method };
}

/**
 * Fetches a stable logical JSON, Markdown, or precision SRC URL. The Worker resolves the
 * indexed Brotli representation and modern browsers transparently decode the
 * Content-Encoding response before JavaScript receives the body.
 */
export async function fetchCompressedStatic(logicalPath: string, init?: RequestInit) {
  const { path, response, method } = await fetchLogicalResponse(logicalPath, init);
  if (!response.ok) return response;

  try {
    return await decodedLogicalResponse(response, logicalPath);
  } catch (error) {
    if (method !== "GET") throw error;
    const refreshed = await fetch(identityFallbackPath(path), { ...init, cache: "reload" });
    if (!refreshed.ok) return refreshed;
    return decodedLogicalResponse(refreshed, logicalPath);
  }
}

/**
 * Fetches an indexed logical asset as bytes. This is for already-structured
 * binary payloads (such as HXT bundle members); text decoding must not be
 * applied before their own hash-bound decoder runs.
 */
export async function fetchCompressedStaticBytes(logicalPath: string, init?: RequestInit) {
  const { path, response, method } = await fetchLogicalResponse(logicalPath, init);
  if (!response.ok) return response;
  try {
    return await decodedBinaryResponse(response, logicalPath);
  } catch (error) {
    if (method !== "GET") throw error;
    const refreshed = await fetch(identityFallbackPath(path), { ...init, cache: "reload" });
    if (!refreshed.ok) return refreshed;
    return decodedBinaryResponse(refreshed, logicalPath);
  }
}
