import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = path.join(projectRoot, "public/r2-content-packs-migration-complete.json");
const originArg = process.argv[2];
if (!originArg) throw new Error("Usage: node scripts/bootstrap-r2-content-packs.mjs https://origin");
const origin = new URL(originArg).origin;
const indexBytes = await fs.readFile(path.join(projectRoot, "public/content-packs/index.brp"));
const indexSha256 = createHash("sha256").update(indexBytes).digest("hex");
const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(brotliDecompressSync(indexBytes)));
if (!Array.isArray(index.p) || index.p.length < 1) throw new Error("Content-pack index has no packs");
const packs = index.p.map((row, rowIndex) => {
  if (!Array.isArray(row) || row.length !== 3) throw new Error(`Invalid pack row ${rowIndex}`);
  const [name, rawBytes, sha256] = row;
  if (
    typeof name !== "string"
    || !/^[a-f0-9]{64}\.brp$/u.test(name)
    || typeof sha256 !== "string"
    || name !== `${sha256}.brp`
    || !Number.isSafeInteger(rawBytes)
    || rawBytes <= 0
  ) throw new Error(`Invalid pack identity ${rowIndex}`);
  return { name, rawBytes, sha256 };
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchPack(pack, phase, index) {
  const url = new URL(`/content-packs/packs/${pack.name}`, origin);
  url.searchParams.set("__r2_probe", `${indexSha256.slice(0, 16)}-${phase}-${index}`);
  const response = await fetch(url, {
    headers: {
      "accept-encoding": "identity",
      "cache-control": "no-store",
    },
  });
  if (!response.ok) throw new Error(`${phase} failed (${response.status}) for ${pack.name}`);
  const storage = response.headers.get("x-content-pack-storage");
  const responseSha256 = response.headers.get("x-content-pack-sha256");
  if (responseSha256 !== pack.sha256) throw new Error(`${phase} header hash mismatch for ${pack.name}`);
  if (phase === "seed") {
    if (storage !== "r2" && storage !== "static-seeded") {
      throw new Error(`Seed did not persist to R2 for ${pack.name}: ${storage ?? "missing storage header"}`);
    }
  } else if (storage !== "r2") {
    throw new Error(`Verification did not read R2 for ${pack.name}: ${storage ?? "missing storage header"}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (digest(bytes) !== pack.sha256) throw new Error(`${phase} body hash mismatch for ${pack.name}`);
  return bytes.byteLength;
}

async function runPhase(phase, concurrency = 4) {
  let cursor = 0;
  let completed = 0;
  let transferredBytes = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= packs.length) return;
      transferredBytes += await fetchPack(packs[index], phase, index);
      completed += 1;
      if (completed % 20 === 0 || completed === packs.length) {
        console.log(`${phase}: ${completed}/${packs.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, packs.length) }, () => worker()));
  return transferredBytes;
}

const seededBytes = await runPhase("seed");
const verifiedBytes = await runPhase("verify");
const marker = {
  schema: "sites-managed-content-packs-migration-v1",
  verified: true,
  origin,
  indexSha256,
  packs: packs.map((pack) => pack.name),
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
console.log(JSON.stringify({
  verified: true,
  packs: packs.length,
  seededBytes,
  verifiedBytes,
  indexSha256,
  markerPath,
}, null, 2));
