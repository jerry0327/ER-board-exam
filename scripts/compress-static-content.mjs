import {
  auditCompressedRoot,
  compressRawFiles,
  formatBytes,
  publicRoot,
  withStaticContentLock,
} from "./lib/static-content-codec.mjs";

withStaticContentLock(() => {
  const compressed = compressRawFiles();
  const audited = auditCompressedRoot(publicRoot);
  console.log(
    `Compressed static content: ${audited.files} files in ${audited.packs} indexed packs, `
    + `${formatBytes(audited.logicalBytes)} logical → ${formatBytes(audited.storedBytes)} stored`
    + (compressed.updatedFiles ? ` (${compressed.updatedFiles} pack assets updated at Brotli q11)` : ""),
  );
});
