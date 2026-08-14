import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { serveSemanticTimingSidecar } from "../worker/semantic-subtitle-sidecars.ts";

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixture(bytes = Buffer.from([0x48, 0x58, 0x4d, 0x32, 1, 0, 1, 2, 3, 4])) {
  const digest = hash(bytes);
  const pathname = `/subtitles-runtime/timing/${digest}.hxm`;
  return {
    bytes,
    digest,
    pathname,
    env: { ASSETS: { async fetch() { return new Response(bytes); } } },
  };
}

test("HXM identity sidecars require exact hash version and return immutable verified bytes", async () => {
  const data = fixture();
  const response = await serveSemanticTimingSidecar(new Request(
    `https://example.test${data.pathname}?v=${data.digest}`,
  ), data.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("etag"), `W/"sha256-${data.digest}"`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), data.bytes);
  const notModified = await serveSemanticTimingSidecar(new Request(
    `https://example.test${data.pathname}?v=${data.digest}`,
    { headers: { "if-none-match": `W/"sha256-${data.digest}"` } },
  ), data.env);
  assert.equal(notModified.status, 304);
});

test("HXM sidecar delivery fails closed for an omitted version or mismatched stored bytes", async () => {
  const data = fixture();
  const omitted = await serveSemanticTimingSidecar(new Request(`https://example.test${data.pathname}`), data.env);
  assert.equal(omitted.status, 404);
  const wrong = fixture(Buffer.from("wrong"));
  const mismatch = await serveSemanticTimingSidecar(new Request(
    `https://example.test${data.pathname}?v=${data.digest}`,
  ), wrong.env);
  assert.equal(mismatch.status, 503);
  assert.equal(mismatch.headers.get("cache-control"), "no-store");
});
