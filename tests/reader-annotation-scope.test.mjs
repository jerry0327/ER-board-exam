import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseReaderAnnotationScope, readerAnnotationScopePrefix } from "../app/lib/annotation-source.ts";
import { annotationExplanationPack } from "../app/lib/explanation-packs.ts";

test("new Reader annotation ids round-trip every pack and reading depth", () => {
  for (const packId of ["original", "concise"]) {
    for (const mode of ["quick", "standard", "full", "raw"]) {
      const id = `${readerAnnotationScopePrefix(packId, mode)}annotation-1234`;
      assert.deepEqual(parseReaderAnnotationScope(id), { kind: "reader", packId, mode });
      assert.equal(annotationExplanationPack(id), packId);
    }
  }
});

test("legacy Reader annotation ids keep their pack and full-mode fallback contract", () => {
  assert.equal(parseReaderAnnotationScope("h_old-highlight"), null);
  assert.equal(parseReaderAnnotationScope("h_c_old-highlight"), null);
  assert.equal(annotationExplanationPack("h_old-highlight"), "original");
  assert.equal(annotationExplanationPack("h_c_old-highlight"), "concise");
});

test("Reader creates both excerpts and selection highlights with the rendered scope", async () => {
  const [reader, tools] = await Promise.all([
    readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(reader, /const requestedAnnotationMode = readerAnnotationScope\?\.mode \?\? storedAnnotationMode/u);
  assert.match(reader, /const annotationHasReadingScope = Boolean\(readerAnnotationScope \|\| annotationPack \|\| storedAnnotationMode\)/u);
  assert.match(reader, /effectiveExplanationMode: ExplanationMode = annotationHasReadingScope \? annotationMode \?\? "full" : explanationMode/u);
  assert.match(reader, /annotationPrefix: readerAnnotationScopePrefix\(resolvedPackId, displayedExplanationMode\)/u);
  assert.ok((tools.match(/id: scopedAnnotationId\(source\.annotationPrefix\)/gu) ?? []).length >= 2);
  assert.match(tools, /const readerScope = parseReaderAnnotationScope\(id\)/u);
  assert.match(tools, /if \(readerScope\) return id\.startsWith\(source\.annotationPrefix\)/u);
  assert.match(tools, /source\.contentScope === "full"[\s\S]{0,100}annotationExplanationPack\(id\) === source\.explanationPack/u);
});
