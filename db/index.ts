import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getD1Database(): Promise<D1Database> {
  // Keep the workerd-native module lazy so Node can validate the built Worker
  // without trying to resolve a Cloudflare-only URL scheme at import time.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1Database(), { schema });
}
