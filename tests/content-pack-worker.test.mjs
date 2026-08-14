import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from "node:zlib";
import { createPackedStaticHandler } from "../worker/content-packs.ts";

function q11(bytes) {
  return new Uint8Array(brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixture({ version = 3 } = {}) {
  const first = Buffer.from(JSON.stringify({ title: "第一題", explanation: "完整詳解" }), "utf8");
  const second = Buffer.from(JSON.stringify({ title: "第二題", explanation: "精要詳解" }), "utf8");
  const guide = Buffer.from(`# 學習指引\n\n${"完整內容。".repeat(40)}`, "utf8");
  const sharedRaw = Buffer.concat([first, second]);
  const shared = q11(sharedRaw);
  const singleton = q11(guide);
  const sharedHash = sha256(shared);
  const singletonHash = sha256(singleton);
  const firstHash = sha256(first);
  const secondHash = sha256(second);
  const guideHash = sha256(guide);
  const digestBytes = Buffer.concat([
    Buffer.from(firstHash, "hex"),
    Buffer.from(secondHash, "hex"),
    Buffer.from(guideHash, "hex"),
  ]);
  const digestHash = sha256(digestBytes);
  const entries = version === 2
    ? [
        ["data/a.json", 0, 0, first.length, firstHash],
        ["data/b.json", 0, first.length, second.length, secondHash],
        ["guides/c.md", 1, 0, guide.length, guideHash],
      ]
    : [
        ["data/a.json", 0, 0, first.length],
        ["data/b.json", 0, first.length, second.length],
        ["guides/c.md", 1, 0, guide.length],
      ];
  const index = q11(Buffer.from(JSON.stringify({
    v: version,
    t: 1024 * 1024,
    p: [
      [`${sharedHash}.brp`, sharedRaw.length, sharedHash],
      [`${singletonHash}.brp`, guide.length, singletonHash],
    ],
    ...(version === 3 ? { d: [`${digestHash}.bin`, digestBytes.length, digestHash] } : {}),
    e: entries,
  }), "utf8"));

  const sharedPath = `/content-packs/packs/${sharedHash}.brp`;
  const singletonPath = `/content-packs/packs/${singletonHash}.brp`;
  const digestPath = `/content-packs/digests/${digestHash}.bin`;
  const assets = new Map([
    ["/content-packs/index.brp", index],
    [sharedPath, shared],
    [singletonPath, singleton],
    ...(version === 3 ? [[digestPath, digestBytes]] : []),
  ]);
  const calls = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        calls.push({ pathname, encoding: request.headers.get("accept-encoding") });
        const bytes = assets.get(pathname);
        return bytes
          ? new Response(bytes, { headers: { "content-type": "application/octet-stream" } })
          : new Response("missing", { status: 404 });
      },
    },
  };
  return {
    assets,
    calls,
    env,
    first,
    firstHash,
    second,
    secondHash,
    guide,
    guideHash,
    digestBytes,
    digestPath,
    shared,
    singleton,
    sharedPath,
    singletonPath,
  };
}

function questionRevisionFixture() {
  const question = Buffer.from(JSON.stringify({ id: "115B-Q200", answerKeys: ["B"] }), "utf8");
  const guide = Buffer.from("# 指引\n\n版本化內容", "utf8");
  const questionPack = q11(question);
  const guidePack = q11(guide);
  const questionPackHash = sha256(questionPack);
  const guidePackHash = sha256(guidePack);
  const questionHash = sha256(question);
  const guideHash = sha256(guide);
  const questionDataRevision = "a".repeat(64);
  const digestBytes = Buffer.concat([
    Buffer.from(questionHash, "hex"),
    Buffer.from(guideHash, "hex"),
  ]);
  const digestHash = sha256(digestBytes);
  const digestPath = `/content-packs/digests/${digestHash}.bin`;
  const index = q11(Buffer.from(JSON.stringify({
    v: 3,
    t: 1024 * 1024,
    s: 1024 * 1024,
    p: [
      [`${questionPackHash}.brp`, question.length, questionPackHash],
      [`${guidePackHash}.brp`, guide.length, guidePackHash],
    ],
    d: [`${digestHash}.bin`, digestBytes.length, digestHash],
    q: questionDataRevision,
    e: [
      ["data/questions/115B/115B-Q200.json", 0, 0, question.length],
      ["guides/c.md", 1, 0, guide.length],
    ],
  }), "utf8"));
  const assets = new Map([
    ["/content-packs/index.brp", index],
    [`/content-packs/packs/${questionPackHash}.brp`, questionPack],
    [`/content-packs/packs/${guidePackHash}.brp`, guidePack],
    [digestPath, digestBytes],
  ]);
  const calls = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        calls.push(pathname);
        const bytes = assets.get(pathname);
        return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
      },
    },
  };
  return {
    assets,
    calls,
    env,
    digestPath,
    guideHash,
    questionHash,
    questionDataRevision,
  };
}

