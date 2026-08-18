import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(projectRoot, "public/subtitles-title-locales");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonFiles() {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolute);
    }
  }
  return files.sort();
}

const rows = [];
for (const file of jsonFiles()) {
  const raw = fs.readFileSync(file);
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  const stored = brotliCompressSync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_LGWIN]: Math.min(24, Math.max(22, Math.ceil(Math.log2(Math.max(1, raw.length))))),
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  const output = `${file}.br`;
  fs.writeFileSync(output, stored);
  rows.push({
    path: `/${path.relative(path.join(projectRoot, "public"), file).split(path.sep).join("/")}`,
    rawBytes: raw.length,
    storedBytes: stored.length,
    rawSha256: sha256(raw),
    storedSha256: sha256(stored),
  });
}

const rawBytes = rows.reduce((sum, row) => sum + row.rawBytes, 0);
const storedBytes = rows.reduce((sum, row) => sum + row.storedBytes, 0);
console.log(`Compressed section-title locales: ${rows.length} files, ${rawBytes} raw -> ${storedBytes} Brotli q11 bytes (${rawBytes ? (storedBytes / rawBytes * 100).toFixed(1) : "0.0"}%).`);
