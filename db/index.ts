import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

async function getCloudflareEnvironment() {
  // Keep Cloudflare's virtual module completely outside non-Cloudflare bundles.
  // A variable specifier plus @vite-ignore prevents Vite/Rolldown from trying
  // to resolve the `cloudflare:` URL while building the Vercel/Nitro target.
  // On ChatGPT Sites/Cloudflare this branch is evaluated at request time and
  // workerd resolves the virtual module normally.
  const cloudflareWorkersModule = "cloudflare:workers";
  const workers = await import(/* @vite-ignore */ cloudflareWorkersModule) as {
    env?: { DB?: D1Database };
  };
  return workers.env;
}

export async function getD1Database(): Promise<D1Database> {
  const env = await getCloudflareEnvironment();
  if (!env?.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1Database(), { schema });
}