function subtitleFixture() {
  const chapters = Buffer.from(JSON.stringify({ schema: "subtitle-chapters-v1", chapters: [] }), "utf8");
  const source = Buffer.from('{"schema":"precision-src-v2"}\n{"start":"00:00:00.000","end":"00:00:01.000","speaker":"A","text":"內容"}\n', "utf8");
  const raw = Buffer.concat([chapters, source]);
  const compressed = q11(raw);
  const packHash = sha256(compressed);
  const chapterHash = sha256(chapters);
  const sourceHash = sha256(source);
  const index = q11(Buffer.from(JSON.stringify({
    v: 2,
    t: 1024 * 1024,
    s: 1024 * 1024,
    p: [[`${packHash}.brp`, raw.length, packHash]],
    e: [
      ["subtitles/goldfrank/goldfrank-CH001.chapters.json", 0, 0, chapters.length, chapterHash],
      ["subtitles/goldfrank/goldfrank-CH001.src", 0, chapters.length, source.length, sourceHash],
    ],
  }), "utf8"));
  const assets = new Map([
    ["/content-packs/index.brp", index],
    [`/content-packs/packs/${packHash}.brp`, compressed],
  ]);
  return {
    chapters,
    chapterHash,
    source,
    sourceHash,
    env: {
      ASSETS: {
        async fetch(request) {
          const bytes = assets.get(new URL(request.url).pathname);
          return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
        },
      },
    },
  };
}

async function responseBytes(response) {
  return new Uint8Array(await response.arrayBuffer());
}

test("the Worker serves shared records at unchanged logical URLs with Brotli or identity", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();

  const compressed = await serve(new Request(`https://example.test/data/a.json?v=${data.firstHash.slice(0, 20)}`, {
    headers: { "accept-encoding": "gzip, br, identity;q=0" },
  }), data.env);
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(compressed.headers.get("content-encoding"), "br");
  assert.equal(compressed.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(Buffer.from(brotliDecompressSync(await responseBytes(compressed))), data.first);

  const identity = await serve(new Request("https://example.test/data/b.json", {
    headers: { "accept-encoding": "br;q=0, identity" },
  }), data.env);
  assert.equal(identity.headers.get("content-encoding"), null);
  assert.deepEqual(Buffer.from(await responseBytes(identity)), data.second);
  assert.equal(identity.headers.get("cache-control"), "public, max-age=0, must-revalidate");

  assert.equal(data.calls.filter(({ pathname }) => pathname === "/content-packs/index.brp").length, 1);
  assert.ok(data.calls.every(({ encoding }) => encoding === "identity"));
});

