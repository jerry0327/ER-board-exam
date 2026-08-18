import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = path.join(projectRoot, "public/r2-content-packs-migration-complete.json");
const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify-only");
const baseArg = args.find((value) => !value.startsWith("--"));
const token = process.env.MANAGED_AUDIO_OPERATOR_TOKEN;
if (!baseArg || !token || token.length < 32) throw new Error("Usage: MANAGED_AUDIO_OPERATOR_TOKEN=... node scripts/seed-r2-content-packs.mjs https://origin [--verify-only]");
const origin = new URL(baseArg).origin;
const indexBytes = await fs.readFile(path.join(projectRoot, "public/content-packs/index.brp"));
const indexSha256 = createHash("sha256").update(indexBytes).digest("hex");
const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(brotliDecompressSync(indexBytes))) as { p: [string, number, string][] };
const packs = index.p.map(([name, rawBytes, sha256]) => ({ name, rawBytes, sha256 }));
const authorization = `Bearer ${token}`;

if (!verifyOnly) {
  for (let offset = 0; offset < packs.length; offset += 8) {
    const batch = packs.slice(offset, offset + 8);
    const response = await fetch(new URL("/_ops/content-packs/seed", origin), {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ packNames: batch.map((pack) => pack.name) }),
    });
    if (!response.ok) throw new Error(`R2 seed failed (${response.status}) at batch ${offset / 8 + 1}`);
    const result = await response.json();
    if (result.seeded !== batch.length) throw new Error("R2 seed acknowledgement mismatch");
    console.log(`Seeded ${Math.min(offset + batch.length, packs.length)}/${packs.length} content packs.`);
  }
}

for (let index = 0; index < packs.length; index += 1) {
  const pack = packs[index];
  const url = new URL("/_ops/content-packs/object", origin);
  url.searchParams.set("name", pack.name);
  const response = await fetch(url, { headers: { authorization, "accept-encoding": "identity", "cache-control": "no-store" } });
  if (!response.ok) throw new Error(`R2 verification failed (${response.status}): ${pack.name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (response.headers.get("x-content-pack-storage") !== "r2-operator" || response.headers.get("x-content-pack-sha256") !== pack.sha256 || digest !== pack.sha256) {
    throw new Error(`R2 verification mismatch: ${pack.name}`);
  }
  if ((index + 1) % 25 === 0 || index + 1 === packs.length) console.log(`Verified ${index + 1}/${packs.length} content packs.`);
}

const marker = {
  schema: "sites-managed-content-packs-migration-v1",
  verified: true,
  origin,
  indexSha256,
  packs: packs.map((pack) => pack.name),
  verifiedAt: new Date().toISOString(),
};
await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
console.log(`R2 content-pack migration verified; wrote ${markerPath}.`);
