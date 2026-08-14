import assert from "node:assert/strict";
import test from "node:test";
import {
  compressedStaticPath,
  fetchCompressedStatic,
} from "../app/lib/compressed-static.ts";

function decodedBrotliResponse(value, init = {}) {
  return new Response(value, {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": "999",
      "content-encoding": "br",
      ...(init.headers ?? {}),
    },
  });
}

async function withFetch(mock, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

test("keeps logical URLs stable while the Worker selects Brotli", () => {
  assert.equal(compressedStaticPath("/data/index.json"), "/data/index.json");
  assert.equal(compressedStaticPath("/guides/chapter.md?v=abc#section"), "/guides/chapter.md?v=abc#section");
});

test("accepts browser-decoded Brotli JSON while preserving request options and logical response headers", async () => {
  const calls = [];
  await withFetch(async (input, init) => {
    calls.push({ input: String(input), init });
    return decodedBrotliResponse(JSON.stringify({ title: "急診題庫" }), {
      statusText: "OK",
      headers: { "cache-control": "public, max-age=60" },
    });
  }, async () => {
    const response = await fetchCompressedStatic("/data/index.json?v=1", { cache: "force-cache" });
    assert.deepEqual(await response.json(), { title: "急診題庫" });
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  });
  assert.equal(calls[0].input, "/data/index.json?v=1");
  assert.equal(calls[0].init.cache, "force-cache");
});

test("accepts browser-decoded Markdown and restores its logical content type", async () => {
  await withFetch(async () => new Response("# 已解壓內容", {
    headers: {
      "content-type": "application/octet-stream",
      "content-encoding": "br",
      "content-length": "42",
    },
  }), async () => {
    const response = await fetchCompressedStatic("/guides/chapter.md");
    assert.equal(await response.text(), "# 已解壓內容");
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(response.headers.get("content-encoding"), null);
  });
});

test("restores the precision SRC NDJSON content type", async () => {
  await withFetch(async () => decodedBrotliResponse('{"schema":"precision-src-v2"}\n'), async () => {
    const response = await fetchCompressedStatic("/subtitles/goldfrank/goldfrank-CH001.src");
    assert.equal(await response.text(), '{"schema":"precision-src-v2"}\n');
    assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  });
});

test("retries once before rejecting a body that hosting failed to decode as UTF-8", async () => {
  const calls = [];
  await withFetch(async (input) => {
    calls.push(String(input));
    return new Response(Uint8Array.of(0xff, 0xfe, 0xfd));
  }, async () => {
    await assert.rejects(fetchCompressedStatic("/data/corrupt.json"));
  });
  assert.deepEqual(calls, ["/data/corrupt.json", "/data/corrupt.json?__em_identity=1"]);
});

test("recovers from a stale encoded browser cache entry", async () => {
  const calls = [];
  await withFetch(async (input, init) => {
    calls.push({ input: String(input), init });
    return calls.length === 1
      ? new Response(Uint8Array.of(0xff, 0xfe, 0xfd))
      : decodedBrotliResponse("# 已重新驗證");
  }, async () => {
    const response = await fetchCompressedStatic("/guides/chapter.md", { cache: "force-cache" });
    assert.equal(await response.text(), "# 已重新驗證");
  });
  assert.equal(calls[1].init.cache, "reload");
  assert.equal(calls[1].input, "/guides/chapter.md?__em_identity=1");
});

test("retries one transient Worker failure without changing the logical URL", async () => {
  const calls = [];
  await withFetch(async (input, init) => {
    calls.push({ input: String(input), init });
    return calls.length === 1
      ? new Response("retry", { status: 503 })
      : decodedBrotliResponse(JSON.stringify({ recovered: true }));
  }, async () => {
    const response = await fetchCompressedStatic("/guides/links.json", { cache: "force-cache" });
    assert.deepEqual(await response.json(), { recovered: true });
  });
  assert.deepEqual(calls.map(({ input }) => input), [
    "/guides/links.json",
    "/guides/links.json",
  ]);
  assert.equal(calls[0].init.cache, "force-cache");
  assert.equal(calls[1].init.cache, "reload");
});

test("returns failed HTTP responses untouched and propagates network failures", async () => {
  const failed = new Response("missing", { status: 404 });
  await withFetch(async () => failed, async () => {
    assert.strictEqual(await fetchCompressedStatic("/data/missing.json"), failed);
  });
  await withFetch(async () => {
    throw new Error("offline");
  }, async () => {
    await assert.rejects(fetchCompressedStatic("/data/index.json"), /offline/u);
  });
});
