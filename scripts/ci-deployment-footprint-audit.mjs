import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "dist");
const outPath = path.resolve(process.argv[3] ?? "qa-deployment-footprint.json");

async function walk(dir) {
  const rows = [];
  async function visit(current) {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const stat = await fs.stat(full);
        rows.push({ path: path.relative(root, full).replaceAll("\\", "/"), bytes: stat.size });
      }
    }
  }
  await visit(dir);
  return rows;
}

function bucketFor(file) {
  const p = file.path;
  if (p.startsWith("client/content-packs/")) return "client/content-packs";
  if (p.startsWith("client/learning-documents/")) return "client/learning-documents";
  if (p.startsWith("client/audio/snac/") || p.startsWith("client/static-snac/")) return "client/managed-snac-runtime";
  if (p.startsWith("client/assets/")) {
    if (/\.js$/u.test(p)) return "client/assets-js";
    if (/\.css$/u.test(p)) return "client/assets-css";
    if (/\.(?:woff2?|ttf|otf)$/u.test(p)) return "client/assets-fonts";
    if (/\.(?:png|jpe?g|webp|avif|svg|gif|ico)$/u.test(p)) return "client/assets-images";
    return "client/assets-other";
  }
  if (p.startsWith("client/")) return "client/other";
  if (p.startsWith("server/")) return "server";
  if (p.startsWith(".openai/")) return ".openai";
  return "other";
}

const files = await walk(root);
const buckets = {};
for (const file of files) {
  const key = bucketFor(file);
  const bucket = buckets[key] ?? { files: 0, bytes: 0 };
  bucket.files += 1;
  bucket.bytes += file.bytes;
  buckets[key] = bucket;
}
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const topFiles = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 80);
const report = {
  root,
  generatedAt: new Date().toISOString(),
  totalFiles: files.length,
  totalBytes,
  totalMiB: Number((totalBytes / 1024 / 1024).toFixed(3)),
  buckets: Object.fromEntries(Object.entries(buckets)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .map(([key, value]) => [key, {
      ...value,
      mib: Number((value.bytes / 1024 / 1024).toFixed(3)),
      pct: totalBytes ? Number((value.bytes / totalBytes * 100).toFixed(2)) : 0,
    }])),
  topFiles: topFiles.map((file) => ({ ...file, mib: Number((file.bytes / 1024 / 1024).toFixed(3)) })),
};
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
