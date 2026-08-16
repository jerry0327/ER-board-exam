import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-compact-player-proof";
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = { desktop: {}, mobile: {} };

async function selectSource(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const source = await page.evaluate(async () => {
    const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    const catalog = await response.json();
    const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
    return entries.find((entry) => entry.chapterLabel === "CH.001")
      ?? entries.find((entry) => entry.kind === "textbook-chapter");
  });
  if (!source?.id) throw new Error("No real textbook source found");
  await page.evaluate((selected) => {
    localStorage.setItem("em-board-audio-player-v2", JSON.stringify({
      sourceId: selected.id,
      position: Math.min(405.4, Math.max(0, selected.durationSeconds / 3)),
      rate: 1,
      expanded: true,
      stowed: false,
      continuousPlay: true,
      queueIds: [],
      randomReview: false,
    }));
    localStorage.setItem("em-board-audio-subtitles-v1", "true");
  }, source);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".audio-player-dock").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".audio-player-details").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(350);
  return source;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}

async function timelineGeometry(page) {
  return page.evaluate(() => {
    const center = (selector) => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : null;
    };
    const track = center(".audio-section-track-base");
    const playhead = center(".audio-section-playhead");
    const nodes = [...document.querySelectorAll(".audio-section-node")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    return {
      track,
      playhead,
      nodes,
      maxDelta: track === null || playhead === null || nodes.length === 0
        ? null
        : Math.max(Math.abs(playhead - track), ...nodes.map((value) => Math.abs(value - track))),
    };
  });
}

async function compactGeometry(page) {
  return page.evaluate(() => {
    const dock = document.querySelector(".audio-player-dock")?.getBoundingClientRect();
    const mini = document.querySelector(".audio-player-mini")?.getBoundingClientRect();
    const progress = document.querySelector(".audio-player-edge-progress")?.getBoundingClientRect();
    return {
      dock: dock ? { width: dock.width, height: dock.height, top: dock.top, bottom: dock.bottom } : null,
      mini: mini ? { width: mini.width, height: mini.height, top: mini.top, bottom: mini.bottom } : null,
      progress: progress ? { top: progress.top, bottom: progress.bottom, height: progress.height } : null,
    };
  });
}

// Desktop: expanded -> one-row compact -> stowed bubble -> long-press -> drag-dismiss.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const source = await selectSource(page);
  report.desktop.source = source.id;
  report.desktop.expandedTimeline = await timelineGeometry(page);
  if (report.desktop.expandedTimeline.maxDelta === null || report.desktop.expandedTimeline.maxDelta > 0.5) {
    throw new Error(`Desktop timeline not aligned: ${JSON.stringify(report.desktop.expandedTimeline)}`);
  }
  await shot(page, "01-desktop-expanded.png");

  await page.locator(".audio-player-expand").click();
  await page.locator(".audio-player-details").waitFor({ state: "hidden" });
  await page.waitForTimeout(120);
  const compact = await compactGeometry(page);
  report.desktop.compact = compact;
  if (!compact.dock || compact.dock.height > 60) throw new Error(`Desktop compact too tall: ${JSON.stringify(compact)}`);
  if (!compact.progress || Math.abs(compact.progress.top - compact.dock.top) > 2.5) {
    throw new Error(`Desktop progress is not the top edge: ${JSON.stringify(compact)}`);
  }
  if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error("Desktop stow button hidden");
  await shot(page, "02-desktop-compact-top-progress.png");

  await page.locator(".audio-player-stow").click();
  await page.waitForTimeout(120);
  const stowed = await page.locator(".audio-player-dock.is-stowed").boundingBox();
  const restore = await page.locator(".audio-player-restore").boundingBox();
  report.desktop.stowed = { stowed, restore };
  if (!stowed || !restore || stowed.width > 54 || stowed.height > 54 || restore.width < 49 || restore.height < 49) {
    throw new Error(`Desktop stowed geometry wrong: ${JSON.stringify(report.desktop.stowed)}`);
  }
  await shot(page, "03-desktop-stowed-circle.png");

  // Actual long press toggles playback intent without restoring the panel.
  const bubble = await page.locator(".audio-player-restore").boundingBox();
  if (!bubble) throw new Error("Restore bubble missing");
  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  const beforeLabel = await page.locator(".audio-player-restore").getAttribute("aria-label");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(470);
  await page.mouse.up();
  await page.waitForTimeout(350);
  const afterLabel = await page.locator(".audio-player-restore").getAttribute("aria-label");
  report.desktop.longPress = { beforeLabel, afterLabel, phase: await page.locator(".audio-player-dock").getAttribute("data-audio-phase") };
  if (beforeLabel === afterLabel) throw new Error(`Long press did not toggle playback state: ${JSON.stringify(report.desktop.longPress)}`);
  if (!(await page.locator(".audio-player-dock").evaluate((el) => el.classList.contains("is-stowed")))) {
    throw new Error("Long press incorrectly restored the player");
  }

  // Actual dismiss gesture: longer hold, drag into the live X target, release.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(730);
  await page.locator(".audio-player-dismiss-target").waitFor({ state: "visible", timeout: 5_000 });
  await shot(page, "04-desktop-stowed-dismiss-armed.png");
  const target = await page.locator(".audio-player-dismiss-target > span").boundingBox();
  if (!target) throw new Error("Dismiss target missing");
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.waitForTimeout(120);
  if (!(await page.locator(".audio-player-dismiss-target").evaluate((el) => el.classList.contains("is-over")))) {
    throw new Error("Dismiss target did not arm on drag-over");
  }
  await shot(page, "05-desktop-stowed-over-dismiss.png");
  await page.mouse.up();
  await page.waitForTimeout(250);
  report.desktop.dismissed = (await page.locator(".audio-player-dock").count()) === 0;
  if (!report.desktop.dismissed) throw new Error("Drag-to-dismiss did not close the player");
  await context.close();
}

