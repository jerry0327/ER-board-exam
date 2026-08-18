import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] ?? path.join(projectRoot, "public/subtitles-title-locales"));

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolute);
    }
  }
  return files.sort();
}

const files = walk(root);
if (!files.length) throw new Error(`No section-title locale JSON files found under ${root}`);
let rawBytes = 0;
let storedBytes = 0;
for (const file of files) {
  const raw = fs.readFileSync(file);
  const storedPath = `${file}.br`;
  if (!fs.existsSync(storedPath)) throw new Error(`Missing Brotli sidecar: ${storedPath}`);
  const stored = fs.readFileSync(storedPath);
  const decoded = brotliDecompressSync(stored, { maxOutputLength: Math.max(raw.length, 1) });
  if (!decoded.equals(raw)) throw new Error(`Brotli round-trip mismatch: ${file}`);
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  rawBytes += raw.length;
  storedBytes += stored.length;
}
if (storedBytes >= rawBytes) throw new Error("Section-title locale Brotli assets did not reduce storage.");
console.log(`Section-title locale compression audit passed: ${files.length} files, ${rawBytes} raw -> ${storedBytes} stored bytes.`);