test("the Worker serves compact chapters and precision SRC from the subtitle namespace", async () => {
  const data = subtitleFixture();
  const serve = createPackedStaticHandler();
  const chapters = await serve(new Request(
    `https://example.test/subtitles/goldfrank/goldfrank-CH001.chapters.json?v=${data.chapterHash}`,
  ), data.env);
  assert.equal(chapters.status, 200);
  assert.equal(chapters.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(Buffer.from(await responseBytes(chapters)), data.chapters);

  const source = await serve(new Request(
    `https://example.test/subtitles/goldfrank/goldfrank-CH001.src?v=${data.sourceHash}`,
  ), data.env);
  assert.equal(source.status, 200);
  assert.equal(source.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.equal(source.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(Buffer.from(await responseBytes(source)), data.source);
});

test("the Worker streams a semantic HXT bundle as one hash-addressed q11 asset", async () => {
  const bundleName = `${"a".repeat(64)}.hxtb`;
  const bundle = Buffer.from("HXT2\nH\t{\"schema\":\"precision-src-v2\"}\nP\t\"textbook-study\"\nT\t\"cue\"\nL\t\"導論\"\n", "utf8");
  const manifest = Buffer.from(JSON.stringify({ schema: "subtitle-runtime-semantic-manifest-v2" }), "utf8");
  const bundlePacked = q11(bundle);
  const manifestPacked = q11(manifest);
  const bundlePackHash = sha256(bundlePacked);
  const manifestPackHash = sha256(manifestPacked);
  const bundleHash = sha256(bundle);
  const manifestHash = sha256(manifest);
  const index = q11(Buffer.from(JSON.stringify({
    v: 2,
    t: 1024 * 1024,
    s: 1024 * 1024,
    p: [
      [`${bundlePackHash}.brp`, bundle.length, bundlePackHash],
      [`${manifestPackHash}.brp`, manifest.length, manifestPackHash],
    ],
    e: [
      [`subtitles-runtime/bundles/${bundleName}`, 0, 0, bundle.length, bundleHash],
      ["subtitles-runtime/manifest.json", 1, 0, manifest.length, manifestHash],
    ],
  }), "utf8"));
  const assets = new Map([
    ["/content-packs/index.brp", index],
    [`/content-packs/packs/${bundlePackHash}.brp`, bundlePacked],
    [`/content-packs/packs/${manifestPackHash}.brp`, manifestPacked],
  ]);
  const env = { ASSETS: { async fetch(request) {
    const bytes = assets.get(new URL(request.url).pathname);
    return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
  } } };
  const serve = createPackedStaticHandler();
  const response = await serve(new Request(
    `https://example.test/subtitles-runtime/bundles/${bundleName}?v=${bundleHash}`,
    { headers: { "accept-encoding": "br" } },
  ), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("content-encoding"), "br");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(Buffer.from(brotliDecompressSync(await responseBytes(response))), bundle);
});

test("v3 loads the full-digest sidecar only for an entry-version check", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();

  const unversioned = await serve(new Request("https://example.test/data/a.json"), data.env);
  assert.equal(unversioned.status, 200);
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.digestPath).length, 0);

  const versioned = await serve(new Request(`https://example.test/guides/c.md?v=${data.guideHash}`), data.env);
  assert.equal(versioned.status, 200);
  assert.equal(versioned.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.digestPath).length, 1);

  const repeated = await serve(new Request(`https://example.test/data/a.json?v=${data.firstHash}`), data.env);
  assert.equal(repeated.status, 200);
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.digestPath).length, 1);
});

test("continues to read a v2 index with inline entry digests", async () => {
  const data = fixture({ version: 2 });
  const serve = createPackedStaticHandler();
  const response = await serve(new Request(`https://example.test/data/a.json?v=${data.firstHash}`), data.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(data.calls.some(({ pathname }) => pathname.includes("/digests/")), false);
});

test("question corpus revisions are path-scoped and reject mismatched or duplicate versions", async () => {
  const data = questionRevisionFixture();
  const serve = createPackedStaticHandler();
  const questionUrl = "https://example.test/data/questions/115B/115B-Q200.json";

  const exact = await serve(new Request(`${questionUrl}?v=${data.questionDataRevision}`), data.env);
  assert.equal(exact.status, 200);
  assert.equal(exact.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(data.calls.filter((path) => path === data.digestPath).length, 0);

  const mismatch = await serve(new Request(`${questionUrl}?v=${"b".repeat(64)}`), data.env);
  assert.equal(mismatch.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const perEntry = await serve(new Request(`${questionUrl}?v=${data.questionHash}`), data.env);
  assert.equal(perEntry.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const duplicate = await serve(new Request(
    `${questionUrl}?v=${data.questionDataRevision}&v=${data.questionDataRevision}`,
  ), data.env);
  assert.equal(duplicate.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(data.calls.filter((path) => path === data.digestPath).length, 0);

  const wrongPath = await serve(new Request(
    `https://example.test/guides/c.md?v=${data.questionDataRevision}`,
  ), data.env);
  assert.equal(wrongPath.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(data.calls.filter((path) => path === data.digestPath).length, 1);
});

test("a missing digest sidecar fails closed only when an entry version needs it", async () => {
  const data = fixture();
  data.assets.delete(data.digestPath);
  const serve = createPackedStaticHandler();

  const unversioned = await serve(new Request("https://example.test/guides/c.md"), data.env);
  assert.equal(unversioned.status, 200);
  const versioned = await serve(new Request(`https://example.test/guides/c.md?v=${data.guideHash}`), data.env);
  assert.equal(versioned.status, 503);
  assert.equal(versioned.headers.get("cache-control"), "no-store");
});

test("only a version that matches the indexed entry digest receives immutable caching", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();

  const exact = await serve(new Request(`https://example.test/guides/c.md?v=${data.guideHash}`, {
    headers: { "accept-encoding": "identity" },
  }), data.env);
  assert.equal(exact.status, 200);
  assert.equal(exact.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const mismatch = await serve(new Request(`https://example.test/guides/c.md?v=${"f".repeat(16)}`, {
    headers: { "accept-encoding": "identity" },
  }), data.env);
  assert.equal(mismatch.status, 200);
  assert.equal(mismatch.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.deepEqual(Buffer.from(await responseBytes(mismatch)), data.guide);

  const duplicated = await serve(new Request(
    `https://example.test/guides/c.md?v=${data.guideHash}&v=${data.guideHash}`,
    { headers: { "accept-encoding": "identity" } },
  ), data.env);
  assert.equal(duplicated.headers.get("cache-control"), "public, max-age=0, must-revalidate");
});

test("whole-record singleton packs stream their stored q11 body without recompression", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/guides/c.md?v=guide", {
    headers: { "accept-encoding": "br" },
  }), data.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), "br");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.deepEqual(await responseBytes(response), data.singleton);
  assert.deepEqual(Buffer.from(brotliDecompressSync(data.singleton)), data.guide);
});

test("a logical identity fallback survives a proxy that cannot forward Brotli metadata", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/guides/c.md?__em_identity=1", {
    headers: { "accept-encoding": "br" },
  }), data.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.deepEqual(Buffer.from(await responseBytes(response)), data.guide);
});

