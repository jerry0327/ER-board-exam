import fs from "node:fs";
import path from "node:path";

const modules = [
  "app/site-foundation.css",
  "app/site-learning-library.css",
  "app/site-practice.css",
  "app/site-browse.css",
  "app/site-reader.css",
  "app/site-guide.css",
  "app/site-notes.css",
  "app/site-rest.css",
  "app/site-analytics.css",
  "app/site-responsive.css",
  "app/site-interactions.css"
];
const legacyAliases = [
  "stone",
  "paper",
  "paper-deep",
  "ink",
  "muted",
  "sage",
  "sage-pale",
  "oxblood",
  "oxblood-dark",
  "taupe",
  "line",
  "accent-fill",
  "on-accent",
  "surface-muted",
  "surface-raised",
  "surface-input",
  "surface-hover",
  "warning-bg",
  "warning-text",
  "paper-shadow",
  "paper-edge",
  "overlay-scrim",
  "overlay-panel-shadow",
  "drawer-panel-shadow",
  "bottom-sheet-shadow",
  "panel-radius",
  "page-max-width",
  "page-inner-width",
  "page-gutter",
  "page-top",
  "page-bottom",
  "motion-standard",
  "motion-enter",
  "serif",
  "sans"
];
const extensions = new Set([".css", ".ts", ".tsx", ".js", ".mjs"]);
function filesUnder(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else if (extensions.has(path.extname(entry.name))) result.push(full);
  }
  return result;
}
function reportFailure(failure) {
  const file = failure.match(/^([^ ]+\.(?:css|ts|tsx|js|mjs))\b/u)?.[1];
  const message = `CSS authority: ${failure}`.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(file ? `::error file=${file}::${message}` : `::error::${message}`);
  } else {
    console.error(message);
  }
}
const site = fs.readFileSync("app/site.css", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");
const failures = [];
if (fs.existsSync("app/globals.css")) failures.push("app/globals.css must remain retired");
if (site.includes("globals.css")) failures.push("app/site.css must not import globals.css");
const layoutCssImports = [...layout.matchAll(/import\s+["']([^"']+\.css)["'];?/gu)].map((match) => match[1]);
if (layoutCssImports.length !== 1 || layoutCssImports[0] !== "./site.css") failures.push(`app/layout.tsx RootLayout CSS entry must be only ./site.css; found: ${layoutCssImports.join(", ")}`);
let previousImportIndex = -1;
for (const modulePath of modules) {
  if (!fs.existsSync(modulePath)) { failures.push(`${modulePath} is missing`); continue; }
  const filename = modulePath.split("/").pop();
  const importStatement = `@import "./${filename}" layer(legacy);`;
  const importIndex = site.indexOf(importStatement);
  if (importIndex < 0) {
    failures.push(`app/site.css is missing ordered import for ${filename}`);
    continue;
  }
  if (importIndex <= previousImportIndex) failures.push(`app/site.css legacy module order changed at ${filename}`);
  previousImportIndex = importIndex;
}
const firstPostMigrationLegacyImport = site.indexOf('@import "./analytics-map.css" layer(legacy);');
if (firstPostMigrationLegacyImport < 0) failures.push("app/site.css analytics-map legacy import is missing");
else if (previousImportIndex >= firstPostMigrationLegacyImport) failures.push("app/site.css migrated site modules must remain before the existing feature legacy imports");
for (const file of filesUnder("app")) {
  const source = fs.readFileSync(file, "utf8");
  for (const alias of legacyAliases) {
    if (source.includes(`var(--${alias})`)) failures.push(`${file} still uses legacy token --${alias}`);
    if (source.includes(`--${alias}:`)) failures.push(`${file} still declares retired token --${alias}`);
  }
}
if (!site.includes("--site-page-top:") || !site.includes("--site-page-bottom:")) failures.push("app/site.css canonical page spacing tokens are missing");
for (const file of filesUnder("app")) {
  if (!file.endsWith(".css")) continue;
  const source = fs.readFileSync(file, "utf8");
  if (/font-family\s*:\s*[^;{}]*\bGeorgia\b[^;{}]*;/gu.test(source)) failures.push(`${file} bypasses --site-display with a direct Georgia font-family`);
}
if (fs.existsSync("tests")) {
  const retiredGlobalsRead = /(?:readFile|readFileSync)\s*\(\s*(?:new URL\(\s*)?["'][^"']*app\/globals\.css["']/u;
  for (const file of filesUnder("tests")) {
    const source = fs.readFileSync(file, "utf8");
    if (retiredGlobalsRead.test(source)) failures.push(`${file} still reads retired app/globals.css directly`);
  }
}
const bytes = Object.fromEntries(modules.map((modulePath) => [modulePath, fs.statSync(modulePath).size]));
console.log(JSON.stringify({ globalsRetired: !fs.existsSync("app/globals.css"), legacyAliasCount: legacyAliases.length, moduleBytes: bytes, totalMigratedBytes: Object.values(bytes).reduce((a,b)=>a+b,0) }, null, 2));
if (failures.length) {
  for (const failure of failures) reportFailure(failure);
  process.exit(1);
}
