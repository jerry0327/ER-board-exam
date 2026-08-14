import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

const storedPdfUrl = new URL("../public/learning-documents/emergency-clinical-decision-atlas-9273814f8395.pdf.brp", import.meta.url);
const [catalog, view, preview, app, routes, types, css, storedPdf, storedPdfStat, manifest, worker, headers] = await Promise.all([
  readFile(new URL("../app/lib/learning-documents.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/views/learning-documents-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/learning-document-preview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/app-route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(storedPdfUrl),
  stat(storedPdfUrl),
  readFile(new URL("../public/learning-documents/compression-manifest.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/_headers", import.meta.url), "utf8"),
]);
const pdf = brotliDecompressSync(storedPdf, { maxOutputLength: 64 * 1024 * 1024 });

test("learning documents remain a routed knowledge view under revised navigation", () => {
  assert.match(catalog, /export const learningDocuments/u);
  assert.match(catalog, /supportedLearningDocumentFormats = \["PDF", "Word", "PowerPoint"\]/u);
  assert.match(catalog, /pageCount: 90/u);
  assert.match(catalog, /previewHref: "\/learning-documents\/emergency-clinical-decision-atlas-9273814f8395\.pdf"/u);
  assert.match(types, /"\u5b78\u7fd2\u97f3\u6a94" \| "\u5b78\u7fd2\u6587\u4ef6" \| "\u932f\u984c\u672c"/u);
  assert.match(app, /name: "\u5b78\u7fd2\u6587\u4ef6", label: "\u6587\u4ef6"/u);
  assert.match(app, /const primaryNavItems = \[[\s\S]*?name === "\u7e3d\u89bd"[\s\S]*?name === "\u958b\u59cb\u4f5c\u7b54"[\s\S]*?name === "\u5b78\u7fd2\u6307\u5f15"\)!, label: "\u5b78\u7fd2"[\s\S]*?name === "\u932f\u984c\u672c"[\s\S]*?name === "\u5099\u8003\u4e2d\u5fc3"/u);
  assert.match(app, /activeNav === "\u5b78\u7fd2\u6587\u4ef6"[\s\S]*?<LearningDocumentsView/u);
  assert.match(routes, /documents: "\u5b78\u7fd2\u6587\u4ef6"/u);
});

test("PDF is stored only as Brotli q11 and served through its logical URL", () => {
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.byteLength > 2_000_000);
  assert.ok(pdf.byteLength < 4_000_000);
  assert.ok(storedPdfStat.size < pdf.byteLength * 0.6);
  assert.equal(manifest.algorithm, "brotli");
  assert.equal(manifest.quality, 11);
  assert.equal(manifest.assets[0].storedPath, "/learning-documents/emergency-clinical-decision-atlas-9273814f8395.pdf.brp");
  assert.match(worker, /serveCompressedLearningDocument/u);
  assert.match(worker, /learningDocumentContentType/u);
  assert.match(worker, /\[a-f0-9\]\{12,64\}/u);
  const documentWorker = worker.slice(
    worker.indexOf("async function serveCompressedLearningDocument"),
    worker.indexOf("async function serveLegacyLogicalStatic"),
  );
  assert.match(documentWorker, /requestHeaders\.set\("accept-encoding", "identity"\)/u);
  assert.match(documentWorker, /headers\.set\("cache-control", IMMUTABLE_CACHE_CONTROL\)/u);
  assert.match(documentWorker, /x-content-type-options", "nosniff/u);
  assert.match(documentWorker, /requestHeaders\.delete\("range"\)/u);
  assert.match(worker, /content-encoding", "br/u);
  assert.doesNotMatch(headers, /\/learning-documents\/\*/u);
  assert.match(headers, /\/learning-documents\/compression-manifest\.json[\s\S]*?max-age=0, must-revalidate/u);
});

test("document workspace keeps in-site reading and removes download and size affordances", () => {
  assert.match(view, /className="learning-documents-workspace"/u);
  assert.match(view, /learningDocuments\.map/u);
  assert.match(view, /<LearningDocumentPreview[\s\S]*?href=\{selectedDocument\.previewHref\}/u);
  assert.match(preview, /<iframe[\s\S]*?className="learning-document-native-frame"[\s\S]*?loading="lazy"/u);
  assert.match(preview, /MOBILE_READER_QUERY/u);
  assert.match(preview, /pdfjs-dist\/legacy\/build\/pdf\.mjs/u);
  assert.match(preview, /pdf\.worker\.min\.mjs\?url/u);
  assert.match(preview, /disableRange: true/u);
  assert.match(preview, /new ResizeObserver/u);
  assert.match(preview, /MAX_OUTPUT_SCALE = 1\.5/u);
  assert.match(preview, /renderTask\?\.cancel\(\)/u);
  assert.match(preview, /loadingTask\.destroy\(\)/u);
  assert.match(preview, /data-reading-navigation-ignore/u);
  assert.match(view, /<div key=\{document\.id\}[\s\S]*?href=\{document\.previewHref\}[\s\S]*?target="_blank"[\s\S]*?rel="noreferrer"/u);
  assert.doesNotMatch(view, /selectedDocument\.originalHref|downloadName|download=|fileSizeLabel|learning-document-actions|documentMeta/u);
  assert.match(css, /\.learning-documents-workspace[\s\S]*?grid-template-columns: minmax\(248px, 280px\) minmax\(0, 1fr\)/u);
  assert.match(css, /\.learning-document-library nav > div > a\s*\{[^}]*border-radius: 50%/u);
  assert.match(css, /\.learning-document-pdf-toolbar button,[\s\S]*?min-height: 44px/u);
  assert.match(css, /\.learning-document-pdf-stage[\s\S]*?overflow: auto/u);
  assert.match(css, /@media screen and \(max-width: 600px\)[\s\S]*?\.learning-document-mobile-hint[\s\S]*?display: block/u);
});
