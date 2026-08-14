import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("EMS learning guide publishes all 24 source chapters with verified content", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/guides/ems/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.chapterCount, 24);
  assert.equal(manifest.defaultMode, "full");
  assert.equal(manifest.chapters.length, 24);
  assert.match(manifest.sourceRevision, /^[a-f0-9]{20}$/u);

  const contentHashes = [];
  const depths = [
    { id: "quick", suffix: "-quick", minimumCharacters: 600 },
    { id: "standard", suffix: "-standard", minimumCharacters: 2_000 },
    { id: "full", suffix: "", minimumCharacters: 2_000 },
  ];
  for (let index = 0; index < manifest.chapters.length; index += 1) {
    const number = index + 1;
    const id = String(number).padStart(3, "0");
    const chapter = manifest.chapters[index];
    assert.equal(chapter.id, id);
    assert.equal(chapter.number, number);
    assert.equal(chapter.order, number);
    assert.equal(chapter.markdownPath, `/guides/ems/chapters/${id}.md`);
    assert(chapter.title.length > 0);
    assert.equal(chapter.modes.full.bytes, chapter.bytes);
    assert.equal(chapter.modes.full.contentHash, chapter.contentHash);
    assert.equal(chapter.modes.full.markdownPath, chapter.markdownPath);

    for (const depth of depths) {
      const mode = chapter.modes[depth.id];
      assert.equal(mode.markdownPath, `/guides/ems/chapters/${id}${depth.suffix}.md`);
      assert(mode.headingTitle.length > 0);
      assert.match(mode.sourceSha256, /^[a-f0-9]{64}$/u);
      const bytes = await readFile(new URL(`../public${mode.markdownPath}`, import.meta.url));
      const markdown = bytes.toString("utf8");
      assert.equal(bytes.byteLength, mode.bytes);
      assert.equal(sha256(bytes), mode.contentHash);
      assert.match(markdown, new RegExp(`^#\\s+第${number}章\\s+`, "u"));
      assert(markdown.length >= depth.minimumCharacters);
      contentHashes.push(mode.contentHash);
    }
  }

  assert.equal(
    sha256(Buffer.from(contentHashes.join(""), "utf8")).slice(0, 20),
    manifest.sourceRevision,
  );
});

test("EMS guide is reachable from the shared learning-guide hub and reader shell", async () => {
  const [hub, wrapper, reader, codec, css] = await Promise.all([
    readFile(new URL("../app/views/guide-hub-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ems-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lib/static-content-codec.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  ]);
  assert.match(hub, /guide-book-card ems/u);
  assert.match(hub, /急診住院醫師<br \/>緊急醫療救護教科書/u);
  assert.match(hub, /台灣急診醫學會 EMS 委員會編寫的住院醫師訓練教材/u);
  assert.match(hub, /台灣急診醫學會 EMS 委員會/u);
  assert.ok(hub.indexOf("guide-book-card tintinalli") < hub.indexOf("guide-book-card rosens"));
  assert.ok(hub.indexOf("guide-book-card rosens") < hub.indexOf("guide-book-card goldfrank"));
  assert.ok(hub.indexOf("guide-book-card goldfrank") < hub.indexOf("guide-book-card ems"));
  assert.ok(hub.indexOf("guide-book-card ems") < hub.indexOf("guide-book-card ails"));
  assert.ok(hub.indexOf("guide-book-card ails") < hub.indexOf("guide-book-card board"));
  assert.match(css, /--site-guide-ems:\s*#82aeb8/u);
  assert.match(css, /\.guide-book-card\.ems \.guide-book-spine\s*\{[^}]*background: var\(--site-guide-ems\);[^}]*color: var\(--site-guide-ems-ink\);/u);
  assert.match(wrapper, /requestedGuideModuleId === "ems"/u);
  assert.match(wrapper, /<EmsGuideView/u);
  assert.match(reader, /loadEmsGuideManifest/u);
  assert.match(reader, /loadEmsGuideMarkdown/u);
  assert.match(reader, /<ReadingVariantSelector/u);
  assert.match(reader, /namespace: "ems"/u);
  assert.match(reader, /defaultValue: "full" as EmsReadingDepth/u);
  assert.match(reader, /速讀[\s\S]*普通[\s\S]*完整版/u);
  assert.match(reader, /parseEmsGuideAnnotationScope/u);
  assert.match(reader, /<MarkdownContent/u);
  assert.match(reader, /<ContentAnnotationTools/u);
  assert.match(codec, /guides\/ems\/manifest\.json/u);
});
