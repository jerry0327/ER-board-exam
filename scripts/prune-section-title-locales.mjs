import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "dist/client/subtitles-title-locales");
if (!fs.existsSync(root)) {
  console.log(`No section-title locale deployment directory: ${root}`);
  process.exit(0);
}

const removed = [];
const stack = [root];
while (stack.length) {
  const current = stack.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) stack.push(absolute);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const sidecar = `${absolute}.br`;
      if (!fs.existsSync(sidecar)) throw new Error(`Cannot prune ${absolute}; missing ${sidecar}`);
      fs.unlinkSync(absolute);
      removed.push(absolute);
    }
  }
}
console.log(`Pruned ${removed.length} raw section-title locale JSON files; Brotli sidecars remain deployable.`);
