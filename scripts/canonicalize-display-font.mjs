import fs from "node:fs";
import path from "node:path";

function cssFilesUnder(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...cssFilesUnder(full));
    else if (entry.name.endsWith(".css")) result.push(full);
  }
  return result;
}

let replaced = 0;
const touched = [];
for (const file of cssFilesUnder("app")) {
  const source = fs.readFileSync(file, "utf8");
  const matches = source.match(/font-family\s*:\s*[^;{}]*\bGeorgia\b[^;{}]*;/gu) ?? [];
  if (!matches.length) continue;
  const next = source.replace(/font-family\s*:\s*[^;{}]*\bGeorgia\b[^;{}]*;/gu, () => {
    replaced += 1;
    return "font-family: var(--site-display);";
  });
  fs.writeFileSync(file, next);
  touched.push({ file, replacements: matches.length });
}

const auditPath = "scripts/audit-css-authority.mjs";
let audit = fs.readFileSync(auditPath, "utf8");
const needle = 'if (!site.includes("--site-page-top:") || !site.includes("--site-page-bottom:")) failures.push("Canonical page spacing tokens are missing");\n';
if (!audit.includes(needle)) throw new Error("CSS authority audit anchor not found");
const insertion = `${needle}for (const file of filesUnder("app")) {\n  if (!file.endsWith(".css")) continue;\n  const source = fs.readFileSync(file, "utf8");\n  if (/font-family\\s*:\\s*[^;{}]*\\bGeorgia\\b[^;{}]*;/gu.test(source)) failures.push(\`${'${file}'} bypasses --site-display with a direct Georgia font-family\`);\n}\n`;
audit = audit.replace(needle, insertion);
fs.writeFileSync(auditPath, audit);

const leftovers = [];
for (const file of cssFilesUnder("app")) {
  const source = fs.readFileSync(file, "utf8");
  if (/font-family\s*:\s*[^;{}]*\bGeorgia\b[^;{}]*;/gu.test(source)) leftovers.push(file);
}
if (leftovers.length) throw new Error(`Direct Georgia font-family remains in: ${leftovers.join(", ")}`);
console.log(JSON.stringify({ replaced, touched }, null, 2));
