import { readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const rootIndex = process.argv.indexOf("--root");
const targetRoot = resolve(
  rootIndex >= 0 && process.argv[rootIndex + 1]
    ? process.argv[rootIndex + 1]
    : resolve(projectRoot, "dist/client"),
);

const forbiddenAudio = /\.(?:m4a|mp3|ogg|opus|snac|wav)(?:\.brp)?$/iu;
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (!entry.isFile() || !forbiddenAudio.test(entry.name)) continue;
    const info = await stat(absolute);
    violations.push({
      path: relative(targetRoot, absolute).replaceAll("\\", "/"),
      bytes: info.size,
    });
  }
}

await walk(targetRoot);
if (violations.length > 0) {
  throw new Error(
    `Deployment artifact contains ${violations.length} audio payload(s); `
    + `audio must remain in managed object storage: ${JSON.stringify(violations.slice(0, 20))}`,
  );
}

console.log(`Validated deployment audio boundary: ${targetRoot} contains manifests/references only.`);
