import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

const root = new URL("../", import.meta.url);

test("Sites uses deployable font references and the selected favicon assets", async () => {
  const [layout, runtimeCss, faviconIco, favicon16, favicon32, favicon48] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readLegacyCss(),
    stat(new URL("public/favicon.ico", root)),
    stat(new URL("public/brand/jizhuan-rosc-icon-16.png", root)),
    stat(new URL("public/brand/jizhuan-rosc-icon-32.png", root)),
    stat(new URL("public/brand/jizhuan-rosc-icon-48.png", root)),
  ]);

  assert.doesNotMatch(layout, /next\/font/);
  assert.doesNotMatch(runtimeCss, /font-geist/);
  assert.doesNotMatch(layout, /favicon\.svg/u);
  assert.match(layout, /jizhuan-rosc-icon-16\.png/u);
  assert.match(layout, /jizhuan-rosc-icon-32\.png/u);
  assert.match(layout, /jizhuan-rosc-icon-48\.png/u);
  assert.ok(faviconIco.size > 1_000);
  assert.ok(favicon16.size > 0);
  assert.ok(favicon32.size > 0);
  assert.ok(favicon48.size > 0);
});
