import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(process.env.CI_ARTIFACT_ROOT ?? "dist");
const output = path.resolve(process.env.CI_ARTIFACT_OUT ?? "qa-artifact-audit.json");

async function walk(directory, files = []) {
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function category(relative) {
  if (relative.startsWith("client/content-packs/")) return "content-packs";
  if (relative.startsWith("client/learning-documents/")) return "learning-documents";
  if (relative.startsWith("client/assets/")) return "client-bundles";
  if (relative.startsWith("client/fonts/")) return "fonts";
  if (relative.startsWith("client/brand/") || /\.(?:png|jpe?g|webp|avif|svg|ico)$/iu.test(relative)) return "images-brand";
  if (relative.startsWith("server/")) return "server-worker";
  if (relative.startsWith(".openai/")) return "hosting-metadata";
  return "other-client-static";
}

function migrationClass(relative) {
  if (relative.startsWith("client/content-packs/packs/") || relative.startsWith("client/content-packs/digests/")) {
    return "r2-candidate-bulk-content";
  }
  if (relative.startsWith("client/content-packs/index.")) return "keep-startup-index";
  if (relative.startsWith("client/learning-documents/")) return "optional-r2-candidate";
  if (relative.startsWith("client/assets/") || relative.startsWith("server/") || relative.startsWith(".openai/")) {
    return "must-keep-deployment";
  }
  return "keep-or-review";
}

function compressible(relative) {
  return /\.(?:js|mjs|css|json|html|txt|xml|svg|webmanifest)$/iu.test(relative);
}

const files = await walk(root);
const rows = [];
for (const file of files) {
  const stats = await fs.stat(file);
  const relative = path.relative(root, file).split(path.sep).join("/");
  let gzip = null;
  let brotli = null;
  if (compressible(relative) && stats.size <= 8 * 1024 * 1024) {
    const bytes = await fs.readFile(file);
    gzip = zlib.gzipSync(bytes, { level: 9 }).byteLength;
    brotli = zlib.brotliCompressSync(bytes, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      },
    }).byteLength;
  }
  rows.push({
    path: relative,
    bytes: stats.size,
    category: category(relative),
    migrationClass: migrationClass(relative),
    gzip,
    brotli,
  });
}
rows.sort((a, b) => b.bytes - a.bytes);

const sumBy = (key) => Object.fromEntries(
  [...new Set(rows.map((row) => row[key]))].sort().map((name) => {
    const selected = rows.filter((row) => row[key] === name);
    return [name, {
      files: selected.length,
      bytes: selected.reduce((sum, row) => sum + row.bytes, 0),
      gzip: selected.reduce((sum, row) => sum + (row.gzip ?? 0), 0),
      brotli: selected.reduce((sum, row) => sum + (row.brotli ?? 0), 0),
    }];
  }),
);

const report = {
  generatedAt: new Date().toISOString(),
  root,
  totalFiles: rows.length,
  totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
  byCategory: sumBy("category"),
  byMigrationClass: sumBy("migrationClass"),
  largest: rows.slice(0, 100),
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  totalFiles: report.totalFiles,
  totalMiB: Math.round(report.totalBytes / 1024 / 1024 * 100) / 100,
  byCategory: Object.fromEntries(Object.entries(report.byCategory).map(([name, value]) => [
    name,
    Math.round(value.bytes / 1024 / 1024 * 100) / 100,
  ])),
  byMigrationClass: Object.fromEntries(Object.entries(report.byMigrationClass).map(([name, value]) => [
    name,
    Math.round(value.bytes / 1024 / 1024 * 100) / 100,
  ])),
}, null, 2));
