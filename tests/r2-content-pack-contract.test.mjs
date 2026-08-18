import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync(new URL("../worker/content-packs.ts", import.meta.url), "utf8");
const bridge = fs.readFileSync(new URL("../worker/content-pack-r2.ts", import.meta.url), "utf8");
const build = fs.readFileSync(new URL("../scripts/build-verified.sh", import.meta.url), "utf8");
const prune = fs.readFileSync(new URL("../scripts/prune-r2-content-packs.mjs", import.meta.url), "utf8");
const indexWorker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");

test("content packs remain static-first with R2 fallback", () => {
  assert.match(worker, /const staticBytes = await fetchAssetBytes/u);
  assert.match(worker, /staticBytes \?\? await loadR2ContentPackBytes/u);
  assert.match(bridge, /managed-content\/v1\/packs\//u);
  assert.match(bridge, /await sha256Hex\(bytes\) !== expectedSha256/u);
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
