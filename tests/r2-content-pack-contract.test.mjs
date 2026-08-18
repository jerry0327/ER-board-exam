import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { brotliCompressSync } from "node:zlib";

import { handleContentPackOperator } from "../worker/content-pack-r2.ts";

const worker = fs.readFileSync(new URL("../worker/content-packs.ts", import.meta.url), "utf8");
const bridge = fs.readFileSync(new URL("../worker/content-pack-r2.ts", import.meta.url), "utf8");
const build = fs.readFileSync(new URL("../scripts/build-verified.sh", import.meta.url), "utf8");
const prune = fs.readFileSync(new URL("../scripts/prune-r2-content-packs.mjs", import.meta.url), "utf8");
const bootstrap = fs.readFileSync(new URL("../scripts/bootstrap-r2-content-packs.mjs", import.meta.url), "utf8");
const indexWorker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("content packs remain static-first with R2 fallback", () => {
  assert.match(worker, /const staticBytes = await fetchAssetBytes/u);
  assert.match(worker, /staticBytes \?\? await loadR2ContentPackBytes/u);
  assert.match(bridge, /managed-content\/v1\/packs\//u);
  assert.match(bridge, /await sha256Hex\(bytes\) !== expectedSha256/u);
});

test("immutable raw pack route seeds only index-bound verified bytes and then reads R2", async () => {
  const packBytes = new TextEncoder().encode("immutable-pack-fixture");
  const packSha256 = sha256(packBytes);
  const packName = `${packSha256}.brp`;
  const indexBytes = brotliCompressSync(Buffer.from(JSON.stringify({
    p: [[packName, 123, packSha256]],
  })));
  const stored = new Map();
  const assets = {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/content-packs/index.brp") return new Response(indexBytes);
      if (pathname === `/content-packs/packs/${packName}`) return new Response(packBytes);
      return new Response(null, { status: 404 });
    },
  };
  const bucket = {
    async get(key) {
      const value = stored.get(key);
      if (!value) return null;
      return {
        key,
        size: value.bytes.byteLength,
        customMetadata: value.customMetadata,
        async arrayBuffer() {
          return value.bytes.buffer.slice(value.bytes.byteOffset, value.bytes.byteOffset + value.bytes.byteLength);
        },
      };
    },
    async head(key) {
      const value = stored.get(key);
      return value ? { key, size: value.bytes.byteLength, customMetadata: value.customMetadata } : null;
    },
    async put(key, body, options) {
      const bytes = body instanceof Uint8Array
        ? body.slice()
        : new Uint8Array(await new Response(body).arrayBuffer());
      stored.set(key, { bytes, customMetadata: { ...options.customMetadata } });
      return { key };
    },
  };
  const env = { ASSETS: assets, BUCKET: bucket };
  const first = await handleContentPackOperator(
    new Request(`https://example.test/content-packs/packs/${packName}?__r2_probe=seed`),
    env,
  );
  assert(first);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("x-content-pack-storage"), "static-seeded");
  assert.equal(first.headers.get("x-content-pack-sha256"), packSha256);
  assert.equal(sha256(new Uint8Array(await first.arrayBuffer())), packSha256);
  assert.equal(stored.size, 1);

  const second = await handleContentPackOperator(
    new Request(`https://example.test/content-packs/packs/${packName}?__r2_probe=verify`),
    env,
  );
  assert(second);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-content-pack-storage"), "r2");
  assert.equal(second.headers.get("x-content-pack-sha256"), packSha256);
  assert.equal(sha256(new Uint8Array(await second.arrayBuffer())), packSha256);

  const unknownName = `${"0".repeat(64)}.brp`;
  const unknown = await handleContentPackOperator(
    new Request(`https://example.test/content-packs/packs/${unknownName}?__r2_probe=reject`),
    env,
  );
  assert(unknown);
  assert.equal(unknown.status, 404);
  assert.equal(stored.size, 1, "An unindexed hash must never create an R2 object");
});

test("tokenless bootstrap verifies every body from R2 before writing the migration marker", () => {
  assert.match(bootstrap, /phase === "seed"/u);
  assert.match(bootstrap, /storage !== "r2" && storage !== "static-seeded"/u);
  assert.match(bootstrap, /storage !== "r2"/u);
  assert.match(bootstrap, /body hash mismatch/u);
  assert.match(bootstrap, /sites-managed-content-packs-migration-v1/u);
  assert.match(bridge, /callers cannot supply keys or bytes/u);
  assert.match(bridge, /Packaged bytes failed verification|verifiedStaticPack/u);
});

test("bulk pruning is migration-gated and keeps hot paths local", () => {
  assert.match(prune, /migration marker is invalid/u);
  assert.match(prune, /current content index differs from the verified R2 migration/u);
  assert.match(prune, /data\/startup-index\.json/u);
  assert.match(prune, /data\/index\.json/u);
  assert.match(prune, /data\/search\.json/u);
  assert.match(build, /prune-r2-content-packs\.mjs/u);
});

test("title locales are served through compressed legacy static routing", () => {
  assert.match(indexWorker, /pathname\.startsWith\("\/subtitles-title-locales\/"\)/u);
  assert.match(build, /compress-section-title-locales\.mjs/u);
  assert.match(build, /prune-section-title-locales\.mjs/u);
});
