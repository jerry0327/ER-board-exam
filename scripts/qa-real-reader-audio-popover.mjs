import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-real-reader-audio-popover";
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();

await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
const question = await page.evaluate(async () => {
  const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  const catalog = await response.json();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  const source = entries.find((entry) => entry.kind === "question-set" && Number.isInteger(entry.questionStart));
  if (!source) return null;
  const q = String(source.questionStart).padStart(3, "0");
  return {
    sourceId: source.id,
    questionId: `${source.chapterLabel ?? ""}-Q${q}`.replace(/^\s*-/, "").toUpperCase(),
  };
});
if (!question?.questionId) throw new Error("No question-set source with a question id found");

await page.goto(`${baseUrl}/#reader/${question.questionId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
const trigger = page.locator(".reading-toolbar-audio");
await trigger.waitFor({ state: "visible", timeout: 90_000 });
await page.waitForTimeout(500);
await trigger.click();

const menu = page.locator(".audio-question-choice-popover");
await menu.waitFor({ state: "visible", timeout: 10_000 });
await page.waitForTimeout(150);

const geometry = await page.evaluate(() => {
  const triggerBox = document.querySelector(".reading-toolbar-audio")?.getBoundingClientRect();
  const menuBox = document.querySelector(".audio-question-choice-popover")?.getBoundingClientRect();
  if (!triggerBox || !menuBox) return null;
  return {
    trigger: { left: triggerBox.left, right: triggerBox.right, top: triggerBox.top, bottom: triggerBox.bottom, width: triggerBox.width },
    menu: { left: menuBox.left, right: menuBox.right, top: menuBox.top, bottom: menuBox.bottom, width: menuBox.width },
    gap: menuBox.top - triggerBox.bottom,
    centerDelta: (menuBox.left + menuBox.width / 2) - (triggerBox.left + triggerBox.width / 2),
  };
});
if (!geometry) throw new Error("ReaderView audio popover geometry missing");
if (geometry.gap < 6 || geometry.gap > 10) throw new Error(`Unexpected popover gap: ${JSON.stringify(geometry)}`);
if (Math.abs(geometry.centerDelta) > 2) throw new Error(`Popover not centered under actual ReaderView audio button: ${JSON.stringify(geometry)}`);

await page.screenshot({ path: `${outDir}/reader-audio-button-popover.png`, fullPage: false });
const triggerBox = await trigger.boundingBox();
const menuBox = await menu.boundingBox();
if (triggerBox && menuBox) {
  const left = Math.max(0, Math.min(triggerBox.x, menuBox.x) - 80);
  const top = Math.max(0, Math.min(triggerBox.y, menuBox.y) - 80);
  const right = Math.min(1440, Math.max(triggerBox.x + triggerBox.width, menuBox.x + menuBox.width) + 80);
  const bottom = Math.min(900, Math.max(triggerBox.y + triggerBox.height, menuBox.y + menuBox.height) + 80);
  await page.screenshot({
    path: `${outDir}/reader-audio-button-popover-crop.png`,
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  });
}
await fs.writeFile(`${outDir}/verification.json`, JSON.stringify({ question, geometry }, null, 2));
console.log(JSON.stringify({ question, geometry }, null, 2));

await browser.close();
