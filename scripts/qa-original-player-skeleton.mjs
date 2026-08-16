import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = process.env.QA_OUT_DIR ?? "qa-original-player-proof";
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = { desktop: {}, mobile: {} };

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
    localStorage.setItem("em-board-audio-subtitles-v1", "true");
  }, source);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".audio-player-dock").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".audio-player-details").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".audio-section-toggle").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(350);
  return source;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
    };
    const centerY = (selector) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : null;
    };
    const track = centerY(".audio-section-track-base");
    const playhead = centerY(".audio-section-playhead");
    const nodes = [...document.querySelectorAll(".audio-section-node")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const deltas = track === null || playhead === null ? [] : [Math.abs(playhead - track), ...nodes.map((v) => Math.abs(v - track))];
    return {
      dock: box(".audio-player-dock"),
      mini: box(".audio-player-mini"),
      details: box(".audio-player-details"),
      progress: box(".audio-player-edge-progress"),
      timeline: { track, playhead, nodes, maxDelta: deltas.length ? Math.max(...deltas) : null },
    };
  });
}

async function overlayMetrics(page, selector) {
  return page.evaluate((targetSelector) => {
    const boxFor = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const dock = document.querySelector(".audio-player-dock");
    const target = document.querySelector(targetSelector);
    const subtitle = document.querySelector(".audio-subtitle-float");
    const dockBox = boxFor(dock);
    const targetBox = boxFor(target);
    const subtitleBox = boxFor(subtitle);
    const viewportHeight = window.innerHeight;
    const topEdge = targetBox && dockBox ? Math.min(targetBox.top, dockBox.top) : (dockBox?.top ?? viewportHeight);
    const occupiedBand = Math.max(0, viewportHeight - topEdge);
    const subtitleStyle = subtitle ? getComputedStyle(subtitle) : null;
    return {
      viewport: { width: window.innerWidth, height: viewportHeight },
      dock: dockBox,
      target: targetBox,
      subtitle: subtitleBox,
      occupiedBand,
      occupiedRatio: occupiedBand / viewportHeight,
      remainingAbove: Math.max(0, topEdge),
      remainingRatio: Math.max(0, topEdge) / viewportHeight,
      subtitleOpacity: subtitleStyle?.opacity ?? null,
      subtitlePointerEvents: subtitleStyle?.pointerEvents ?? null,
    };
  }, selector);
}

async function assertOriginalSkeleton(page, label) {
  const order = await page.locator(".audio-player-controls").evaluate((controls) => [...controls.children].map((el) => el.className));
  if (!String(order[0]).includes("audio-player-rate") || !String(order[1]).includes("audio-player-transport") || !String(order[2]).includes("audio-player-utilities")) {
    throw new Error(`${label}: original rate/transport/utilities skeleton not preserved: ${JSON.stringify(order)}`);
  }
  const optionsOutsideSettings = await page.locator(".audio-player-details > .audio-player-options").count();
  if (optionsOutsideSettings !== 0) throw new Error(`${label}: settings options leaked below the player`);
  const settingsOptions = await page.locator(".audio-player-settings-panel .audio-player-option").count();
  if (settingsOptions !== 5) throw new Error(`${label}: expected 5 Settings options, found ${settingsOptions}`);
  const slotIndex = await page.locator(".audio-player-details").evaluate((details) => [...details.children].map((el) => el.className).indexOf("audio-section-slot"));
  const timelineIndex = await page.locator(".audio-player-details").evaluate((details) => [...details.children].map((el) => el.className).indexOf("audio-player-timeline"));
  const controlsIndex = await page.locator(".audio-player-details").evaluate((details) => [...details.children].map((el) => el.className).indexOf("audio-player-controls"));
  if (!(timelineIndex >= 0 && slotIndex === timelineIndex + 1 && controlsIndex > slotIndex)) {
    throw new Error(`${label}: Section slot is not between timeline and controls`);
  }
}

async function assertCenterline(page, label) {
  const g = await geometry(page);
  if (g.timeline.maxDelta === null || g.timeline.maxDelta > 0.5) {
    throw new Error(`${label}: timeline centerline mismatch ${JSON.stringify(g.timeline)}`);
  }
  return g;
}