// Mobile/coarse pointer: verify its own geometry and all three states.
for (const width of [390, 430]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await selectSource(page);
  const key = String(width);
  report.mobile[key] = {};

  const geometry = await timelineGeometry(page);
  report.mobile[key].timeline = geometry;
  if (geometry.maxDelta === null || geometry.maxDelta > 0.5) {
    throw new Error(`Mobile ${width} timeline not aligned: ${JSON.stringify(geometry)}`);
  }
  const node = page.locator(".audio-section-node").nth(3);
  if (!(await node.isVisible())) throw new Error(`Mobile ${width} Section node not visible`);
  const before = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  await node.click({ force: false });
  await page.waitForTimeout(180);
  const after = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  report.mobile[key].nodeSeek = { before, after };
  if (Math.abs(after - before) < 1) throw new Error(`Mobile ${width} Section node did not seek`);
  await shot(page, `06-mobile-${width}-expanded.png`);

  await page.locator(".audio-player-expand").click();
  await page.locator(".audio-player-details").waitFor({ state: "hidden" });
  await page.waitForTimeout(100);
  const compact = await compactGeometry(page);
  report.mobile[key].compact = compact;
  if (!compact.dock || compact.dock.height > 62) throw new Error(`Mobile ${width} compact too tall: ${JSON.stringify(compact)}`);
  if (!compact.progress || Math.abs(compact.progress.top - compact.dock.top) > 2.5) {
    throw new Error(`Mobile ${width} progress is not the top edge: ${JSON.stringify(compact)}`);
  }
  if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error(`Mobile ${width} stow hidden`);
  if (await page.locator(".audio-player-expand").isVisible()) throw new Error(`Mobile ${width} compact expand icon should be hidden`);
  if (await page.locator(".audio-player-mini-time").isVisible()) throw new Error(`Mobile ${width} compact time should be hidden`);
  await shot(page, `07-mobile-${width}-compact.png`);

  await page.locator(".audio-player-stow").click();
  await page.waitForTimeout(100);
  const circle = await page.locator(".audio-player-restore").boundingBox();
  report.mobile[key].stowed = circle;
  if (!circle || circle.width < 49 || circle.width > 52.5 || circle.height < 49 || circle.height > 52.5) {
    throw new Error(`Mobile ${width} stowed bubble wrong: ${JSON.stringify(circle)}`);
  }
  await shot(page, `08-mobile-${width}-stowed.png`);

  await page.locator(".audio-player-restore").click();
  await page.waitForTimeout(120);
  if (!(await page.locator(".audio-player-dock.is-collapsed:not(.is-stowed)").isVisible())) {
    throw new Error(`Mobile ${width} restore bubble did not return to compact state`);
  }
  await context.close();
}

await fs.writeFile(path.join(outDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
