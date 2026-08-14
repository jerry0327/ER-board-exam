import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  RETRYABLE_HTTP_STATUSES,
  RetryableHttpError,
  isRetryableHttpStatus,
  withBoundedRetry,
} from "../scripts/lib/bounded-fetch-retry.mjs";
import {
  EXPECTED_MANAGED_AUDIO_ORIGIN,
  MANAGED_AUDIO_NAMESPACE,
  createManagedAudioMarker,
  loadManagedAudioState,
  validateManagedAudioMarker,
} from "../scripts/lib/managed-audio-manifest.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hosting = JSON.parse(await readFile(resolve(projectRoot, ".openai/hosting.json"), "utf8"));

test("managed audio manifests form an exact namespaced allowlist", async () => {
  const state = await loadManagedAudioState(projectRoot);
  assert.equal(state.assets.length, 2_875);
  assert.equal(new Set(state.assets.map((asset) => asset.logicalPath)).size, state.assets.length);
  assert.equal(new Set(state.assets.map((asset) => asset.r2Key)).size, state.assets.length);
  assert(state.assets.every((asset) => asset.r2Key.startsWith(MANAGED_AUDIO_NAMESPACE)));
  assert(state.assets.every((asset) => !asset.r2Key.includes("board-prep")));
  assert.match(state.assetsMerkleRoot, /^[a-f0-9]{64}$/u);
  assert.match(state.manifestSetSha256, /^[a-f0-9]{64}$/u);
});