async function desktopQa() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  report.desktop.source = (await seed(page)).id;
  await assertOriginalSkeleton(page, "desktop");
  report.desktop.expanded = await assertCenterline(page, "desktop");
  if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error("desktop stow missing in expanded state");
  await shot(page, "01-desktop-original-expanded.png");

  await page.locator(".audio-player-settings > summary").click();
  await page.locator(".audio-player-settings-panel").waitFor({ state: "visible" });
  await shot(page, "02-desktop-settings.png");
  await page.keyboard.press("Escape");

  await page.locator(".audio-section-toggle").click();
  await page.locator(".audio-section-panel-floating").waitFor({ state: "visible" });
  await shot(page, "03-desktop-sections.png");
  await page.keyboard.press("Escape");

  await page.locator(".audio-player-expand").click();
  await page.locator(".audio-player-details").waitFor({ state: "hidden" });
  await page.waitForTimeout(120);
  const compact = await geometry(page);
  report.desktop.compact = compact;
  if (!compact.dock || compact.dock.height > 65) throw new Error(`desktop compact too tall: ${JSON.stringify(compact.dock)}`);
  if (!compact.progress || Math.abs(compact.progress.top - compact.dock.top) > 2.5) throw new Error(`desktop edge progress not at top: ${JSON.stringify(compact)}`);
  if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error("desktop compact stow missing");
  await shot(page, "04-desktop-original-compact.png");

  await page.locator(".audio-player-stow").click();
  await page.waitForTimeout(120);
  const bubble = await page.locator(".audio-player-restore").boundingBox();
  report.desktop.stowed = bubble;
  if (!bubble || bubble.width < 49 || bubble.width > 52.5 || bubble.height < 49 || bubble.height > 52.5) throw new Error(`desktop stowed bubble wrong: ${JSON.stringify(bubble)}`);
  await shot(page, "05-desktop-stowed-circle.png");

  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  const before = await page.locator(".audio-player-restore").getAttribute("aria-label");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(470);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.locator(".audio-player-restore").getAttribute("aria-label");
  report.desktop.longPress = { before, after, phase: await page.locator(".audio-player-dock").getAttribute("data-audio-phase") };
  if (before === after) throw new Error("desktop long-press did not toggle playback");
  if (!(await page.locator(".audio-player-dock").evaluate((el) => el.classList.contains("is-stowed")))) throw new Error("long-press restored instead of staying stowed");

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(730);
  await page.locator(".audio-player-dismiss-target").waitFor({ state: "visible", timeout: 5_000 });
  await shot(page, "06-desktop-dismiss-armed.png");
  const target = await page.locator(".audio-player-dismiss-target > span").boundingBox();
  if (!target) throw new Error("dismiss target missing");
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.waitForTimeout(100);
  await shot(page, "07-desktop-over-dismiss.png");
  await page.mouse.up();
  await page.waitForTimeout(220);
  report.desktop.dismissed = (await page.locator(".audio-player-dock").count()) === 0;
  if (!report.desktop.dismissed) throw new Error("drag to dismiss failed");
  await context.close();
}

async function mobileQa(width, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await seed(page);
  const key = `${width}x${height}`;
  report.mobile[key] = {};
  await assertOriginalSkeleton(page, `mobile-${key}`);
  report.mobile[key].expanded = await assertCenterline(page, `mobile-${key}`);

  const subtitle = page.locator(".audio-subtitle-float");
  await subtitle.waitFor({ state: "visible", timeout: 10_000 });
  report.mobile[key].subtitleOpen = await overlayMetrics(page, ".audio-subtitle-float");
  await shot(page, `08a-mobile-${key}-expanded-subtitles.png`);

  const node = page.locator(".audio-section-node").nth(3);
  const before = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  await node.click();
  await page.waitForTimeout(180);
  const after = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  report.mobile[key].nodeSeek = { before, after };
  if (Math.abs(after - before) < 1) throw new Error(`mobile ${key}: Section node not clickable`);
  await shot(page, `08-mobile-${key}-expanded.png`);

  await page.locator(".audio-section-toggle").click();
  await page.locator(".audio-section-panel-floating").waitFor({ state: "visible" });
  await page.waitForTimeout(120);
  report.mobile[key].sectionOpen = await overlayMetrics(page, ".audio-section-panel-floating");
  if (Number(report.mobile[key].sectionOpen.subtitleOpacity) > 0.05 || report.mobile[key].sectionOpen.subtitlePointerEvents !== "none") {
    throw new Error(`mobile ${key}: subtitles must yield while Section panel is open`);
  }
  await shot(page, `08b-mobile-${key}-expanded-sections.png`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);

  await page.locator(".audio-player-settings > summary").click();
  await page.locator(".audio-player-settings-panel").waitFor({ state: "visible" });
  report.mobile[key].settingsOpen = await overlayMetrics(page, ".audio-player-settings-panel");
  await shot(page, `09-mobile-${key}-settings.png`);
  await page.keyboard.press("Escape");

  if (height >= 800) {
    await page.locator(".audio-player-expand").click();
    await page.locator(".audio-player-details").waitFor({ state: "hidden" });
    await page.waitForTimeout(120);
    const compact = await geometry(page);
    report.mobile[key].compact = compact;
    if (!compact.dock || compact.dock.height > 65) throw new Error(`mobile ${key}: compact too tall ${JSON.stringify(compact.dock)}`);
    if (!compact.progress || Math.abs(compact.progress.top - compact.dock.top) > 2.5) throw new Error(`mobile ${key}: progress not top edge`);
    if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error(`mobile ${key}: stow missing`);
    await shot(page, `10-mobile-${key}-compact.png`);

    await page.locator(".audio-player-stow").click();
    await page.waitForTimeout(100);
    const circle = await page.locator(".audio-player-restore").boundingBox();
    report.mobile[key].stowed = circle;
    if (!circle || circle.width < 49 || circle.width > 52.5 || circle.height < 49 || circle.height > 52.5) throw new Error(`mobile ${key}: stowed bubble wrong ${JSON.stringify(circle)}`);
    await shot(page, `11-mobile-${key}-stowed.png`);

    await page.locator(".audio-player-restore").click();
    await page.waitForTimeout(100);
    if (!(await page.locator(".audio-player-dock.is-collapsed:not(.is-stowed)").isVisible())) throw new Error(`mobile ${key}: bubble restore failed`);
  }
  await context.close();
}

await desktopQa();
await mobileQa(390, 844);
await mobileQa(430, 844);
await mobileQa(390, 740);

await fs.writeFile(path.join(outDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();