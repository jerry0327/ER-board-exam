import fs from "node:fs";

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
const aliases = [
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
  "motion-standard",
  "motion-enter",
  "serif",
  "sans"
];
const site = fs.readFileSync("app/site.css", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");
const failures = [];
if (fs.existsSync("app/globals.css")) failures.push("app/globals.css must remain retired");
if (site.includes("globals.css")) failures.push("site.css must not import globals.css");
if (!layout.includes('import "./site.css"')) failures.push("RootLayout must keep site.css as the runtime style entry");
for (const modulePath of modules) {
  if (!fs.existsSync(modulePath)) { failures.push(`Missing CSS module: ${modulePath}`); continue; }
  const source = fs.readFileSync(modulePath, "utf8");
  const filename = modulePath.split("/").pop();
  if (!site.includes(`@import "./${filename}" layer(legacy);`)) failures.push(`site.css missing ordered import for ${filename}`);
  for (const alias of aliases) {
    if (source.includes(`var(--${alias})`)) failures.push(`${modulePath} still uses legacy token --${alias}`);
  }
}
const bytes = Object.fromEntries(modules.map((modulePath) => [modulePath, fs.statSync(modulePath).size]));
console.log(JSON.stringify({ globalsRetired: !fs.existsSync("app/globals.css"), moduleBytes: bytes, totalMigratedBytes: Object.values(bytes).reduce((a,b)=>a+b,0) }, null, 2));
if (failures.length) { for (const failure of failures) console.error(`CSS authority: ${failure}`); process.exit(1); }
