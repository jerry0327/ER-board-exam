import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_MANAGED_AUDIO_ORIGIN,
  createManagedAudioMarker,
  loadManagedAudioState,
} from "./lib/managed-audio-manifest.mjs";
import {
  RetryableHttpError,
  isRetryableHttpStatus,
  withBoundedRetry,
} from "./lib/bounded-fetch-retry.mjs";
import { withFetchTimeout } from "./lib/fetch-with-timeout.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = resolve(projectRoot, "public/audio/snac/r2-migration-complete.json");
const markerPartPath = `${markerPath}.part`;
const argumentsList = process.argv.slice(2);
const tokenStdin = argumentsList.includes("--token-stdin");
const verifyOnly = argumentsList.includes("--verify-only");
const supportedFlags = new Set(["--token-stdin", "--verify-only"]);
const unknownFlags = argumentsList.filter((argument) => argument.startsWith("--") && !supportedFlags.has(argument));
const positionalArguments = argumentsList.filter((argument) => !argument.startsWith("--"));
if (unknownFlags.length || positionalArguments.length !== 1) {
  throw new Error(`Usage: node scripts/seed-r2-managed-assets.mjs ${EXPECTED_MANAGED_AUDIO_ORIGIN} [--token-stdin] [--verify-only]`);
}
const baseUrlArgument = positionalArguments[0];

function boundedPositiveIntegerEnvironment(name, fallback, maximum) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  if (!/^[1-9]\d*$/u.test(rawValue)) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

async function readTokenFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 4096) throw new Error("Operator token input is unexpectedly large");
  }
  value = value.replace(/\r?\n$/u, "");
  if (/[\r\n]/u.test(value)) throw new Error("Operator token input must contain exactly one line");
  return value;
}

if (tokenStdin && process.env.MANAGED_AUDIO_OPERATOR_TOKEN) {
  throw new Error("Choose either --token-stdin or MANAGED_AUDIO_OPERATOR_TOKEN, not both");
}
const token = tokenStdin
  ? await readTokenFromStdin()
  : process.env.MANAGED_AUDIO_OPERATOR_TOKEN;

if (!baseUrlArgument) {
  throw new Error(`Usage: node scripts/seed-r2-managed-assets.mjs ${EXPECTED_MANAGED_AUDIO_ORIGIN} [--token-stdin] [--verify-only]`);
}
const origin = new URL(baseUrlArgument).origin;
if (origin !== EXPECTED_MANAGED_AUDIO_ORIGIN || baseUrlArgument.replace(/\/$/u, "") !== origin) {
  throw new Error(`The managed-audio verifier is pinned to ${EXPECTED_MANAGED_AUDIO_ORIGIN}`);
}
if (!token || token.length < 32) {
  throw new Error("The operator token must be supplied via --token-stdin or MANAGED_AUDIO_OPERATOR_TOKEN and contain at least 32 characters.");
}

const hosting = JSON.parse(await readFile(resolve(projectRoot, ".openai/hosting.json"), "utf8"));
if (typeof hosting.project_id !== "string" || !hosting.project_id) {
  throw new Error("The Site project id is missing from .openai/hosting.json");
}
const state = await loadManagedAudioState(projectRoot);
const authorization = `Bearer ${token}`;
const seedUrl = new URL("/_ops/managed-audio/seed", origin);
const objectUrl = new URL("/_ops/managed-audio/object", origin);
const seedBatchSize = boundedPositiveIntegerEnvironment("MANAGED_AUDIO_SEED_BATCH_SIZE", 8, 8);
const seedBatchBytes = 10 * 1024 * 1024;
const seedConcurrency = boundedPositiveIntegerEnvironment("MANAGED_AUDIO_SEED_CONCURRENCY", 8, 8);
const verifyConcurrency = boundedPositiveIntegerEnvironment("MANAGED_AUDIO_VERIFY_CONCURRENCY", 16, 16);
const retryAttempts = boundedPositiveIntegerEnvironment("MANAGED_AUDIO_RETRY_ATTEMPTS", 5, 12);
const seedRequestTimeoutMs = 60_000;
const verifyRequestTimeoutMs = 120_000;

async function throwIfRetryableResponse(response) {
  if (!isRetryableHttpStatus(response.status)) return;
  const retryAfter = response.headers.get("retry-after");
  await response.body?.cancel().catch(() => {});
  throw new RetryableHttpError(response.status, { retryAfter });
}

function retryLogger(label) {
  return ({ nextAttempt, maxAttempts, delayMs, reason }) => {
    console.warn(`${label} received transient ${reason}; retrying attempt ${nextAttempt}/${maxAttempts} in ${delayMs} ms.`);
  };
}

