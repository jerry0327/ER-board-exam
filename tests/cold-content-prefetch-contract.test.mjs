import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  IMMUTABLE_CACHE_CONTROL,
  isImmutableStaticAssetPath,
  serveWorkerFirstStaticAsset,
} from "../worker/static-asset-cache.ts";

const files = {
  hook: await readFile(new URL("../app/hooks/use-visible-content-prefetch.ts", import.meta.url), "utf8"),
  guide: await readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  rosens: await readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  supplemental: await readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8"),
  reader: await readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  worker: await readFile(new URL("../worker/content-packs.ts", import.meta.url), "utf8"),
  workerEntry: await readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  viteConfig: await readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  headers: await readFile(new URL("../public/_headers", import.meta.url), "utf8"),
  questions: await readFile(new URL("../app/lib/question-data.ts", import.meta.url), "utf8"),
  codec: await readFile(new URL("../scripts/lib/static-content-codec.mjs", import.meta.url), "utf8"),
};

test("visible guide and question entries warm their versioned content before activation", () => {
  assert.match(files.hook, /IntersectionObserver/);
  assert.match(files.hook, /requestIdleCallback/);
  assert.match(files.hook, /data-content-prefetch/);
  for (const source of [files.guide, files.rosens, files.supplemental, files.reader]) {
    assert.match(source, /useVisibleContentPrefetch/);
    assert.match(source, /data-content-prefetch/);
    assert.match(source, /onPointerDown/);
    assert.match(source, /onPointerEnter/);
  }
  assert.match(files.questions, /retainQuestionDataRevision\(payload\.questionDataRevision\)/);
  assert.match(files.questions, /\?v=\$\{encodeURIComponent\(questionDataRevision\)\}/);
});

test("cold requests share pack decompression and immutable hashes reuse the browser cache", () => {
  assert.match(files.worker, /decodedRequests = new Map/);
  assert.match(files.worker, /const inFlight = decodedRequests\.get\(name\)/);
  assert.match(files.worker, /digestRequest/);
  assert.match(files.worker, /questionDetailPath\.test\(logicalPath\)/);
  assert.match(files.worker, /questionDataRevision === requestedVersion/);
  assert.match(files.worker, /contentSha256\?\.startsWith\(requestedVersion\)/);
  assert.match(files.worker, /max-age=31536000, immutable/);
});

test("8 MiB q11 packs let the 32 MiB decoded LRU retain several hot packs", () => {
  assert.match(files.codec, /contentPackTargetBytes = 8 \* 1024 \* 1024/);
  assert.match(files.worker, /MAX_DECODED_CACHE_BYTES = 32 \* 1024 \* 1024/);
  assert.match(files.codec, /brotliQuality = 11/);
  assert.match(files.codec, /BROTLI_PARAM_QUALITY\]: quality/);
});

test("versioned static assets are immutable through Sites headers and the Worker binding", async () => {
  assert.match(files.headers, /\/assets\/\*[\s\S]*?max-age=31536000, immutable/u);
  assert.match(files.headers, /\/fonts\/katex-0\.16\.22\/\*[\s\S]*?max-age=31536000, immutable/u);
  assert.doesNotMatch(files.headers, /^\/static-snac\/\*$/mu);
  assert.doesNotMatch(files.headers, /^\/audio\/snac\/\*$/mu);
  assert.doesNotMatch(files.headers, /^\/learning-documents\/\*$/mu);
  assert.match(files.headers, /\/audio\/snac\/catalog\.json[\s\S]*?no-cache, must-revalidate/u);
  assert.match(files.workerEntry, /applyBuildAssetCachePolicy/u);
  assert.match(files.workerEntry, /serveWorkerFirstStaticAsset\(request, env\.ASSETS\)/u);

  // Static assets otherwise bypass the Worker on Sites, so the fallback cache
  // policy above is only effective when this route is explicitly Worker-first.
  assert.match(
    files.viteConfig,
    /assets:\s*\{[\s\S]*?binding:\s*"ASSETS",[\s\S]*?run_worker_first:\s*\["\/assets\/\*", "\/fonts\/katex-0\.16\.22\/\*"\]/u,
  );

  assert.equal(isImmutableStaticAssetPath("/assets/account-session-CY5-g9bF.js"), true);
  assert.equal(isImmutableStaticAssetPath("/assets/chunks/runtime-aB_cD-12.css"), true);
  assert.equal(isImmutableStaticAssetPath("/assets/account-session.js"), false);
  assert.equal(
    isImmutableStaticAssetPath("/fonts/katex-0.16.22/KaTeX_AMS-Regular.woff2"),
    true,
  );

  const fetched = [];
  const assets = {
    async fetch(request) {
      fetched.push(new URL(request.url).pathname);
      return new Response(request.method === "HEAD" ? null : "static asset", {
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
      });
    },
  };

  for (const pathname of [
    "/assets/account-session-CY5-g9bF.js",
    "/fonts/katex-0.16.22/KaTeX_AMS-Regular.woff2",
  ]) {
    const response = await serveWorkerFirstStaticAsset(
      new Request(`https://example.test${pathname}`),
      assets,
    );
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
  }

  const unhashed = await serveWorkerFirstStaticAsset(
    new Request("https://example.test/assets/account-session.js"),
    assets,
  );
  assert.equal(unhashed?.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const head = await serveWorkerFirstStaticAsset(
    new Request("https://example.test/assets/account-session-CY5-g9bF.js", {
      method: "HEAD",
    }),
    assets,
  );
  assert.equal(head?.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
  assert.equal(head?.body, null);
  assert.equal(
    await serveWorkerFirstStaticAsset(
      new Request("https://example.test/fonts/unversioned/font.woff2"),
      assets,
    ),
    null,
  );
  assert.deepEqual(fetched, [
    "/assets/account-session-CY5-g9bF.js",
    "/fonts/katex-0.16.22/KaTeX_AMS-Regular.woff2",
    "/assets/account-session.js",
    "/assets/account-session-CY5-g9bF.js",
  ]);
});
