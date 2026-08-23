import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { publicRoot, rawFiles } from "./lib/static-content-codec.mjs";

const projectRoot = process.env.SITES_PROJECT_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const staticRoot = path.join(projectRoot, ".vercel", "output", "static");

if (!fs.existsSync(staticRoot)) {
  throw new Error(`Vercel static output is missing: ${staticRoot}`);
}

const logicalFiles = rawFiles(publicRoot);
if (!logicalFiles.length) {
  throw new Error("Vercel artifact validation requires expanded logical static content.");
}

const missing = [];
const mismatched = [];
let logicalBytes = 0;

for (const source of logicalFiles) {
  const relative = path.relative(publicRoot, source);
  const destination = path.join(staticRoot, relative);
  const sourceStat = fs.statSync(source);
  logicalBytes += sourceStat.size;
  if (!fs.existsSync(destination)) {
    missing.push(relative.split(path.sep).join("/"));
    continue;
  }
  const destinationStat = fs.statSync(destination);
  if (!destinationStat.isFile() || destinationStat.size !== sourceStat.size) {
    mismatched.push(relative.split(path.sep).join("/"));
  }
}

const requiredStartupFiles = [
  "data/manifest.json",
  "data/startup-index.json",
  "data/index.json",
  "guides/manifest.json",
  "subtitles-runtime/manifest.json",
];
for (const relative of requiredStartupFiles) {
  const target = path.join(staticRoot, ...relative.split("/"));
  if (!fs.existsSync(target) && !missing.includes(relative)) missing.push(relative);
}

if (missing.length || mismatched.length) {
  const details = [
    missing.length ? `missing=${missing.length}: ${missing.slice(0, 20).join(", ")}` : null,
    mismatched.length ? `size-mismatch=${mismatched.length}: ${mismatched.slice(0, 20).join(", ")}` : null,
  ].filter(Boolean).join("\n");
  throw new Error(`Incomplete Vercel static content artifact.\n${details}`);
}

console.log(
  `Validated Vercel static content database: ${logicalFiles.length} logical files, `
  + `${(logicalBytes / 1024 / 1024).toFixed(2)} MiB present in .vercel/output/static.`,
);
