import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.CI_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve(process.env.CI_AUDIT_OUT_DIR ?? "qa-responsive-audit");

const viewports = [
  { name: "desktop-1920x1080", width: 1920, height: 1080, isMobile: false, hasTouch: false },
  { name: "laptop-1366x768", width: 1366, height: 768, isMobile: false, hasTouch: false },
  { name: "tablet-landscape-1024x768", width: 1024, height: 768, isMobile: false, hasTouch: true },
  { name: "tablet-portrait-834x1112", width: 834, height: 1112, isMobile: true, hasTouch: true },
  { name: "mobile-430x932", width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: "mobile-390x844", width: 390, height: 844, isMobile: true, hasTouch: true },
];

const routes = [
  ["dashboard", "#dashboard"],
  ["practice", "#practice"],
  ["browse", "#browse"],
  ["reader-index", "#reader"],
  ["guides-index", "#guides"],
  ["guide-tintinalli-ch001", "#guides/tintinalli/001"],
  ["guide-rosens-ch001", "#guides/rosens/001"],
  ["guide-ails-home", "#guides/ails/home"],
  ["guide-ems-ch001", "#guides/ems/001"],
  ["guide-goldfrank-ch001", "#guides/goldfrank/001"],
  ["audio-library", "#audio"],
  ["documents", "#documents"],
  ["review", "#review"],
  ["notebook", "#notebook"],
  ["analytics", "#analytics"],
  ["prep-checklist", "#prep/checklist"],
  ["prep-recognized", "#prep/recognized"],
  ["prep-upcoming-society", "#prep/upcoming/society"],
  ["prep-exam", "#prep/exam"],
  ["rest", "#rest"],
];

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "");
}

async function waitForRoutePaint(page) {
  await page.locator("main").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => document.readyState !== "loading", null, { timeout: 10_000 });
  await page.waitForTimeout(900);
}

async function geometry(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    docScrollHeight: document.documentElement.scrollHeight,
    mainClass: document.querySelector("main")?.className ?? "",
    h1: document.querySelector("main h1")?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    h2: document.querySelector("main h2")?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    hash: window.location.hash,
  }));
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { baseUrl, generatedAt: new Date().toISOString(), viewports: {}, summary: { captures: 0, failures: 0 } };
let failed = false;

try {
  for (const target of viewports) {
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      isMobile: target.isMobile,
      hasTouch: target.hasTouch,
      locale: "zh-TW",
      colorScheme: "light",
    });
    const page = await context.newPage();
    const pageErrors = [];
    const failedRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (url.startsWith(baseUrl)) failedRequests.push(`${request.method()} ${url}: ${request.failure()?.errorText ?? "failed"}`);
    });

    const viewportDir = path.join(outputDir, target.name);
    await fs.mkdir(viewportDir, { recursive: true });
    const viewportResult = { viewport: target, routes: {}, overlays: {}, pageErrors, failedRequests };
    report.viewports[target.name] = viewportResult;

    const response = await page.goto(`${baseUrl}/#dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`${target.name}: homepage returned ${response?.status() ?? "no response"}`);
    await page.waitForSelector("main.dashboard-page", { state: "visible", timeout: 30_000 });

    for (const [name, hash] of routes) {
      const errorStart = pageErrors.length;
      const requestStart = failedRequests.length;
      await page.evaluate((nextHash) => { window.location.hash = nextHash; window.scrollTo(0, 0); }, hash);
      await waitForRoutePaint(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(120);

      const metrics = await geometry(page);
      const overflow = Math.max(0, metrics.docScrollWidth - metrics.innerWidth, metrics.bodyScrollWidth - metrics.innerWidth);
      const screenshot = `${String(Object.keys(viewportResult.routes).length + 1).padStart(2, "0")}-${safeName(name)}.png`;
      await page.screenshot({ path: path.join(viewportDir, screenshot), fullPage: false });
      report.summary.captures += 1;

      const routeErrors = pageErrors.slice(errorStart);
      const routeFailedRequests = failedRequests.slice(requestStart);
      viewportResult.routes[name] = { hash, screenshot, overflow, ...metrics, routeErrors, routeFailedRequests };
      if (overflow > 1 || routeErrors.length) {
        failed = true;
        report.summary.failures += 1;
      }
    }

    await page.evaluate(() => { window.location.hash = "#dashboard"; window.scrollTo(0, 0); });
    await waitForRoutePaint(page);

    const spotlightTrigger = page.locator("button[aria-controls='global-spotlight-dialog']").first();
    if (await spotlightTrigger.isVisible().catch(() => false)) {
      await spotlightTrigger.click();
      const dialog = page.locator("#global-spotlight-dialog");
      await dialog.waitFor({ state: "visible", timeout: 10_000 });
      const screenshot = "overlay-global-spotlight.png";
      await page.screenshot({ path: path.join(viewportDir, screenshot), fullPage: false });
      report.summary.captures += 1;
      viewportResult.overlays.spotlight = { screenshot, visible: true };
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    } else {
      viewportResult.overlays.spotlight = { visible: false };
    }

    const functionButton = page.getByRole("button", { name: /功能/u }).first();
    if (await functionButton.isVisible().catch(() => false)) {
      await functionButton.click();
      await page.waitForTimeout(250);
      const screenshot = "overlay-function-menu.png";
      await page.screenshot({ path: path.join(viewportDir, screenshot), fullPage: false });
      report.summary.captures += 1;
      viewportResult.overlays.functionMenu = { screenshot, visible: true };
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(200);
    } else {
      viewportResult.overlays.functionMenu = { visible: false };
    }

    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(outputDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
if (failed) process.exitCode = 1;
