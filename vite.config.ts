import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const isVercelBuild =
  process.env.VERCEL === "1" ||
  Boolean(process.env.VERCEL_ENV) ||
  process.env.NITRO_PRESET === "vercel";
const vercelCloudflareWorkersShim = fileURLToPath(
  new URL("./build/vercel-cloudflare-workers-shim.ts", import.meta.url),
);

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  assets: {
    binding: "ASSETS",
    // Sites normally serves static assets before invoking the Worker. Route
    // content-hashed bundles and version-pinned KaTeX fonts through the Worker
    // so immutable caching remains authoritative when `_headers` is not applied.
    run_worker_first: ["/assets/*", "/fonts/katex-0.16.22/*"],
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const shared = {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      watch: {
        // The guide and question libraries contain thousands of immutable
        // generated files. They are fetched as static assets and do not need
        // individual development watchers.
        ignored: [
          "**/.sites-runtime/**",
          "**/dist/**",
          "**/node_modules/**",
          "**/public/guides/**",
          "**/public/data/**",
          "**/public/subtitles/**",
        ],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
  };

  if (isVercelBuild) {
    const { nitro } = await import("nitro/vite");
    return {
      ...shared,
      resolve: {
        alias: {
          "cloudflare:workers": vercelCloudflareWorkersShim,
        },
      },
      plugins: [vinext(), sites(), nitro({ preset: "vercel" })],
    };
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    ...shared,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
