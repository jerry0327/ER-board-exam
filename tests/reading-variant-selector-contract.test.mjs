import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("../app/components/reading-variant-selector.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("shared reading selector keeps a controlled responsive matrix and mobile two-stage flow", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /ReadingEdition = "concise"\s*\|\s*"detailed"/);
  assert.match(source, /ReadingDepth = "quick"\s*\|\s*"standard"\s*\|\s*"full"\s*\|\s*"raw"/);
  assert.match(source, /type SelectorStage = "collapsed" \| "editions" \| "depth"/);
  assert.match(source, /value: ReadingVariantValue/);
  assert.match(source, /onCommit: \(value: ReadingVariantValue\) => void/);
  assert.match(source, /editionOptions: ReadingEditionOption\[\]/);
  assert.match(source, /depthOptions\?: ReadingDepthOption\[\]/);
  assert.match(source, /disabled\?: boolean/);
  assert.match(source, /reason\?: string/);

  const defaultDepths = source.match(/defaultReadingDepthOptions[\s\S]*?\n\];/)?.[0] ?? "";
  assert.deepEqual([...defaultDepths.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]), ["quick", "standard", "full"]);
  assert.deepEqual([...defaultDepths.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]), ["速讀", "普通", "完整版"]);
  assert.doesNotMatch(defaultDepths, /id: "raw"/);

  const stageOne = source.match(/const selectEdition[\s\S]*?\n  };/)?.[0] ?? "";
  assert.doesNotMatch(stageOne, /onCommit/);
  assert.match(stageOne, /setStage\("depth"\)/);
  assert.equal((source.match(/onCommit\(\{ edition, depth: option\.id \}\)/g) ?? []).length, 1);
  assert.match(source, /setStage\("collapsed"\)/);
  assert.match(source, /committingRef/);
});

test("desktop exposes every edition-depth combination while mobile remains compact", async () => {
  const [source, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(source, /className="reading-variant-selector__desktop-matrix"/);
  assert.match(source, /editionOptions\.map\(\(edition, editionIndex\)[\s\S]*?depthOptions\.map\(\(option, depthIndex\)/);
  assert.match(source, /onClick=\{\(\) => commitVariant\(edition\.id, option, false\)\}/);
  assert.match(source, /className="reading-variant-selector__mobile-flow"/);
  assert.match(css, /\.reading-variant-selector__desktop-matrix \{[\s\S]*?display: grid;/);
  assert.match(css, /grid-template-columns: repeat\(var\(--reading-depth-count, 3\), minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.reading-variant-selector__desktop-matrix \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.reading-variant-selector__mobile-flow \{ display: flex; width: 100%; \}/);
});

test("shared reading selector exposes accessible reversible and locked states", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /stage === "depth" \? "editions" : "collapsed"/);
  assert.match(source, /aria-busy=/);
  assert.match(source, /aria-disabled=/);
  assert.match(source, /aria-controls=/);
  assert.match(source, /aria-expanded=/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-describedby=/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /返回內容版本選擇/);
  assert.match(source, /變更閱讀模式，目前為/);
});

test("shared reading selector staggers complexity choices and stays one row on mobile", async () => {
  const [source, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(source, /"--index": index/);
  assert.match(css, /Shared two-stage reading variant selector/);
  assert.match(css, /animation-delay: calc\(var\(--index\) \* 50ms\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?flex-wrap: nowrap/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.reading-variant-selector[\s\S]*?animation: none/);
  assert.match(css, /reading-variant-chip-morph/);
});
