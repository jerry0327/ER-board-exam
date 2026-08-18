import fs from "node:fs";

function patch(file, replacements) {
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`Patch anchor missing in ${file}: ${from.slice(0, 100)}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(file, text);
}

patch("worker/content-packs.ts", [
  [
    'import { createHash } from "node:crypto";\n',
    'import { createHash } from "node:crypto";\nimport { loadR2ContentPackBytes, type ContentPackR2Env } from "./content-pack-r2";\n',
  ],
  [
    'export interface PackedStaticEnv {\n  ASSETS: {\n    fetch(request: Request): Promise<Response>;\n  };\n}\n',
    'export interface PackedStaticEnv extends ContentPackR2Env {}\n',
  ],
  [
    '    const bytes = await fetchAssetBytes(\n      env,\n      requestUrl,\n      `${PACK_ROOT}${name}`,\n      MAX_PACK_COMPRESSED_BYTES,\n    );\n    if (bytes && sha256Hex(bytes) !== expectedSha256) {\n      throw new Error(`Packed content digest mismatch: ${name}`);\n    }\n    return bytes;\n',
    '    const staticBytes = await fetchAssetBytes(\n      env,\n      requestUrl,\n      `${PACK_ROOT}${name}`,\n      MAX_PACK_COMPRESSED_BYTES,\n    );\n    const bytes = staticBytes ?? await loadR2ContentPackBytes(requestUrl, env, name, expectedSha256);\n    if (bytes && sha256Hex(bytes) !== expectedSha256) {\n      throw new Error(`Packed content digest mismatch: ${name}`);\n    }\n    return bytes;\n',
  ],
]);

patch("worker/index.ts", [
  [
    'import { createPackedStaticHandler } from "./content-packs";\n',
    'import { createPackedStaticHandler } from "./content-packs";\nimport { handleContentPackOperator } from "./content-pack-r2";\n',
  ],
  [
    '    || pathname.startsWith("/subtitles-runtime/");\n',
    '    || pathname.startsWith("/subtitles-runtime/")\n    || pathname.startsWith("/subtitles-title-locales/");\n',
  ],
  [
    '    const managedAudioOperator = await handleManagedAudioOperator(request, env);\n    if (managedAudioOperator) return managedAudioOperator;\n',
    '    const managedAudioOperator = await handleManagedAudioOperator(request, env);\n    if (managedAudioOperator) return managedAudioOperator;\n\n    const contentPackOperator = await handleContentPackOperator(request, env);\n    if (contentPackOperator) return contentPackOperator;\n',
  ],
]);

patch("scripts/build-verified.sh", [
  [
    'node "${script_dir}/compress-learning-documents.mjs"\nnode "${script_dir}/audit-learning-documents.mjs"\n',
    'node "${script_dir}/compress-learning-documents.mjs"\nnode "${script_dir}/audit-learning-documents.mjs"\nnode "${script_dir}/compress-section-title-locales.mjs"\nnode "${script_dir}/audit-section-title-locales-compression.mjs"\n',
  ],
  [
    'node "${script_dir}/prune-r2-managed-assets.mjs" \\\n  --root "${SITES_PROJECT_ROOT}/dist/client"\n',
    'node "${script_dir}/prune-r2-managed-assets.mjs" \\\n  --root "${SITES_PROJECT_ROOT}/dist/client"\nnode "${script_dir}/prune-section-title-locales.mjs" "${SITES_PROJECT_ROOT}/dist/client/subtitles-title-locales"\nnode "${script_dir}/prune-r2-content-packs.mjs" "${SITES_PROJECT_ROOT}/dist/client"\n',
  ],
]);

const packageFile = "package.json";
const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
pkg.scripts["compress:section-title-locales"] = "node scripts/compress-section-title-locales.mjs";
pkg.scripts["audit:section-title-locales"] = "node scripts/audit-section-title-locales-compression.mjs";
pkg.scripts["seed:content-packs-r2"] = "node scripts/seed-r2-content-packs.mjs";
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

console.log("R2 bulk-content source wiring applied.");