test("HEAD and If-None-Match avoid loading a content pack", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const head = await serve(new Request("https://example.test/data/a.json", {
    method: "HEAD",
    headers: { "accept-encoding": "identity" },
  }), data.env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(data.first.length));
  assert.equal(data.calls.filter(({ pathname }) => pathname.includes("/packs/")).length, 0);

  const etag = head.headers.get("etag");
  const notModified = await serve(new Request("https://example.test/data/a.json", {
    headers: { "if-none-match": etag },
  }), data.env);
  assert.equal(notModified.status, 304);
  assert.equal((await responseBytes(notModified)).length, 0);
  assert.equal(data.calls.filter(({ pathname }) => pathname.includes("/packs/")).length, 0);
});

test("unknown logical content falls through to the legacy resolver", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  assert.equal(await serve(new Request("https://example.test/data/missing.json"), data.env), null);
  assert.equal(await serve(new Request("https://example.test/assets/app.js"), data.env), null);
});

test("concurrent records in one cold pack share a single fetch and decode", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const [first, second] = await Promise.all([
    serve(new Request("https://example.test/data/a.json"), data.env),
    serve(new Request("https://example.test/data/b.json"), data.env),
  ]);
  assert.deepEqual(Buffer.from(await responseBytes(first)), data.first);
  assert.deepEqual(Buffer.from(await responseBytes(second)), data.second);
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.sharedPath).length, 1);
});

test("a stale or corrupt content-addressed pack is retried once and fails closed", async () => {
  const data = fixture();
  const corrupted = Uint8Array.from(data.assets.get(data.sharedPath));
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  data.assets.set(data.sharedPath, corrupted);
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/data/a.json"), data.env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "Content temporarily unavailable");
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.sharedPath).length, 2);
  assert.equal(data.calls.filter(({ pathname }) => pathname === "/content-packs/index.brp").length, 2);
});

test("a missing indexed pack refreshes the index once and then returns 503", async () => {
  const data = fixture();
  data.assets.delete(data.sharedPath);
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/data/a.json"), data.env);
  assert.equal(response.status, 503);
  assert.equal(data.calls.filter(({ pathname }) => pathname === "/content-packs/index.brp").length, 2);
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.sharedPath).length, 2);
});

