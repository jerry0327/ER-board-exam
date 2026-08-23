#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- bash "$0" "$@"
fi

node "${script_dir}/compress-static-content.mjs"
node "${script_dir}/audit-compressed-static.mjs"
node "${script_dir}/generate-managed-audio-manifest.mjs"
node "${script_dir}/audit-audio-runtime.mjs"
node "${script_dir}/compress-learning-documents.mjs"
node "${script_dir}/audit-learning-documents.mjs"
node "${script_dir}/compress-section-title-locales.mjs"
node "${script_dir}/audit-section-title-locales-compression.mjs"
node "${script_dir}/guard-static-index.mjs"
node --experimental-strip-types "${script_dir}/guard-subtitle-deployment-readiness.mjs"

echo "Running Vercel-targeted vinext/Nitro build with the complete logical content database expanded..."
node "${script_dir}/with-uncompressed-static-content.mjs" -- \
  bash -lc 'NITRO_PRESET=vercel "$SITES_PROJECT_ROOT/node_modules/.bin/vite" build && node "$SITES_PROJECT_ROOT/scripts/validate-vercel-static.mjs"'

node "${script_dir}/guard-static-index.mjs"
node "${script_dir}/audit-compressed-static.mjs"
