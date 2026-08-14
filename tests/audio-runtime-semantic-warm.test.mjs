import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldBackgroundWarmRuntimeSemanticManifest,
  warmRuntimeSemanticManifest,
} from "../app/lib/audio-runtime-semantic-warm.ts";

const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function highCapabilityEnvironment() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hardwareConcurrency: 8, deviceMemory: 8, connection: { effectiveType: "4g", saveData: false } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: false }) },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible" },
  });
}

function restoreEnvironment() {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
}

function manifest() {
  const hash = "a".repeat(64);
  return {
    schema: "subtitle-runtime-semantic-manifest-v2",
    codec: "subtitle-runtime-semantic-hxt-hxm-v2",
    generated_at: "2026-08-13T00:00:00Z",
    terminal_unavailable_sha256: null,
    counts: { collection_count: 1, pair_count: 1, cue_count: 2, chapter_count: 2, by_collection: { goldfrank: 1 }, hxt_bytes: 11, hxm_bytes: 12 },
    bundles: [{ path: `bundles/${hash}.hxtb`, sha256: hash, bytes: 11, member_count: 1 }],
    entries: [{
      collection: "goldfrank", source: "goldfrank/fixture.src", source_sha256: hash, chapters_sha256: hash,
      profile: "textbook-study", cue_count: 2, chapter_count: 2, duration: "00:00:02.000",
      hxt_bundle: `bundles/${hash}.hxtb`, hxt_offset: 0, hxt_bytes: 11, hxt_sha256: hash,
      hxm: `timing/${hash}.hxm`, hxm_sha256: hash, hxm_bytes: 12,
    }],
  };
}

test("semantic manifest warmup only requests the manifest and fails silently", async () => {
  try {
    highCapabilityEnvironment();
    assert.equal(shouldBackgroundWarmRuntimeSemanticManifest(), true);
    const calls = [];
    const value = manifest();
    assert.equal(await warmRuntimeSemanticManifest({
      fetch: async (url, init) => {
        calls.push([String(url), init]);
        return new Response(`${JSON.stringify(value, null, 2)}\n`);
      },
    }), true);
    assert.deepEqual(calls, [["/subtitles-runtime/manifest.json", { cache: "force-cache" }]]);
    assert.equal(await warmRuntimeSemanticManifest({ fetch: async () => { throw new Error("offline"); } }), false);
  } finally {
    restoreEnvironment();
  }
});

test("semantic manifest warmup respects save-data, 2g, and low-memory guards", async () => {
  try {
    highCapabilityEnvironment();
    globalThis.navigator.connection.saveData = true;
    assert.equal(shouldBackgroundWarmRuntimeSemanticManifest(), false);
    let requested = false;
    assert.equal(await warmRuntimeSemanticManifest({ fetch: async () => { requested = true; return new Response(); } }), false);
    assert.equal(requested, false);
    globalThis.navigator.connection.saveData = false;
    globalThis.navigator.connection.effectiveType = "2g";
    assert.equal(shouldBackgroundWarmRuntimeSemanticManifest(), false);
    globalThis.navigator.connection.effectiveType = "4g";
    globalThis.navigator.deviceMemory = 2;
    assert.equal(shouldBackgroundWarmRuntimeSemanticManifest(), false);
  } finally {
    restoreEnvironment();
  }
});

test("semantic manifest warmup remains available to capable mobile browsers without deviceMemory", () => {
  try {
    highCapabilityEnvironment();
    delete globalThis.navigator.deviceMemory;
    globalThis.navigator.hardwareConcurrency = 6;
    globalThis.window.matchMedia = () => ({ matches: true });
    assert.equal(shouldBackgroundWarmRuntimeSemanticManifest(), true);
  } finally {
    restoreEnvironment();
  }
});
