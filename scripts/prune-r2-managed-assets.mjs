import { access, lstat, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManagedAudioState,
  validateManagedAudioMarker,
} from "./lib/managed-audio-manifest.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = resolve(projectRoot, "public/audio/snac/r2-migration-complete.json");
const rootFlagIndex = process.argv.indexOf("--root");
if (rootFlagIndex >= 0 && !process.argv[rootFlagIndex + 1]) {
  throw new Error("--root requires a deployment artifact path");
}
const outputRoot = resolve(projectRoot, rootFlagIndex >= 0 ? process.argv[rootFlagIndex + 1] : "dist/client");
const expectedOutputRoot = resolve(projectRoot, "dist/client");
if (outputRoot !== expectedOutputRoot) {
  throw new Error(`Refusing to prune outside the exact deployment client root: ${expectedOutputRoot}`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!await exists(markerPath)) {
  console.log("R2 migration marker absent; retaining every packaged managed-audio fallback.");
  process.exit(0);
}

const [marker, hosting, state] = await Promise.all([
  readFile(markerPath, "utf8").then(JSON.parse),
  readFile(resolve(projectRoot, ".openai/hosting.json"), "utf8").then(JSON.parse),
  loadManagedAudioState(projectRoot),
]);
validateManagedAudioMarker(marker, { state, projectId: hosting.project_id });
const realOutputRoot = await realpath(outputRoot);

let removed = 0;
let removedBytes = 0;
for (const asset of state.assets) {
  const target = resolve(outputRoot, `.${asset.storedPath}`);
  if (!target.startsWith(`${outputRoot}${sep}`)) {
    throw new Error(`Managed asset escapes output root: ${asset.storedPath}`);
  }
  if (await exists(target)) {
    const [realParent, details] = await Promise.all([
      realpath(dirname(target)),
      lstat(target),
    ]);
    if (
      (realParent !== realOutputRoot && !realParent.startsWith(`${realOutputRoot}${sep}`))
      || !details.isFile()
      || details.isSymbolicLink()
    ) {
      throw new Error(`Refusing to prune a non-regular or escaped artifact: ${asset.storedPath}`);
    }
    await unlink(target);
    removed += 1;
    removedBytes += asset.storedBytes;
  }
}

for (const buildOnlyPath of [
  "/audio/snac/compression-manifest.json",
  "/static-snac/compression-manifest.json",
  "/audio/snac/r2-migration-complete.json",
]) {
  const target = resolve(outputRoot, `.${buildOnlyPath}`);
  if (!target.startsWith(`${outputRoot}${sep}`) || !await exists(target)) continue;
  const [realParent, details] = await Promise.all([
    realpath(dirname(target)),
    lstat(target),
  ]);
  if (
    (realParent !== realOutputRoot && !realParent.startsWith(`${realOutputRoot}${sep}`))
    || !details.isFile()
    || details.isSymbolicLink()
  ) {
    throw new Error(`Refusing to prune non-regular build metadata: ${buildOnlyPath}`);
  }
  await unlink(target);
}

console.log(`Pruned ${removed}/${state.assets.length} remotely verified R2 files (${removedBytes} bytes) from the deployment artifact.`);
