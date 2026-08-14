import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  auditCompressedRoot,
  compressRawFiles,
  discardExpandedStaticContent,
  expandCompressedFiles,
  markStaticContentTransactionRunning,
  markStaticContentTransactionSucceeded,
  preserveFailedExpandedStaticContent,
  publicRoot,
  withStaticContentLock,
} from "./lib/static-content-codec.mjs";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : null;
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];

function childCommand() {
  if (process.platform !== "win32" || command !== "npm") return { executable: command, args };
  const npmCli = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!npmCli) throw new Error("Unable to locate npm-cli.js on Windows");
  return { executable: process.execPath, args: [npmCli, ...args] };
}
if (!command) throw new Error("用法：node scripts/with-uncompressed-static-content.mjs -- <command> [...args]");

function ensureCompressedRuntime() {
  try {
    compressRawFiles();
  } catch (error) {
    const recoveryRoot = preserveFailedExpandedStaticContent();
    if (!recoveryRoot) throw error;
    console.error(`Failed expanded content was preserved at ${recoveryRoot}`);
    compressRawFiles();
  }
}

withStaticContentLock(() => {
  ensureCompressedRuntime();
  auditCompressedRoot(publicRoot);
  expandCompressedFiles();
  markStaticContentTransactionRunning();
  let result;
  let commandSucceeded = false;

  try {
    const child = childCommand();
    result = spawnSync(child.executable, child.args, {
      stdio: "inherit",
      env: { ...process.env, STATIC_CONTENT_LOCK_HELD: "1" },
    });
    if (result.error) throw result.error;
    if (result.status === 0) {
      markStaticContentTransactionSucceeded();
      commandSucceeded = true;
      compressRawFiles();
      auditCompressedRoot(publicRoot);
    } else {
      discardExpandedStaticContent();
    }
  } catch (error) {
    if (commandSucceeded) {
      const recoveryRoot = preserveFailedExpandedStaticContent();
      if (recoveryRoot) {
        console.error(`Failed expanded content was preserved at ${recoveryRoot}`);
      }
    } else {
      discardExpandedStaticContent();
    }
    throw error;
  }

  process.exitCode = result.status ?? 1;
});
