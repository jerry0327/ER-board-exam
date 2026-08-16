import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-player-balance-proof";
await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = {};

async function seed(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const source = await page.evaluate(async () => {
    const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    const catalog = await response.json();
    const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
    return entries.find((entry) => entry.chapterLabel === "CH.001")
      ?? entries.find((entry) => entry.kind === "textbook-chapter");
  });
  if (!source?.id) throw new Error("No textbook audio source found");
  await page.evaluate((selected) => {
    localStorage.setItem("em-board-audio-player-v2", JSON.stringify({
      sourceId: selected.id,
      position: 405.4,
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
  await page.locator(".audio-section-inline-control").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(350);
}

async function metrics(page) {
  return page.evaluate(() => {
    const qs = (s) => document.querySelector(s);
    const rect = (s) => {
      const r = qs(s)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
    };
    const style = (s) => {
      const el = qs(s);
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        backgroundColor: c.backgroundColor,
        borderTopWidth: c.borderTopWidth,
        borderRightWidth: c.borderRightWidth,
        borderBottomWidth: c.borderBottomWidth,
        borderLeftWidth: c.borderLeftWidth,
        borderRadius: c.borderRadius,
        boxShadow: c.boxShadow,
        color: c.color,
      };
    };
    const dock = rect(".audio-player-dock");
    const play = rect(".audio-player-main-toggle");
    const controls = rect(".audio-player-controls");
    const transport = rect(".audio-player-transport");
    const rate = rect(".audio-player-rate select");
    const inline = rect(".audio-section-inline-control");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dock,
      controls,
      transport,
      rate,
      inline,
      centerDelta: dock && play ? Math.abs((dock.left + dock.width / 2) - (play.left + play.width / 2)) : null,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stowStyle: style(".audio-player-stow"),
      expandStyle: style(".audio-player-expand"),
      rateStyle: style(".audio-player-rate select"),
      resetStyle: style(".audio-player-utilities > .audio-player-utility"),
    };
  });
}

function assertQuietChrome(m, label) {
  for (const [name, s] of [["stow", m.stowStyle], ["expand", m.expandStyle], ["rate", m.rateStyle]]) {
    if (!s) throw new Error(`${label}: missing ${name}`);
    const borders = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth];
    if (borders.some((value) => Number.parseFloat(value) > 0.1)) {
      throw new Error(`${label}: ${name} still has visible border ${JSON.stringify(s)}`);
    }
  }
  if (!m.rate || m.rate.height < 40) throw new Error(`${label}: rate hit target too short ${JSON.stringify(m.rate)}`);
  if (m.centerDelta === null || m.centerDelta > 4) throw new Error(`${label}: primary play is not centered (${m.centerDelta})`);
  if (m.horizontalOverflow > 1) throw new Error(`${label}: horizontal page overflow ${m.horizontalOverflow}`);
  if (!m.inline || !m.dock || m.inline.right > m.dock.right + 1 || m.inline.left < m.dock.left - 1) {
    throw new Error(`${label}: inline Section control overflow ${JSON.stringify({ inline: m.inline, dock: m.dock })}`);
  }
}

async function runViewport(name, viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await seed(page);
  const m = await metrics(page);
  assertQuietChrome(m, name);
  report[name] = { normal: m };
  await page.locator(".audio-player-dock").screenshot({ path: path.join(outDir, `${name}-expanded.png`) });

  await page.locator(".audio-player-rate select").hover({ force: true });
  await page.waitForTimeout(80);
  report[name].rateHover = await metrics(page);
  await page.locator(".audio-player-dock").screenshot({ path: path.join(outDir, `${name}-rate-hover.png`) });

  await page.locator(".audio-player-expand").hover({ force: true });
  await page.waitForTimeout(80);
  report[name].expandHover = await metrics(page);
  await page.locator(".audio-player-dock").screenshot({ path: path.join(outDir, `${name}-expand-hover.png`) });

  await page.locator(".audio-player-settings > summary").click();
  await page.locator(".audio-player-settings-panel").waitFor({ state: "visible" });
  await page.locator(".audio-player-dock").screenshot({ path: path.join(outDir, `${name}-settings.png`) });
  await page.keyboard.press("Escape");
  await context.close();
}

await runViewport("desktop-1440", { width: 1440, height: 900 });
await runViewport("mobile-390", { width: 390, height: 844 }, true);
await runViewport("mobile-430", { width: 430, height: 844 }, true);

await fs.writeFile(path.join(outDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
