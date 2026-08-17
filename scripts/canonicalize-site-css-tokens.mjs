import fs from "node:fs";
import path from "node:path";

const aliases = new Map([
  ["stone", "site-canvas"], ["paper", "site-paper"], ["paper-deep", "site-paper-soft"],
  ["ink", "site-ink"], ["muted", "site-muted"], ["sage", "site-success"], ["sage-pale", "site-success-soft"],
  ["oxblood", "site-primary"], ["oxblood-dark", "site-primary-strong"], ["taupe", "site-line-strong"], ["line", "site-line"],
  ["accent-fill", "site-primary-fill"], ["on-accent", "site-on-primary"], ["surface-muted", "site-surface-muted"],
  ["surface-raised", "site-surface-raised"], ["surface-input", "site-surface-input"], ["surface-hover", "site-surface-hover"],
  ["warning-bg", "site-warning-soft"], ["warning-text", "site-warning"], ["paper-shadow", "site-shadow-low"],
  ["paper-edge", "site-line"], ["overlay-scrim", "site-scrim"], ["overlay-panel-shadow", "site-shadow-overlay"],
  ["drawer-panel-shadow", "site-shadow-drawer"], ["bottom-sheet-shadow", "site-shadow-sheet"], ["panel-radius", "site-panel-radius"],
  ["page-max-width", "site-max"], ["page-inner-width", "site-max"], ["page-gutter", "site-gutter"],
  ["page-top", "site-page-top"], ["page-bottom", "site-page-bottom"],
  ["motion-standard", "site-ease"], ["motion-enter", "site-ease"], ["serif", "site-display"], ["sans", "site-sans"],
]);

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

const appFiles = filesUnder("app");
const counts = Object.fromEntries([...aliases.keys()].map((alias) => [alias, 0]));
for (const file of appFiles) {
  let source = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const [legacy, canonical] of aliases) {
    const needle = `var(--${legacy})`;
    const occurrences = source.split(needle).length - 1;
    if (!occurrences) continue;
    counts[legacy] += occurrences;
    source = source.replaceAll(needle, `var(--${canonical})`);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, source);
}

let site = fs.readFileSync("app/site.css", "utf8");
const gutterNeedle = "    --site-gutter: clamp(24px, 4vw, 72px);\n";
if (!site.includes("--site-page-top:")) {
  if (!site.includes(gutterNeedle)) throw new Error("site.css gutter token anchor not found");
  site = site.replace(gutterNeedle, `${gutterNeedle}    --site-page-top: clamp(36px, 4vw, 68px);\n    --site-page-bottom: clamp(90px, 9vw, 150px);\n`);
}
const aliasStart = "    /* Compatibility aliases for frozen structural modules. */\n";
const aliasEnd = "    --sans: var(--site-sans);\n";
const start = site.indexOf(aliasStart);
const end = site.indexOf(aliasEnd, start);
if (start < 0 || end < 0) throw new Error("site.css compatibility alias block not found");
site = site.slice(0, start) + site.slice(end + aliasEnd.length);
fs.writeFileSync("app/site.css", site);

const modules = [
  "app/site-foundation.css", "app/site-learning-library.css", "app/site-practice.css", "app/site-browse.css",
  "app/site-reader.css", "app/site-guide.css", "app/site-notes.css", "app/site-rest.css",
  "app/site-analytics.css", "app/site-responsive.css", "app/site-interactions.css",
];
const audit = `import fs from "node:fs";\nimport path from "node:path";\n\nconst modules = ${JSON.stringify(modules, null, 2)};\nconst legacyAliases = ${JSON.stringify([...aliases.keys()], null, 2)};\nconst extensions = new Set([".css", ".ts", ".tsx", ".js", ".mjs"]);\nfunction filesUnder(dir) {\n  const result = [];\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const full = path.join(dir, entry.name);\n    if (entry.isDirectory()) result.push(...filesUnder(full));\n    else if (extensions.has(path.extname(entry.name))) result.push(full);\n  }\n  return result;\n}\nconst site = fs.readFileSync("app/site.css", "utf8");\nconst layout = fs.readFileSync("app/layout.tsx", "utf8");\nconst failures = [];\nif (fs.existsSync("app/globals.css")) failures.push("app/globals.css must remain retired");\nif (site.includes("globals.css")) failures.push("site.css must not import globals.css");\nconst layoutCssImports = [...layout.matchAll(/import\\s+[\"']([^\"']+\\.css)[\"'];?/gu)].map((match) => match[1]);\nif (layoutCssImports.length !== 1 || layoutCssImports[0] !== "./site.css") failures.push(\`RootLayout CSS entry must be only ./site.css; found: \${layoutCssImports.join(", ")}\`);\nfor (const modulePath of modules) {\n  if (!fs.existsSync(modulePath)) { failures.push(\`Missing CSS module: \${modulePath}\`); continue; }\n  const filename = modulePath.split("/").pop();\n  if (!site.includes(\`@import "./\${filename}" layer(legacy);\`)) failures.push(\`site.css missing ordered import for \${filename}\`);\n}\nfor (const file of filesUnder("app")) {\n  const source = fs.readFileSync(file, "utf8");\n  for (const alias of legacyAliases) {\n    if (source.includes(\`var(--\${alias})\`)) failures.push(\`\${file} still uses legacy token --\${alias}\`);\n    if (source.includes(\`--\${alias}:\`)) failures.push(\`\${file} still declares retired token --\${alias}\`);\n  }\n}\nif (!site.includes("--site-page-top:") || !site.includes("--site-page-bottom:")) failures.push("Canonical page spacing tokens are missing");\nconst bytes = Object.fromEntries(modules.map((modulePath) => [modulePath, fs.statSync(modulePath).size]));\nconsole.log(JSON.stringify({ globalsRetired: !fs.existsSync("app/globals.css"), legacyAliasCount: legacyAliases.length, moduleBytes: bytes, totalMigratedBytes: Object.values(bytes).reduce((a,b)=>a+b,0) }, null, 2));\nif (failures.length) { for (const failure of failures) console.error(\`CSS authority: \${failure}\`); process.exit(1); }\n`;
fs.writeFileSync("scripts/audit-css-authority.mjs", audit);

for (const file of filesUnder("app")) {
  const source = fs.readFileSync(file, "utf8");
  for (const alias of aliases.keys()) {
    if (source.includes(`var(--${alias})`) || source.includes(`--${alias}:`)) throw new Error(`${file} still contains legacy token --${alias}`);
  }
}

console.log(JSON.stringify({ canonicalizedOccurrences: counts, retiredAliases: aliases.size }, null, 2));
