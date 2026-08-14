import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import {
  contentPackDirectoryName,
  logicalContentEntries,
} from "./lib/static-content-codec.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenToken = ["page", "find"].join("");
const sourceRoots = ["app", "build", "db", "drizzle", "scripts", "tests", "worker"];
const generatedRoots = ["public", "dist"];
const contentFiles = [
  "package.json",
  "package-lock.json",
  "README.md",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "vite.config.ts",
  ".openai/hosting.json",
];
const violations = [];

function walk(relativeRoot, inspectContent) {
  const absoluteRoot = path.join(projectRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    const relative = path.join(relativeRoot, entry.name);
    const absolute = path.join(projectRoot, relative);
    if (relative.toLocaleLowerCase().includes(forbiddenToken)) violations.push(`${relative}（路徑）`);
    if (entry.isDirectory() && entry.name === contentPackDirectoryName) continue;
    // Audio models, WebAssembly, and chapter packets are audited byte-for-byte
    // by audit-audio-runtime.mjs. Reading them as UTF-8 is expensive and can
    // produce meaningless text matches.
    const normalizedRelative = relative.replaceAll("\\", "/");
    if (
      entry.isDirectory()
      && [
        "public/static-snac",
        "public/audio/snac",
        "dist/client/static-snac",
        "dist/client/audio/snac",
      ].includes(normalizedRelative)
    ) {
      continue;
    }
    if (entry.isDirectory()) walk(relative, inspectContent);
    else if (inspectContent) {
      const bytes = fs.readFileSync(absolute);
      const text = relative.endsWith(".br") ? brotliDecompressSync(bytes).toString("utf8") : bytes.toString("utf8");
      if (text.toLocaleLowerCase().includes(forbiddenToken)) violations.push(`${relative}（內容）`);
    }
  }
}

for (const relative of sourceRoots) walk(relative, true);
for (const relative of generatedRoots) {
  walk(relative, true);
  const absolute = path.join(projectRoot, relative);
  if (fs.existsSync(path.join(absolute, contentPackDirectoryName))) {
    for (const [logicalPath, bytes] of logicalContentEntries(absolute)) {
      if (bytes.toString("utf8").toLocaleLowerCase().includes(forbiddenToken)) {
        violations.push(`${path.join(relative, logicalPath)}（內容）`);
      }
    }
  }
}
for (const relative of contentFiles) {
  const absolute = path.join(projectRoot, relative);
  if (fs.existsSync(absolute) && fs.readFileSync(absolute, "utf8").toLocaleLowerCase().includes(forbiddenToken)) violations.push(`${relative}（內容）`);
}

if (violations.length) {
  console.error(`偵測到永久禁用的靜態全文索引模組：\n- ${violations.join("\n- ")}`);
  process.exit(1);
}

console.log("Static full-text index policy passed.");
