import { spawnSync } from "node:child_process";
import process from "node:process";
import { withStaticContentLock } from "./lib/static-content-codec.mjs";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : null;
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
if (!command) throw new Error("用法：node scripts/with-static-content-lock.mjs -- <command> [...args]");

withStaticContentLock(() => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, STATIC_CONTENT_LOCK_HELD: "1" },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
});
