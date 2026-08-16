import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-player-proof";
await fs.mkdir(outDir, { recursive: true });

function parseTime(text) {
  const parts = String(text).trim().split(":").map(Number);
  if (parts.some((value) => !Number.isFinite(value))) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => console.log(`[browser-error] ${error.stack ?? error.message}`));

await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
const source = await page.evaluate(async () => {
  const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  const catalog = await response.json();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  return entries.find((entry) => entry.chapterLabel === "CH.001")
    ?? entries.find((entry) => String(entry.title ?? "").includes("Historical Principles"))
    ?? entries.find((entry) => entry.kind === "textbook-chapter");
});
if (!source?.id) throw new Error("No textbook audio source could be selected from the real catalog.");

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
  localStorage.setItem("em-board-audio-subtitles-v1", "true");
}, source);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });

await page.locator(".audio-player-dock").waitFor({ state: "visible", timeout: 60_000 });
await page.locator(".audio-player-details").waitFor({ state: "visible", timeout: 60_000 });
await page.locator(".audio-section-toggle").waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(500);

const report = {
  source: {
    id: source.id,
    title: source.title,
    chapterLabel: source.chapterLabel,
    durationSeconds: source.durationSeconds,
    revision: source.revision,
  },
  screenshots: [],
  selections: [],
};

async function shot(name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(name);
}

async function measureTimelineGeometry() {
  return page.evaluate(() => {
    const centerY = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : null;
    };
    const track = document.querySelector(".audio-section-track-base");
    const playhead = document.querySelector(".audio-section-playhead");
    const nodes = [...document.querySelectorAll(".audio-section-node")];
    const trackCenterY = centerY(track);
    const playheadCenterY = centerY(playhead);
    const nodeCenterYs = nodes.map(centerY).filter((value) => typeof value === "number");
    const deltas = [
      ...(playheadCenterY !== null && trackCenterY !== null ? [Math.abs(playheadCenterY - trackCenterY)] : []),
      ...nodeCenterYs.map((value) => Math.abs(value - trackCenterY)),
    ];
    return {
      trackCenterY,
      playheadCenterY,
      nodeCenterYs,
      maxCenterlineDeltaPx: deltas.length ? Math.max(...deltas) : null,
    };
  });
}

await shot("00-expanded-initial.png");
report.timelineGeometryInitial = await measureTimelineGeometry();
if (report.timelineGeometryInitial.maxCenterlineDeltaPx === null || report.timelineGeometryInitial.maxCenterlineDeltaPx > 0.5) {
  throw new Error(`Timeline centerline mismatch: ${JSON.stringify(report.timelineGeometryInitial)}`);
}

await page.locator(".audio-section-toggle").click();
await page.locator(".audio-section-panel-floating").waitFor({ state: "visible" });
await page.waitForTimeout(150);
await shot("01-section-panel-open.png");

const sectionRows = await page.locator(".audio-section-panel-floating .audio-section-list button").evaluateAll((buttons) => buttons.map((button, index) => ({
  index,
  label: button.querySelector("strong")?.textContent?.trim() ?? "",
  time: button.querySelector("time")?.textContent?.trim() ?? "",
})));
if (sectionRows.length < 3) throw new Error(`Expected at least 3 real Sections, found ${sectionRows.length}.`);

const candidates = sectionRows.length > 4
  ? sectionRows.slice(1, -1).map((row) => row.index)
  : sectionRows.map((row) => row.index);
const chosen = shuffle(candidates).slice(0, Math.min(3, candidates.length));

for (let selectionNumber = 0; selectionNumber < chosen.length; selectionNumber += 1) {
  const sectionIndex = chosen[selectionNumber];
  if (!(await page.locator(".audio-section-panel-floating").isVisible().catch(() => false))) {
    await page.locator(".audio-section-toggle").click();
    await page.locator(".audio-section-panel-floating").waitFor({ state: "visible" });
  }
  const button = page.locator(".audio-section-panel-floating .audio-section-list button").nth(sectionIndex);
  const label = (await button.locator("strong").textContent())?.trim() ?? "";
  const timeText = (await button.locator("time").textContent())?.trim() ?? "";
  const expectedSeconds = parseTime(timeText);
  await button.click();
  await page.locator(".audio-section-panel-floating").waitFor({ state: "hidden" }).catch(() => undefined);
  await page.waitForTimeout(350);

  const rangeValue = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  const currentSection = ((await page.locator(".audio-section-current strong").textContent().catch(() => "")) ?? "").trim();
  const subtitleAria = await page.locator(".audio-subtitle-line.is-current").getAttribute("aria-label").catch(() => null);
  const playerTimes = ((await page.locator(".audio-player-timeline").innerText()) ?? "").trim().split(/\s+/u).filter(Boolean);
  const errorSeconds = Number.isFinite(expectedSeconds) ? Math.abs(rangeValue - expectedSeconds) : null;
  const geometry = await measureTimelineGeometry();

  report.selections.push({
    sectionIndex,
    label,
    sectionTime: timeText,
    expectedSeconds,
    actualRangeSeconds: rangeValue,
    absoluteSeekErrorSeconds: errorSeconds,
    currentSection,
    currentSubtitleAriaLabel: subtitleAria,
    timelineTextTokens: playerTimes,
    geometry,
  });

  if (Number.isFinite(expectedSeconds) && errorSeconds >= 1) {
    throw new Error(`Section seek mismatch for ${label}: expected display-second ${expectedSeconds}, got ${rangeValue}`);
  }
  if (currentSection && currentSection !== label) {
    throw new Error(`Current Section label mismatch: clicked ${label}, UI shows ${currentSection}`);
  }
  if (geometry.maxCenterlineDeltaPx === null || geometry.maxCenterlineDeltaPx > 0.5) {
    throw new Error(`Timeline centerline drift after ${label}: ${JSON.stringify(geometry)}`);
  }
  await shot(`${String(selectionNumber + 2).padStart(2, "0")}-selected-section-${sectionIndex + 1}.png`);
}

const nodeCount = await page.locator(".audio-section-node").count();
if (nodeCount > 2) {
  const nodeIndex = Math.min(nodeCount - 1, Math.max(1, chosen[0] ?? 1));
  const node = page.locator(".audio-section-node").nth(nodeIndex);
  const nodeLabel = await node.getAttribute("aria-label");
  await node.hover();
  await shot("05-section-node-hover.png");
  await node.click();
  await page.waitForTimeout(300);
  report.timelineNodeClick = {
    index: nodeIndex,
    ariaLabel: nodeLabel,
    actualRangeSeconds: Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue()),
    geometry: await measureTimelineGeometry(),
  };
}

await page.locator(".audio-player-expand").click();
await page.locator(".audio-player-details").waitFor({ state: "hidden" });
await page.waitForTimeout(150);
await shot("06-collapsed-player.png");

// Restore expanded state and capture subtitles after a real Section seek.
await page.locator(".audio-player-expand").click();
await page.locator(".audio-player-details").waitFor({ state: "visible" });
await page.waitForTimeout(250);
await shot("07-restored-expanded-with-subtitle.png");

report.finalPlayerState = {
  expanded: await page.locator(".audio-player-details").isVisible(),
  rangeSeconds: Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue()),
  subtitleVisible: await page.locator(".audio-subtitle-float").isVisible().catch(() => false),
  geometry: await measureTimelineGeometry(),
};

await fs.writeFile(path.join(outDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
