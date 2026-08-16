import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-player-finish-v3";
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {};

async function seedPlayer(page) {
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
  await page.waitForTimeout(250);
}

function center(box) {
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

async function mobileQA(width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await seedPlayer(page);

  const tickCount = await page.locator(".audio-section-node").count();
  if (tickCount !== 0) throw new Error(`mobile ${width}: permanent section ticks remain: ${tickCount}`);

  const [playBox, rateBox, resetBox, settingsBox, closeVisible] = await Promise.all([
    page.locator(".audio-player-main-toggle").boundingBox(),
    page.locator(".audio-player-rate").boundingBox(),
    page.locator(".audio-player-reset").boundingBox(),
    page.locator(".audio-player-settings > summary").boundingBox(),
    page.locator(".audio-player-close").isVisible(),
  ]);
  const play = center(playBox);
  const rate = center(rateBox);
  const reset = center(resetBox);
  const settings = center(settingsBox);
  if (!play || !rate || !reset || !settings) throw new Error(`mobile ${width}: missing control geometry`);
  if (closeVisible) throw new Error(`mobile ${width}: destructive close still exposed on expanded surface`);
  const secondaryCenter = (rate.x + settings.x) / 2;
  if (Math.abs(secondaryCenter - play.x) > 1.1) {
    throw new Error(`mobile ${width}: secondary rail not centered on play axis: ${JSON.stringify({ play, rate, reset, settings })}`);
  }
  if (Math.abs(reset.x - play.x) > 1.1) {
    throw new Error(`mobile ${width}: restart is not on the play axis: ${JSON.stringify({ play, reset })}`);
  }
  const leftGap = reset.x - rate.x;
  const rightGap = settings.x - reset.x;
  if (Math.abs(leftGap - rightGap) > 1.1) {
    throw new Error(`mobile ${width}: secondary spacing asymmetric: ${leftGap} vs ${rightGap}`);
  }

  await page.screenshot({ path: path.join(outDir, `mobile-${width}-expanded.png`), fullPage: true });

  await page.locator(".audio-player-settings > summary").tap();
  await page.locator(".audio-player-settings-panel").waitFor({ state: "visible" });
  if (!(await page.locator(".audio-player-settings-dismiss").isVisible())) {
    throw new Error(`mobile ${width}: Settings close action missing`);
  }
  await page.screenshot({ path: path.join(outDir, `mobile-${width}-settings.png`), fullPage: true });
  await page.keyboard.press("Escape");

  report[`mobile-${width}`] = {
    tickCount,
    play,
    rate,
    reset,
    settings,
    leftGap,
    rightGap,
    closeVisible,
    overflow: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  };
  if (report[`mobile-${width}`].overflow > 1) throw new Error(`mobile ${width}: horizontal overflow`);
  await context.close();
}

async function desktopQA() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await seedPlayer(page);
  const tickCount = await page.locator(".audio-section-node").count();
  if (tickCount !== 0) throw new Error(`desktop: permanent section ticks remain: ${tickCount}`);
  await page.screenshot({ path: path.join(outDir, "desktop-expanded.png"), fullPage: true });

  const question = await page.evaluate(async () => {
    const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
    const catalog = await response.json();
    const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
    const source = entries.find((entry) => entry.kind === "question-set" && Number.isInteger(entry.questionStart));
    if (!source) return null;
    const q = String(source.questionStart).padStart(3, "0");
    return { sourceId: source.id, questionId: `${source.chapterLabel ?? ""}-Q${q}`.replace(/^\s*-/, "") };
  });
  if (!question) throw new Error("No question-set source for anchored-menu QA");

  await page.evaluate((detail) => {
    const trigger = document.querySelector(".audio-player-title");
    if (!(trigger instanceof HTMLElement)) throw new Error("QA anchor missing");
    window.dispatchEvent(new CustomEvent("em-board-question-audio-choice", {
      detail: { ...detail, trigger },
    }));
  }, question);
  const menu = page.locator(".audio-question-choice-popover");
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  const geometry = await page.evaluate(() => {
    const trigger = document.querySelector(".audio-player-title")?.getBoundingClientRect();
    const menuBox = document.querySelector(".audio-question-choice-popover")?.getBoundingClientRect();
    if (!trigger || !menuBox) return null;
    return {
      trigger: { left: trigger.left, right: trigger.right, top: trigger.top, bottom: trigger.bottom, width: trigger.width },
      menu: { left: menuBox.left, right: menuBox.right, top: menuBox.top, bottom: menuBox.bottom, width: menuBox.width },
    };
  });
  if (!geometry) throw new Error("Question menu geometry missing");
  if (geometry.menu.top < geometry.trigger.bottom + 6) {
    throw new Error(`Question menu is not below its trigger: ${JSON.stringify(geometry)}`);
  }
  const triggerCenter = geometry.trigger.left + geometry.trigger.width / 2;
  const menuCenter = geometry.menu.left + geometry.menu.width / 2;
  if (Math.abs(triggerCenter - menuCenter) > 2) {
    throw new Error(`Question menu is not centered under its trigger: ${JSON.stringify(geometry)}`);
  }
  await page.screenshot({ path: path.join(outDir, "desktop-anchored-question-menu.png"), fullPage: true });
  report.desktop = { tickCount, questionMenu: geometry };
  await context.close();
}

await desktopQA();
await mobileQA(390);
await mobileQA(430);
await fs.writeFile(path.join(outDir, "verification.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
