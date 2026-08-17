import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.CI_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve(process.env.CI_SMOKE_OUT_DIR ?? "qa-ci-smoke");

const viewports = [
  { name: "desktop-1920", width: 1920, height: 1080, isMobile: false, hasTouch: false },
  { name: "mobile-390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "mobile-430", width: 430, height: 932, isMobile: true, hasTouch: true },
];

async function openSpotlightWithShortcut(page, timeout = 15_000) {
  const dialog = page.locator("#global-spotlight-dialog");
  const deadline = Date.now() + timeout;

  do {
    await page.keyboard.press("Control+K");
    if (await dialog.isVisible().catch(() => false)) return dialog;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);

  await dialog.waitFor({ state: "visible", timeout: 1 });
  return dialog;
}

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const verification = { baseUrl, viewports: {}, generatedAt: new Date().toISOString() };
let failed = false;

try {
  for (const target of viewports) {
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      isMobile: target.isMobile,
      hasTouch: target.hasTouch,
      locale: "zh-TW",
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`${target.name}: homepage returned ${response?.status() ?? "no response"}`);

    await page.waitForSelector("main.dashboard-page", { state: "visible", timeout: 30_000 });
    await page.waitForTimeout(300);

    const manifestStatus = await page.evaluate(async () => {
      const response = await fetch("/site.webmanifest", { cache: "no-store" });
      return response.status;
    });
    const sessionStatus = await page.evaluate(async () => {
      const response = await fetch("/api/account-session", { cache: "no-store" });
      return response.status;
    });
    const geometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    const overflow = Math.max(0, geometry.scrollWidth - geometry.innerWidth, geometry.bodyScrollWidth - geometry.innerWidth);

    let spotlight = null;
    if (!target.isMobile) {
      const dialog = await openSpotlightWithShortcut(page);
      spotlight = { opened: true };
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: 10_000 }).catch(async () => {
        await dialog.waitFor({ state: "hidden", timeout: 10_000 });
      });
    }

    await page.screenshot({ path: path.join(outputDir, `${target.name}.png`), fullPage: false });

    const result = {
      viewport: { width: target.width, height: target.height },
      title: await page.title(),
      manifestStatus,
      sessionStatus,
      overflow,
      pageErrors,
      spotlight,
    };
    verification.viewports[target.name] = result;

    if (manifestStatus !== 200 || sessionStatus !== 200 || overflow > 1 || pageErrors.length) {
      failed = true;
    }

    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(outputDir, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
}

console.log(JSON.stringify(verification, null, 2));
if (failed) process.exitCode = 1;
