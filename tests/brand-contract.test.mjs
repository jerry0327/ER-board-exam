import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

test("急專補給站 brand is unified across metadata and site chrome", async () => {
  const [layout, app, css, manifest] = await Promise.all([
    text("app/layout.tsx"),
    text("app/question-bank-app.tsx"),
    text("app/site.css"),
    text("public/site.webmanifest"),
  ]);

  assert.match(layout, /急專補給站｜急診專科題庫、指引與音檔/u);
  assert.match(layout, /apple-touch-icon\.png/u);
  assert.match(layout, /siteName: "急專補給站"/u);
  assert.match(layout, /locale: "zh_TW"/u);
  assert.match(layout, /width: 1200, height: 630/u);
  assert.doesNotMatch(layout, /favicon\.svg/u);
  assert.match(app, /<strong>急專補給站<\/strong>/u);
  assert.match(app, /題庫・指引・音檔/u);
  assert.match(css, /jizhuan-rosc-icon-64\.png/u);
  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.name, "急專補給站");
  assert.equal(parsedManifest.id, "/");
  assert.equal(parsedManifest.scope, "/");
});

test("selected app icon sizes are present", async () => {
  for (const path of [
    "public/brand/jizhuan-rosc-icon-16.png",
    "public/brand/jizhuan-rosc-icon-32.png",
    "public/brand/jizhuan-rosc-icon-192.png",
    "public/brand/jizhuan-rosc-icon-512.png",
    "public/brand/jizhuan-rosc-maskable-512.png",
    "public/apple-touch-icon.png",
    "public/favicon.ico",
    "public/og.png",
  ]) {
    assert((await stat(new URL(path, root))).size > 0, `${path} must not be empty`);
  }
});
