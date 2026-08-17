import { readFile } from "node:fs/promises";

export async function readSiteCss() {
  return readFile(new URL("../app/site.css", import.meta.url), "utf8");
}

export async function readLegacyCss() {
  const siteCss = await readSiteCss();
  const legacyImports = [...siteCss.matchAll(/^@import\s+"\.\/([^"]+\.css)"\s+layer\(legacy\);$/gmu)]
    .map((match) => match[1]);

  if (legacyImports.length === 0) {
    throw new Error("site.css declares no layer(legacy) imports");
  }

  const sources = await Promise.all(
    legacyImports.map((file) => readFile(new URL(`../app/${file}`, import.meta.url), "utf8")),
  );
  return sources.join("\n");
}