test("a stale index switches to a refreshed index and serves the same request", async () => {
  const data = fixture();
  const indexPath = "/content-packs/index.brp";
  const freshIndex = data.assets.get(indexPath);
  const staleHash = "a".repeat(64);
  const stalePackPath = `/content-packs/packs/${staleHash}.brp`;
  const staleIndex = q11(Buffer.from(JSON.stringify({
    v: 1,
    t: 1024 * 1024,
    s: 1024 * 1024,
    p: [[`${staleHash}.brp`, data.first.length, staleHash]],
    e: [["data/a.json", 0, 0, data.first.length]],
  }), "utf8"));
  let indexFetches = 0;
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        data.calls.push({ pathname, encoding: request.headers.get("accept-encoding") });
        if (pathname === indexPath) {
          indexFetches += 1;
          return new Response(indexFetches === 1 ? staleIndex : freshIndex);
        }
        const bytes = data.assets.get(pathname);
        return bytes
          ? new Response(bytes)
          : new Response("missing", { status: 404 });
      },
    },
  };

  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/data/a.json"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await responseBytes(response)), data.first);
  assert.equal(indexFetches, 2);
  assert.equal(data.calls.filter(({ pathname }) => pathname === stalePackPath).length, 1);
  assert.equal(data.calls.filter(({ pathname }) => pathname === data.sharedPath).length, 1);
});

test("a transiently missing bootstrap index is not cached as a permanent miss", async () => {
  const data = fixture();
  const indexPath = "/content-packs/index.brp";
  const index = data.assets.get(indexPath);
  data.assets.delete(indexPath);
  const serve = createPackedStaticHandler();
  assert.equal(await serve(new Request("https://example.test/data/a.json"), data.env), null);

  data.assets.set(indexPath, index);
  const recovered = await serve(new Request("https://example.test/data/a.json"), data.env);
  assert.equal(recovered.status, 200);
  assert.deepEqual(Buffer.from(await responseBytes(recovered)), data.first);
  assert.equal(data.calls.filter(({ pathname }) => pathname === indexPath).length, 2);
});

test("identity HEAD and weak If-None-Match preserve representation headers without loading a pack", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const head = await serve(new Request("https://example.test/data/a.json", {
    method: "HEAD",
    headers: { "accept-encoding": "br" },
  }), data.env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-encoding"), null);
  assert.equal(head.headers.get("content-length"), String(data.first.length));

  const strongEquivalent = head.headers.get("etag").replace(/^W\//u, "");
  const notModified = await serve(new Request("https://example.test/data/a.json", {
    headers: {
      "accept-encoding": "br",
      "if-none-match": strongEquivalent,
    },
  }), data.env);
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("content-encoding"), null);
  assert.equal(data.calls.filter(({ pathname }) => pathname.includes("/packs/")).length, 0);
});

test("a client that rejects both Brotli and identity receives 406 without loading a pack", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/data/a.json", {
    headers: { "accept-encoding": "br;q=0, identity;q=0" },
  }), data.env);
  assert.equal(response.status, 406);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(data.calls.filter(({ pathname }) => pathname.includes("/packs/")).length, 0);
});

test("Accept-Encoding quality values prefer identity when it has the higher quality", async () => {
  const data = fixture();
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/data/a.json", {
    headers: { "accept-encoding": "br;q=0.1, identity;q=1" },
  }), data.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.deepEqual(Buffer.from(await responseBytes(response)), data.first);
});

test("runtime index limits reject an oversized raw pack before fetching it", async () => {
  const data = fixture();
  const hash = "a".repeat(64);
  data.assets.set("/content-packs/index.brp", q11(Buffer.from(JSON.stringify({
    v: 1,
    t: 32 * 1024 * 1024,
    s: 1024 * 1024,
    p: [[`${hash}.brp`, 32 * 1024 * 1024 + 1, hash]],
    e: [["data/a.json", 0, 0, 32 * 1024 * 1024 + 1]],
  }), "utf8")));
  const serve = createPackedStaticHandler();
  const response = await serve(new Request("https://example.test/data/a.json"), data.env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(data.calls.filter(({ pathname }) => pathname.includes("/packs/")).length, 0);
});

test("a failed pack load can recover on a later request in the same isolate", async () => {
  const data = fixture();
  const valid = data.assets.get(data.sharedPath);
  const corrupted = Uint8Array.from(valid);
  corrupted[0] ^= 0xff;
  data.assets.set(data.sharedPath, corrupted);
  const serve = createPackedStaticHandler();
  assert.equal(
    (await serve(new Request("https://example.test/data/a.json"), data.env)).status,
    503,
  );

  data.assets.set(data.sharedPath, valid);
  const recovered = await serve(new Request("https://example.test/data/a.json"), data.env);
  assert.equal(recovered.status, 200);
  assert.deepEqual(Buffer.from(await responseBytes(recovered)), data.first);
});
