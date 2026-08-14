import path from "node:path";
import process from "node:process";
import {
  auditCompressedRoot,
  formatBytes,
  publicRoot,
} from "./lib/static-content-codec.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少路徑`);
  return path.resolve(value);
}

const root = argumentValue("--root") ?? publicRoot;
const compare = argumentValue("--compare");
const audited = auditCompressedRoot(root, compare);
console.log(
  `Compressed content audit passed: ${audited.files} files in ${audited.packs} indexed packs, `
  + `${formatBytes(audited.logicalBytes)} logical → ${formatBytes(audited.storedBytes)} stored`,
);
