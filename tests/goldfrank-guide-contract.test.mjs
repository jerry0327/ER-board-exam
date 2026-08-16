import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  goldfrankProductionLanguagePattern,
  sanitizeGoldfrankGuideMarkdown,
  sanitizeGoldfrankProductionNotes,
} from "../scripts/lib/goldfrank-guide-markdown.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function findBareFormulaLines(markdown) {
  let inDisplayMath = false;
  return markdown.split("\n").flatMap((line, index) => {
    if (/^\s*\$\$\s*$/u.test(line)) {
      inDisplayMath = !inDisplayMath;
      return [];
    }
    return !inDisplayMath && /^\s*(?:\[|\]|\+)\s*$/u.test(line)
      ? [index + 1]
      : [];
  });
}

test("Goldfrank direct sanitizer preserves all 420 chapters and repairs clinical Markdown invariants", async () => {
  const sourceRoot = new URL("../../../outputs/02_learning_guides/goldfrank/", import.meta.url);
  const sourceNames = (await readdir(sourceRoot))
    .filter((name) => /^goldfrank-CH\d{3}-(?:full|standard|quick)\.md$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  assert.equal(sourceNames.length, 140 * 3);

  const sanitized = new Map();
  for (const sourceName of sourceNames) {
    const raw = await readFile(new URL(sourceName, sourceRoot), "utf8");
    const sourceIdentity = /^goldfrank-CH(\d{3})-(full|standard|quick)\.md$/u.exec(sourceName);
    assert(sourceIdentity);
    const [, id, mode] = sourceIdentity;
    const sourceHeading = /^#\s+第\s*(\d+)\s*章\s*｜\s*(.+)$/mu.exec(raw);
    assert(sourceHeading, sourceName + ": source H1 is malformed");
    assert.equal(Number(sourceHeading[1]), Number(id), sourceName + ": source H1 number mismatch");

    const markdown = sanitizeGoldfrankGuideMarkdown(raw);
    const h1Headings = markdown.match(/^#\s+\S.*$/gmu) ?? [];
    assert.equal(h1Headings.length, 1, sourceName + ": expected exactly one H1");
    assert.doesNotMatch(markdown, /(?:^|\n|[。！？；;]\s*)的[^\n]*/mu, sourceName + ": orphaned sentence fragment");
    assert.doesNotMatch(markdown, /\?sfvrsn=|google\.com\/s2\/favicons|utm_source=chatgpt\.com/iu, sourceName + ": malformed citation residue");
    assert.doesNotMatch(markdown, /^={2,}\s*$/mu, sourceName + ": Setext formula became a heading");
    assert.doesNotMatch(markdown, /^\$\s*$/mu, sourceName + ": display math uses a single-dollar delimiter");
    const displayMathMarkers = markdown.match(/^\$\$\s*$/gmu) ?? [];
    assert.equal(displayMathMarkers.length % 2, 0, sourceName + ": unbalanced display-math delimiters");
    assert.deepEqual(findBareFormulaLines(markdown), [], sourceName + ": bare formula line outside display math");
    assert.equal(sanitizeGoldfrankGuideMarkdown(raw), markdown, sourceName + ": sanitizer is not deterministic");
    sanitized.set([id, mode].join(":"), markdown);
  }

  const chapter007 = sanitized.get("007:full");
  assert.match(
    chapter007,
    /\$\$\n\\text\{Osmol gap\}[\s\S]*?\\text\{Measured serum osmolality\}\n-\n\\text\{Calculated serum osmolarity\}\n\$\$/u,
  );

  const chapter009 = sanitized.get("009:full");
  assert.match(chapter009, /\\frac\{14\}\{0\.25\(2\)\+0\.1\}=23\.3\\ \\mathrm\{mg\/L\}/u);
  assert.doesNotMatch(chapter009, /9\. \\frac\{14\}/u);

  const chapter010 = sanitized.get("010:full");
  assert.match(chapter010, /\$\$\n\[H\^\+\] = 10\^\{-3\}\\ \\mathrm\{M\},\\quad \\mathrm\{pH\}=3\n\$\$/u);
  assert.doesNotMatch(chapter010, /10\^\{-3\};M/u);

  const chapter029 = sanitized.get("029:full");
  assert.match(chapter029, /\* \*\*再電擊時機\*\*：若低於 30°C 的初次電擊無效/u);
  assert.doesNotMatch(chapter029, /^[-*]\s*：/mu);

  const chapter046 = sanitized.get("046:full");
  assert.match(
    chapter046,
    /\$\$\n\[\\mathrm\{PG\}\]\\ \(\\mathrm\{mg\/dL\}\)=-82\.1\+6\.5\\times\(\\mathrm\{osmolar\\ gap\}\)\n\$\$/u,
  );
  assert.doesNotMatch(chapter046, /^\s*[\[\]]\s*$/mu);

  assert.doesNotMatch(sanitized.get("064:full"), /\?sfvrsn=|原書\?/u);

  const chapter104 = sanitized.get("104:full");
  assert.equal((chapter104.match(/^#\s/gmu) ?? []).length, 1);
  assert.match(
    chapter104,
    /\$\$\n\\text\{Magnesium sulfate \}4\\ \\mathrm\{g\}=20\\ \\mathrm\{mL\\ of\\ 20\\%\\ solution\}\n\$\$/u,
  );
  assert.match(
    chapter104,
    /\$\$\n25\\ \\text\{mL of 10\\% calcium gluconate\}\n\+\n75\\ \\text\{mL water-soluble lubricant\}\n\$\$/u,
  );
  assert.match(
    chapter104,
    /\$\$\n10\\ \\text\{mL of 10\\% calcium gluconate\}\n\+\n40\\ \\text\{mL D5W 或 NS\}\n\$\$/u,
  );

  const chapter128 = sanitized.get("128:full");
  assert.match(chapter128, /\$\$\nE\\approx D\\times w_R\\times w_T\n\$\$/u);
  assert.match(chapter128, /\*\*D\*\* 為 absorbed dose，\*\*w_R\*\* 為 radiation weighting，\*\*w_T\*\* 為 tissue weighting/u);
  assert.match(chapter128, /\$\$\nT=\\frac\{N\}\{L\}\+E\n\$\$/u);
  assert.match(chapter128, /\*\*N\/L\*\*：neutrophil-to-lymphocyte ratio。[\s\S]*\*\*E=0\*\*：無 emesis。[\s\S]*\*\*E=1\*\*：有 emesis。/u);
  assert.match(
    chapter128,
    /原章以 serial absolute lymphocyte count 的下降速度作為 dose-estimation 線索。下降愈快通常代表 dose 愈高/u,
  );
  assert.doesNotMatch(chapter128, /(?:原章)?設定\s*。/u);

  const chapter139 = sanitized.get("139:full");
  assert.match(chapter139, /\$\$\nA=C\\times W\\times r\n\$\$/u);
  assert.match(chapter139, /\*\*A\*\*：採樣時體內已達平衡的 ethanol amount；[\s\S]*\*\*C\*\*：blood ethanol concentration；[\s\S]*\*\*W\*\*：body weight；[\s\S]*\*\*r\*\*：water-distribution factor/u);
});

test("Goldfrank learning guide publishes all 140 sanitized chapters with verified content", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../public/guides/goldfrank/manifest.json", import.meta.url),
    "utf8",
  ));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.chapterCount, 140);
  assert.equal(manifest.defaultMode, "full");
  assert.equal(manifest.chapters.length, 140);
  assert.match(manifest.sourceRevision, /^[a-f0-9]{20}$/u);

  const contentHashes = [];
  const publishedMarkdown = new Map();
  const depths = [
    { id: "quick", suffix: "-quick", minimumCharacters: 500 },
    { id: "standard", suffix: "-standard", minimumCharacters: 600 },
    { id: "full", suffix: "", minimumCharacters: 2_000 },
  ];
  for (let index = 0; index < manifest.chapters.length; index += 1) {
    const number = index + 1;
    const id = String(number).padStart(3, "0");
    const chapter = manifest.chapters[index];
    assert.equal(chapter.id, id);
    assert.equal(chapter.number, number);
    assert.equal(chapter.order, number);
    assert.equal(chapter.markdownPath, `/guides/goldfrank/chapters/${id}.md`);
    assert(chapter.title.length > 0);
    assert.equal(chapter.modes.full.bytes, chapter.bytes);
    assert.equal(chapter.modes.full.contentHash, chapter.contentHash);
    assert.equal(chapter.modes.full.markdownPath, chapter.markdownPath);
    assert.equal(new Set(depths.map((depth) => chapter.modes[depth.id].contentHash)).size, depths.length);

    for (const depth of depths) {
      const mode = chapter.modes[depth.id];
      assert.equal(mode.markdownPath, `/guides/goldfrank/chapters/${id}${depth.suffix}.md`);
      assert(mode.headingTitle.length > 0);
      assert.match(mode.sourceSha256, /^[a-f0-9]{64}$/u);
      const bytes = await readFile(new URL(`../public${mode.markdownPath}`, import.meta.url));
      const markdown = bytes.toString("utf8");
      assert.equal(bytes.byteLength, mode.bytes);
      assert.equal(sha256(bytes), mode.contentHash);
      assert.match(markdown, /^#\s+\S.*$/mu);
      assert.doesNotMatch(markdown, /^#\s+第\s*\d+\s*章\s*｜/u);
      assert.doesNotMatch(markdown, goldfrankProductionLanguagePattern);
      assert.doesNotMatch(markdown, /google\.com\/s2\/favicons|utm_source=chatgpt\.com/iu);
      assert.doesNotMatch(markdown, /\[[^\]\n]*\+\d+[^\]\n]*\]\(https?:\/\//iu);
      assert.doesNotMatch(markdown, /(?:^|[。！？；;]\s*)(?:指出|稱|列出|提及|認為|記載|描述|引用|引述|報告|說明|呈現|提出)/mu);
      assert.doesNotMatch(markdown, /^#{2,6}\s+\d+(?:\.\d+)*\.?\s*$/mu);
      assert.equal(sanitizeGoldfrankProductionNotes(markdown), markdown);
      assert(markdown.length >= depth.minimumCharacters);
      publishedMarkdown.set(`${id}:${depth.id}`, markdown);
      contentHashes.push(mode.contentHash);
    }
  }

  assert.equal(
    sha256(Buffer.from(contentHashes.join(""), "utf8")).slice(0, 20),
    manifest.sourceRevision,
  );
  assert.match(publishedMarkdown.get("004:full"), /glucarpidase 的攝氏儲存範圍缺少上限/u);
  assert.match(publishedMarkdown.get("004:full"), /15°F–30°F/u);
  assert.match(publishedMarkdown.get("034:full"), /life-threatening neurosurgical emergency/u);
  assert.doesNotMatch(publishedMarkdown.get("037:full"), /章節來源|原始章節\s*PDF/iu);
  assert.match(publishedMarkdown.get("094:full"), /章內文獻大致截至 2017 年/u);
  assert.match(publishedMarkdown.get("094:full"), /不等同於 2026 年最新臨床指引/u);
  assert.match(publishedMarkdown.get("139:full"), /不得直接視為 2026 年台灣或任何司法管轄區的現行法律/u);
});

test("Goldfrank guide data loader enforces the complete 140-chapter contract", async () => {
  const [loader, importer, codec, packageJson] = await Promise.all([
    readFile(new URL("../app/lib/goldfrank-guides.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/import-goldfrank-guide.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lib/static-content-codec.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(loader, /chapterCount = 140/u);
  assert.match(loader, /loadGoldfrankGuideManifest/u);
  assert.match(loader, /loadGoldfrankGuideMarkdown/u);
  assert.match(loader, /resolveGoldfrankGuideContent/u);
  assert.match(importer, /sanitizeGoldfrankGuideMarkdown/u);
  assert.match(importer, /sourceSha256/u);
  assert.match(importer, /written chapter failed byte-for-byte verification/u);
  assert.match(codec, /guides\/goldfrank\/manifest\.json/u);
  assert.match(packageJson, /"import:goldfrank-guide"/u);
});
