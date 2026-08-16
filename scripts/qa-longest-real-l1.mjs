import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-original-player-proof";
const expectedTitle = "Diphenhydramine 毒性與 physostigmine";
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
const source = await page.evaluate(async () => {
  const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  const catalog = await response.json();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  return entries.find((entry) => entry.id === "goldfrank-048")
    ?? entries.find((entry) => entry.chapterLabel === "CH.048" && String(entry.collectionId ?? "").toLowerCase().includes("goldfrank"));
});
if (!source?.id) throw new Error("Could not resolve the deployed Goldfrank CH.048 source");

await page.evaluate((selected) => {
  localStorage.setItem("em-board-audio-player-v2", JSON.stringify({
    sourceId: selected.id,
    position: 0,
    rate: 1,
    expanded: true,
    stowed: false,
    continuousPlay: true,
    queueIds: [],
    randomReview: false,
  }));
  localStorage.setItem("em-board-audio-subtitles-v1", "false");
}, source);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
await page.locator(".audio-player-dock").waitFor({ state: "visible", timeout: 60_000 });
await page.locator(".audio-player-details").waitFor({ state: "visible", timeout: 60_000 });
await page.locator(".audio-section-toggle").waitFor({ state: "visible", timeout: 60_000 });
await page.locator(".audio-section-toggle").click();
const panel = page.locator(".audio-section-panel-floating");
await panel.waitFor({ state: "visible", timeout: 30_000 });
const target = panel.locator(".audio-section-list-l1", { hasText: expectedTitle }).first();
await target.waitFor({ state: "visible", timeout: 30_000 });
await target.tap();
await page.waitForTimeout(250);

const metrics = await page.evaluate((title) => {
  const inline = document.querySelector(".audio-section-inline-title");
  const control = document.querySelector(".audio-section-inline-control");
  const row = document.querySelector(".audio-player-time-row");
  const dock = document.querySelector(".audio-player-dock");
  const index = document.querySelector(".audio-section-inline-index");
  if (!(inline instanceof HTMLElement) || !(control instanceof HTMLElement) || !(row instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
    throw new Error("Inline Section geometry is unavailable");
  }
  const style = getComputedStyle(inline);
  const rect = inline.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const controlRect = control.getBoundingClientRect();
  return {
    expectedTitle: title,
    actualTitle: inline.textContent?.trim() ?? "",
    index: index?.textContent?.trim() ?? "",
    clientWidth: inline.clientWidth,
    scrollWidth: inline.scrollWidth,
    clientHeight: inline.clientHeight,
    scrollHeight: inline.scrollHeight,
    rect: { width: rect.width, height: rect.height },
    row: { width: rowRect.width, height: rowRect.height },
    control: { width: controlRect.width, height: controlRect.height },
    dock: { width: dockRect.width, height: dockRect.height },
    whiteSpace: style.whiteSpace,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    textOverflow: style.textOverflow,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  };
}, expectedTitle);

if (metrics.actualTitle !== expectedTitle) throw new Error(`Longest L1 text mismatch: ${JSON.stringify(metrics)}`);
if (metrics.textOverflow === "ellipsis") throw new Error(`Longest L1 uses ellipsis: ${JSON.stringify(metrics)}`);
if (metrics.scrollWidth > metrics.clientWidth + 1 || metrics.scrollHeight > metrics.clientHeight + 1) {
  throw new Error(`Longest L1 is clipped: ${JSON.stringify(metrics)}`);
}
if (metrics.documentWidth > metrics.viewportWidth + 1) throw new Error(`Longest L1 causes horizontal overflow: ${JSON.stringify(metrics)}`);
if (metrics.row.height > 52) throw new Error(`Longest L1 consumes too much timeline height: ${JSON.stringify(metrics)}`);
if (metrics.dock.height > 290) throw new Error(`Longest L1 distorts the mobile player: ${JSON.stringify(metrics)}`);

await page.screenshot({ path: path.join(outDir, "12-mobile-390-longest-real-l1.png"), fullPage: true });
await fs.writeFile(path.join(outDir, "longest-real-l1-runtime.json"), `${JSON.stringify({ source, metrics }, null, 2)}\n`);
await context.close();
await browser.close();
console.log(JSON.stringify({ source, metrics }, null, 2));
