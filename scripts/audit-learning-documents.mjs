import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import {
  brotliCompress,
  brotliDecompressSync,
  constants,
} from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const manifestPath = resolve(publicRoot, "learning-documents/compression-manifest.json");
const maxRawBytes = 64 * 1024 * 1024;
const compressBrotli = promisify(brotliCompress);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
invariant(
  manifest.schema === "learning-document-compression-v1",
  "Unexpected learning-document compression manifest",
);
invariant(
  manifest.algorithm === "brotli" && manifest.quality === 11,
  "Learning documents must use Brotli quality 11",
);
invariant(manifest.assets.length === 1, "Expected exactly one learning document");

let rawBytes = 0;
let storedBytes = 0;
for (const asset of manifest.assets) {
  invariant(
    /^\/learning-documents\/[a-z0-9][a-z0-9._-]*-[a-f0-9]{12,64}\.(?:pdf|docx?|pptx?)$/u.test(asset.logicalPath),
    `Unsafe learning-document path: ${asset.logicalPath}`,
  );
  invariant(
    asset.storedPath === `${asset.logicalPath}.brp`,
    `Unexpected stored path: ${asset.logicalPath}`,
  );
  invariant(
    !(await exists(resolve(publicRoot, asset.logicalPath.slice(1)))),
    `Uncompressed learning-document duplicate remains: ${asset.logicalPath}`,
  );

  const stored = await readFile(resolve(publicRoot, asset.storedPath.slice(1)));
  invariant(stored.byteLength === asset.storedBytes, `Stored size mismatch: ${asset.logicalPath}`);
  invariant(sha256(stored) === asset.storedSha256, `Stored hash mismatch: ${asset.logicalPath}`);
  const raw = brotliDecompressSync(stored, { maxOutputLength: maxRawBytes });
  invariant(raw.byteLength === asset.rawBytes, `Raw size mismatch: ${asset.logicalPath}`);
  invariant(sha256(raw) === asset.rawSha256, `Raw hash mismatch: ${asset.logicalPath}`);
  invariant(raw.subarray(0, 5).toString("ascii") === "%PDF-", `Invalid PDF header: ${asset.logicalPath}`);

  const canonical = await compressBrotli(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
    },
  });
  invariant(canonical.equals(stored), `Stored bytes are not canonical Brotli q11: ${asset.logicalPath}`);
  rawBytes += raw.byteLength;
  storedBytes += stored.byteLength;
}

invariant(manifest.rawBytes === rawBytes, "Learning-document raw byte total mismatch");
invariant(manifest.storedBytes === storedBytes, "Learning-document stored byte total mismatch");
invariant(manifest.ratio === Number((storedBytes / rawBytes).toFixed(6)), "Learning-document ratio mismatch");
invariant(manifest.ratio < 0.6, "Learning-document compression savings regressed");

const workerSource = await readFile(resolve(root, "worker/index.ts"), "utf8");
const learningDocumentWorkerSource = workerSource.slice(
  workerSource.indexOf("async function serveCompressedLearningDocument"),
  workerSource.indexOf("async function serveLegacyLogicalStatic"),
);
invariant(
  learningDocumentWorkerSource.includes("serveCompressedLearningDocument")
    && workerSource.includes("learningDocumentContentType")
    && learningDocumentWorkerSource.includes('requestHeaders.set("accept-encoding", "identity")')
    && learningDocumentWorkerSource.includes('headers.set("x-content-type-options", "nosniff")')
    && learningDocumentWorkerSource.includes('headers.set("content-encoding", "br")')
    && learningDocumentWorkerSource.includes('headers.set("cache-control", IMMUTABLE_CACHE_CONTROL)')
    && learningDocumentWorkerSource.includes('encodeBody: "manual"'),
  "Transparent Brotli learning-document delivery is missing",
);

const headersSource = await readFile(resolve(publicRoot, "_headers"), "utf8");
invariant(
  !headersSource.includes("/learning-documents/*")
    && headersSource.includes("/learning-documents/compression-manifest.json")
    && headersSource.includes("max-age=0, must-revalidate"),
  "Learning-document cache policies are missing",
);

console.log(
  `Validated ${manifest.assets.length} Brotli q11 learning document: `
  + `${rawBytes} -> ${storedBytes} bytes (${(manifest.ratio * 100).toFixed(2)}%).`,
);
