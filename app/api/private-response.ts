const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "oai-authenticated-user-id",
} as const;

export function privateJson(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return Response.json(body, { ...init, headers });
}
