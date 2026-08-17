import fs from "node:fs";

const globalsPath = "app/globals.css";
const sitePath = "app/site.css";
const ciPath = ".github/workflows/ci.yml";

const globals = fs.readFileSync(globalsPath, "utf8");
const site = fs.readFileSync(sitePath, "utf8");
const ci = fs.readFileSync(ciPath, "utf8");

const layerOpen = "@layer legacy {";
const openIndex = globals.indexOf(layerOpen);
if (openIndex < 0) throw new Error("globals.css legacy layer wrapper not found");
const closeIndex = globals.lastIndexOf("\n}");
if (closeIndex <= openIndex) throw new Error("globals.css closing legacy layer not found");
const inner = globals.slice(openIndex + layerOpen.length, closeIndex).trim();

const markers = {
  learning: "/* ===== Textbook learning library and Rosen's 10e catalog ===== */",
  practice: "/* Shared inner pages */",
  browse: "/* Browse */",
  reader: "/* Dedicated explanation reader */",
  guide: "/* 303-chapter study-guide library and Markdown reader */",
  notes: "/* Wrong-answer notebook */",
  rest: "/* Evidence-informed, non-interruptive rest page */",
  analytics: "/* Analytics */",
  responsive: "@media (max-width: 1040px)",
  interactions: "/* Premium interaction layer: quiet tonal feedback, no decorative glow. */",
};

const positions = Object.fromEntries(Object.entries(markers).map(([key, marker]) => {
  const index = inner.indexOf(marker);
  if (index < 0) throw new Error(`Missing globals.css marker: ${marker}`);
  return [key, index];
}));
const ordered = ["learning", "practice", "browse", "reader", "guide", "notes", "rest", "analytics", "responsive", "interactions"];
for (let i = 1; i < ordered.length; i += 1) {
  if (positions[ordered[i]] <= positions[ordered[i - 1]]) throw new Error(`Unexpected marker order at ${ordered[i]}`);
}

const segments = [
  ["site-foundation.css", 0, positions.learning, "Shared shell, dashboard, and base structural rules"],
  ["site-learning-library.css", positions.learning, positions.practice, "Textbook and learning-library structural rules"],
  ["site-practice.css", positions.practice, positions.browse, "Shared inner-page and practice-session structural rules"],
  ["site-browse.css", positions.browse, positions.reader, "Question-bank browse structural rules"],
  ["site-reader.css", positions.reader, positions.guide, "Explanation-reader structural rules"],
  ["site-guide.css", positions.guide, positions.notes, "Study-guide and AILS structural rules"],
  ["site-notes.css", positions.notes, positions.rest, "Wrong-answer and notebook structural rules"],
  ["site-rest.css", positions.rest, positions.analytics, "Rest workspace structural rules"],
  ["site-analytics.css", positions.analytics, positions.responsive, "Analytics workspace structural rules"],
  ["site-responsive.css", positions.responsive, positions.interactions, "Shared responsive layout rules"],
  ["site-interactions.css", positions.interactions, inner.length, "Shared interaction, theme, and reading-variant rules"],
];

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
  ["motion-standard", "site-ease"], ["motion-enter", "site-ease"], ["serif", "site-display"], ["sans", "site-sans"],
]);

function canonicalize(value) {
  let next = value;
  for (const [legacy, canonical] of aliases) {
    next = next.replaceAll(`var(--${legacy})`, `var(--${canonical})`);
  }
  return next;
}

for (const [filename, start, end, description] of segments) {
  const body = canonicalize(inner.slice(start, end).trim());
  if (!body) throw new Error(`Empty CSS segment: ${filename}`);
  const header = `/*\n * ${description}.\n *\n * Migrated from the former globals.css compatibility bucket. Keep visual\n * decisions on canonical --site-* tokens; site.css remains the sole runtime\n * stylesheet entry and cascade authority.\n */\n`;
  fs.writeFileSync(`app/${filename}`, `${header}${body}\n`);
}

const importBlock = segments.map(([filename]) => `@import "./${filename}" layer(legacy);`).join("\n");
if (!site.includes('@import "./globals.css" layer(legacy);')) throw new Error("site.css globals import not found");
fs.writeFileSync(sitePath, site.replace('@import "./globals.css" layer(legacy);', importBlock));
fs.unlinkSync(globalsPath);

const audit = `import fs from "node:fs";\n\nconst modules = ${JSON.stringify(segments.map(([filename]) => `app/${filename}`), null, 2)};\nconst aliases = ${JSON.stringify([...aliases.keys()], null, 2)};\nconst site = fs.readFileSync("app/site.css", "utf8");\nconst layout = fs.readFileSync("app/layout.tsx", "utf8");\nconst failures = [];\nif (fs.existsSync("app/globals.css")) failures.push("app/globals.css must remain retired");\nif (site.includes("globals.css")) failures.push("site.css must not import globals.css");\nif (!layout.includes('import "./site.css"')) failures.push("RootLayout must keep site.css as the runtime style entry");\nfor (const modulePath of modules) {\n  if (!fs.existsSync(modulePath)) { failures.push(\`Missing CSS module: \${modulePath}\`); continue; }\n  const source = fs.readFileSync(modulePath, "utf8");\n  const filename = modulePath.split("/").pop();\n  if (!site.includes(\`@import "./\${filename}" layer(legacy);\`)) failures.push(\`site.css missing ordered import for \${filename}\`);\n  for (const alias of aliases) {\n    if (source.includes(\`var(--\${alias})\`)) failures.push(\`\${modulePath} still uses legacy token --\${alias}\`);\n  }\n}\nconst bytes = Object.fromEntries(modules.map((modulePath) => [modulePath, fs.statSync(modulePath).size]));\nconsole.log(JSON.stringify({ globalsRetired: !fs.existsSync("app/globals.css"), moduleBytes: bytes, totalMigratedBytes: Object.values(bytes).reduce((a,b)=>a+b,0) }, null, 2));\nif (failures.length) { for (const failure of failures) console.error(\`CSS authority: \${failure}\`); process.exit(1); }\n`;
fs.writeFileSync("scripts/audit-css-authority.mjs", audit);

const lintNeedle = "      - name: ESLint\n        run: npm run lint\n";
if (!ci.includes(lintNeedle)) throw new Error("CI ESLint anchor not found");
const ciNext = ci.replace(lintNeedle, `${lintNeedle}\n      - name: CSS authority\n        run: node scripts/audit-css-authority.mjs\n`);
fs.writeFileSync(ciPath, ciNext);

console.log(JSON.stringify({ migrated: segments.map(([filename]) => filename), aliasesCanonicalized: aliases.size }, null, 2));
