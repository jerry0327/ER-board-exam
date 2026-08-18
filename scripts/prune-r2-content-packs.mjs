import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = path.resolve(process.argv[2] ?? "dist/client");
const markerPath = path.join(projectRoot, "public/r2-content-packs-migration-complete.json");
const indexPath = path.join(clientRoot, "content-packs/index.brp");
const packsRoot = path.join(clientRoot, "content-packs/packs");

if (!fs.existsSync(markerPath) || !fs.existsSync(indexPath) || !fs.existsSync(packsRoot)) {
  console.log("R2 content-pack pruning disabled: verified marker or built content packs are unavailable.");
  process.exit(0);
}

const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
if (marker?.schema !== "sites-managed-content-packs-migration-v1" || marker?.verified !== true || !Array.isArray(marker.packs)) {
  console.log("R2 content-pack pruning disabled: migration marker is invalid.");
  process.exit(0);
}
const indexBytes = fs.readFileSync(indexPath);
const indexSha256 = createHash("sha256").update(indexBytes).digest("hex");
if (marker.indexSha256 !== indexSha256) {
  console.log("R2 content-pack pruning disabled: current content index differs from the verified R2 migration.");
  process.exit(0);
}
const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(brotliDecompressSync(indexBytes)));
const packNames = index.p.map((row) => row[0]);
if (JSON.stringify(marker.packs) !== JSON.stringify(packNames)) {
  console.log("R2 content-pack pruning disabled: verified pack allowlist differs from current build.");
  process.exit(0);
}

const hotLogicalPaths = new Set([
  "data/explanation-packs/manifest.json",
  "data/index.json",
  "data/manifest.json",
  "data/search.json",
  "data/startup-index.json",
  "guides/links.json",
  "guides/manifest.json",
  "guides/rosens/manifest.json",
  "guides/tintinalli/manifest.json",
  "guides/ems/manifest.json",
  "guides/goldfrank/manifest.json",
  "subtitles-runtime/manifest.json",
]);
const hotPackNumbers = new Set();
for (const entry of index.e) {
  if (hotLogicalPaths.has(entry[0])) hotPackNumbers.add(entry[1]);
}

let removed = 0;
let removedBytes = 0;
let retained = 0;
for (let packNumber = 0; packNumber < index.p.length; packNumber += 1) {
  const name = index.p[packNumber][0];
  const file = path.join(packsRoot, name);
  if (!fs.existsSync(file)) continue;
  if (hotPackNumbers.has(packNumber)) {
    retained += 1;
    continue;
  }
  removedBytes += fs.statSync(file).size;
  fs.unlinkSync(file);
  removed += 1;
}
console.log(`R2 content-pack pruning enabled: removed ${removed} bulk packs (${removedBytes} bytes), retained ${retained} hot local packs.`);