test("generated Worker allowlist is bound to current canonical manifests", async () => {
  const [state, generated] = await Promise.all([
    loadManagedAudioState(projectRoot),
    readFile(resolve(projectRoot, "worker/managed-audio-manifest.generated.ts"), "utf8"),
  ]);
  assert(generated.includes(JSON.stringify(state.manifestSetSha256)));
  assert(generated.includes(JSON.stringify(state.assetsMerkleRoot)));
  assert.equal((generated.match(/managed-audio\/v1\//gu) ?? []).length, state.assets.length + 1);
});

test("slim marker validation rejects any changed origin, project, manifest, root or shape", async () => {
  const state = await loadManagedAudioState(projectRoot);
  const marker = createManagedAudioMarker({
    state,
    origin: EXPECTED_MANAGED_AUDIO_ORIGIN,
    projectId: hosting.project_id,
    verifiedAt: new Date("2026-08-02T00:00:00.000Z"),
  });
  assert.equal(validateManagedAudioMarker(marker, { state, projectId: hosting.project_id }), marker);

  for (const mutation of [
    (copy) => { copy.origin = "https://example.invalid"; },
    (copy) => { copy.projectId = "another-site"; },
    (copy) => { copy.manifestSetSha256 = "0".repeat(64); },
    (copy) => { copy.assetsMerkleRoot = "0".repeat(64); },
    (copy) => { copy.assets += 1; },
    (copy) => { copy.unexpected = true; },
  ]) {
    const copy = structuredClone(marker);
    mutation(copy);
    assert.throws(
      () => validateManagedAudioMarker(copy, { state, projectId: hosting.project_id }),
      /R2 migration/u,
    );
  }
});

test("authenticated verifier hashes actual GET bytes before creating a marker", async () => {
  const source = await readFile(resolve(projectRoot, "scripts/seed-r2-managed-assets.mjs"), "utf8");
  const verifySection = source.slice(source.indexOf("async function verifyWorker"));
  assert(verifySection.includes("await response.arrayBuffer()"));
  assert(verifySection.includes("sha256(bytes) !== entry.storedSha256"));
  assert(verifySection.includes('response.headers.get("x-managed-asset-key") !== encodeURIComponent(entry.r2Key)'));
  assert(verifySection.indexOf("await response.arrayBuffer()") < verifySection.indexOf("createManagedAudioMarker"));
  assert(!verifySection.includes('method: "HEAD"'));
  assert(source.includes('argumentsList.includes("--token-stdin")'));
  assert(source.includes('argumentsList.includes("--verify-only")'));
  assert(source.includes('new Set(["--token-stdin", "--verify-only"])'));
  assert(source.includes("!supportedFlags.has(argument)"));
  assert.equal((source.match(/\[--token-stdin\] \[--verify-only\]/gu) ?? []).length, 2);
  assert(source.includes("await readTokenFromStdin()"));
  assert.equal((source.match(/await withBoundedRetry\(async \(\) =>/gu) ?? []).length, 2);
  assert(source.includes("await throwIfRetryableResponse(response)"));
  assert(source.includes('boundedPositiveIntegerEnvironment("MANAGED_AUDIO_VERIFY_CONCURRENCY", 16, 16)'));
  assert(source.includes('boundedPositiveIntegerEnvironment("MANAGED_AUDIO_SEED_BATCH_SIZE", 8, 8)'));
  assert(source.includes('boundedPositiveIntegerEnvironment("MANAGED_AUDIO_SEED_CONCURRENCY", 8, 8)'));
  assert(source.includes('boundedPositiveIntegerEnvironment("MANAGED_AUDIO_RETRY_ATTEMPTS", 5, 12)'));
  assert.equal((source.match(/maxAttempts: retryAttempts/gu) ?? []).length, 2);
  assert(source.includes("if (!/^[1-9]\\d*$/u.test(rawValue))"));
  assert(source.includes("withFetchTimeout(seedRequestTimeoutMs, async (signal) =>"));
  assert(source.includes("withFetchTimeout(verifyRequestTimeoutMs, async (signal) =>"));
  assert(source.includes("const verifyRequestTimeoutMs = 120_000"));
  assert.equal((source.match(/const response = await fetch\(/gu) ?? []).length, 2);
  assert.equal((source.match(/signal,/gu) ?? []).length, 2);
  assert(!source.includes("await response.text()"));
  assert(!source.includes("console.log(token)"));

  const markerRemoval = source.indexOf("await Promise.all([");
  const verifyOnlyGuard = source.indexOf("if (!verifyOnly)");
  const seedPost = source.indexOf('method: "POST"');
  const verification = source.indexOf("async function verifyWorker");
  const markerCreation = source.indexOf("createManagedAudioMarker({", verification);
  assert(markerRemoval < verifyOnlyGuard);
  assert(verifyOnlyGuard < seedPost);
  assert(seedPost < verification);
  assert(verification < markerCreation);
});

test("managed audio retries only bounded network and retryable HTTP failures", async () => {
  assert.deepEqual(RETRYABLE_HTTP_STATUSES, [408, 425, 429, 500, 502, 503, 504]);
  for (const status of RETRYABLE_HTTP_STATUSES) assert.equal(isRetryableHttpStatus(status), true);
  for (const status of [400, 401, 403, 404, 409, 422, 501]) assert.equal(isRetryableHttpStatus(status), false);

  let attempts = 0;
  const delays = [];
  const retryEvents = [];
  const result = await withBoundedRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    if (attempts === 2) throw new TypeError("fetch failed");
    if (attempts === 3) throw new RetryableHttpError(502);
    return "verified";
  }, {
    label: "test request",
    maxAttempts: 4,
    baseDelayMs: 10,
    maxDelayMs: 100,
    sleep: async (delayMs) => delays.push(delayMs),
    onRetry: (event) => retryEvents.push(event),
  });

  assert.equal(result, "verified");
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [10, 20, 40]);
  assert.deepEqual(retryEvents.map(({ reason }) => reason), ["network error", "network error", "HTTP 502"]);
});

test("managed audio retry stays fail-closed for permanent and exhausted failures", async () => {
  const hashMismatch = new Error("Authenticated R2 GET hash/metadata mismatch");
  let permanentAttempts = 0;
  await assert.rejects(
    withBoundedRetry(async () => {
      permanentAttempts += 1;
      throw hashMismatch;
    }, { sleep: async () => {} }),
    (error) => error === hashMismatch,
  );
  assert.equal(permanentAttempts, 1);

  const delays = [];
  const sensitiveMessage = "Bearer should-never-be-printed";
  await assert.rejects(
    withBoundedRetry(async () => {
      throw new TypeError(sensitiveMessage);
    }, {
      label: "verification GET",
      maxAttempts: 3,
      baseDelayMs: 5,
      maxDelayMs: 20,
      sleep: async (delayMs) => delays.push(delayMs),
    }),
    (error) => {
      assert.equal(error.message, "verification GET failed after 3 attempts (network error)");
      assert.equal(error.message.includes(sensitiveMessage), false);
      return true;
    },
  );
  assert.deepEqual(delays, [5, 10]);
});