// A failed or interrupted re-verification must leave the next build in the
// conservative static-fallback mode.
await Promise.all([
  unlink(markerPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  }),
  unlink(markerPartPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  }),
]);

if (!verifyOnly) {
  let seeded = 0;
  let seedCursor = 0;
  let nextSeedLog = 40;
  const seedBatches = [];
  let pendingBatch = [];
  let pendingBatchBytes = 0;
  for (const asset of state.assets) {
    if (
      pendingBatch.length > 0
      && (pendingBatch.length >= seedBatchSize || pendingBatchBytes + asset.storedBytes > seedBatchBytes)
    ) {
      seedBatches.push(pendingBatch);
      pendingBatch = [];
      pendingBatchBytes = 0;
    }
    pendingBatch.push(asset);
    pendingBatchBytes += asset.storedBytes;
  }
  if (pendingBatch.length) seedBatches.push(pendingBatch);

  async function seedWorker() {
    while (seedCursor < seedBatches.length) {
      const batchIndex = seedCursor;
      seedCursor += 1;
      const batch = seedBatches[batchIndex];
      const label = `R2 seed batch ${batchIndex + 1}/${seedBatches.length}`;
      await withBoundedRetry(async () => {
        await withFetchTimeout(seedRequestTimeoutMs, async (signal) => {
          const response = await fetch(seedUrl, {
            method: "POST",
            signal,
            headers: {
              "authorization": authorization,
              "content-type": "application/json",
            },
            body: JSON.stringify({ logicalPaths: batch.map((asset) => asset.logicalPath) }),
          });
          if (!response.ok) {
            await throwIfRetryableResponse(response);
            throw new Error(`Authenticated R2 seed failed (${response.status})`);
          }
          const result = await response.json();
          if (result.seeded !== batch.length) {
            throw new Error(`Authenticated R2 seed acknowledged ${result.seeded} of ${batch.length} objects`);
          }
        });
      }, {
        label,
        maxAttempts: retryAttempts,
        onRetry: retryLogger(label),
      });
      seeded += batch.length;
      while (seeded >= nextSeedLog) {
        console.log(`Seeded ${seeded}/${state.assets.length} allowlisted R2 objects.`);
        nextSeedLog += 40;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(seedConcurrency, seedBatches.length) }, seedWorker));
  if (seeded === state.assets.length) {
    console.log(`Seeded ${seeded}/${state.assets.length} allowlisted R2 objects.`);
  }
} else {
  console.log(`Verify-only mode: checking ${state.assets.length} existing R2 objects without reseeding.`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

let verifyCursor = 0;
let verified = 0;
async function verifyWorker() {
  while (verifyCursor < state.assets.length) {
    const entry = state.assets[verifyCursor];
    verifyCursor += 1;
    const url = new URL(objectUrl);
    url.searchParams.set("logicalPath", entry.logicalPath);
    const label = `R2 verification GET ${entry.logicalPath}`;
    await withBoundedRetry(async () => {
      await withFetchTimeout(verifyRequestTimeoutMs, async (signal) => {
        const response = await fetch(url, {
          signal,
          headers: {
            "accept-encoding": "identity",
            "authorization": authorization,
            "cache-control": "no-store",
          },
        });
        if (!response.ok) {
          await throwIfRetryableResponse(response);
          throw new Error(`Authenticated R2 GET failed (${response.status}): ${entry.logicalPath}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (
          response.headers.get("x-managed-asset-storage") !== "r2-operator"
          || response.headers.get("x-managed-asset-key") !== encodeURIComponent(entry.r2Key)
          || response.headers.get("x-managed-asset-sha256") !== entry.storedSha256
          || bytes.byteLength !== entry.storedBytes
          || sha256(bytes) !== entry.storedSha256
        ) {
          throw new Error(`Authenticated R2 GET hash/metadata mismatch: ${entry.logicalPath}`);
        }
      });
    }, {
      label,
      maxAttempts: retryAttempts,
      onRetry: retryLogger(label),
    });
    verified += 1;
    if (verified % 40 === 0 || verified === state.assets.length) {
      console.log(`Verified ${verified}/${state.assets.length} R2 objects by actual GET bytes.`);
    }
  }
}
await Promise.all(Array.from({ length: verifyConcurrency }, verifyWorker));

const marker = createManagedAudioMarker({
  state,
  origin,
  projectId: hosting.project_id,
});
await writeFile(markerPartPath, `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
await rename(markerPartPath, markerPath);
console.log(`Remote verification completed; wrote ${markerPath}.`);
