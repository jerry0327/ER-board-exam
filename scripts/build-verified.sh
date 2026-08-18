#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout >/dev/null || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
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

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

node "${script_dir}/guard-static-index.mjs"
node "${script_dir}/audit-compressed-static.mjs" \
  --root "${SITES_PROJECT_ROOT}/dist/client" \
  --compare "${SITES_PROJECT_ROOT}/public"
node "${script_dir}/audit-built-snac-route.mjs"
node "${script_dir}/prune-r2-managed-assets.mjs" \
  --root "${SITES_PROJECT_ROOT}/dist/client"
node "${script_dir}/prune-section-title-locales.mjs" "${SITES_PROJECT_ROOT}/dist/client/subtitles-title-locales"
node "${script_dir}/prune-r2-content-packs.mjs" "${SITES_PROJECT_ROOT}/dist/client"
node "${script_dir}/guard-deployment-audio-boundary.mjs" \
  --root "${SITES_PROJECT_ROOT}/dist/client"
node "${script_dir}/audit-built-r2-audio-route.mjs"
"${script_dir}/validate-artifact.sh"
