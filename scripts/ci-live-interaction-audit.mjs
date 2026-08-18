import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const baseUrl = process.env.CI_LIVE_BASE_URL ?? "https://emergency-board-questions.jerry3627613.chatgpt.site";
const outPath = process.env.CI_LIVE_INTERACTION_OUT ?? "qa-live-interactions.json";

const profiles = [
  {
    name: "desktop-native",
    viewport: { width: 1366, height: 768 },
    isMobile: false,
    hasTouch: false,
    cpuRate: 1,
    network: null,
  },
  {
    name: "mobile-fast4g",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    cpuRate: 4,
    network: { latency: 80, downloadThroughput: 5_000_000 / 8, uploadThroughput: 1_500_000 / 8 },
  },
];

async function configure(page, profile) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
  if (profile.network) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: profile.network.latency,
      downloadThroughput: profile.network.downloadThroughput,
      uploadThroughput: profile.network.uploadThroughput,
      connectionType: "cellular4g",
    });
  }
}

async function ready(page, hash) {
  await page.goto(`${baseUrl}/${hash}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("main h1", { state: "visible", timeout: 30_000 });
  await page.waitForTimeout(900);
}

async function timed(label, action, settle) {
  const started = performance.now();
  await action();
  await settle();
  return { label, ms: Math.round((performance.now() - started) * 10) / 10 };
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await configure(page, profile);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const rows = [];

  async function scenario(name, fn) {
    try {
      const values = await fn();
      rows.push({ scenario: name, ok: true, ...values });
    } catch (error) {
      rows.push({ scenario: name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await scenario("function-menu-open-close", async () => {
    await ready(page, "#dashboard");
    const open = await timed(
      "open",
      () => page.getByRole("button", { name: "開啟功能總覽" }).click(),
      () => page.getByRole("dialog", { name: "功能總覽" }).waitFor({ state: "visible", timeout: 10_000 }),
    );
    const close = await timed(
      "close",
      () => page.getByRole("button", { name: "關閉選單" }).click(),
      () => page.getByRole("dialog", { name: "功能總覽" }).waitFor({ state: "detached", timeout: 10_000 }),
    );
    return { openMs: open.ms, closeMs: close.ms };
  });

  await scenario("spotlight-open", async () => {
    await ready(page, "#dashboard");
    const value = await timed(
      "open",
      () => page.getByRole("button", { name: /全站搜尋/ }).first().click(),
      () => page.locator("#global-spotlight-dialog").waitFor({ state: "visible", timeout: 20_000 }),
    );
    await page.keyboard.press("Escape");
    return { openMs: value.ms };
  });

  await scenario("browse-search", async () => {
    await ready(page, "#browse");
    await page.locator(".question-result-card").first().waitFor({ state: "visible", timeout: 20_000 });
    const input = page.getByLabel("搜尋題號、題幹、選項或關鍵字");
    const count = page.locator(".results-heading strong").first();
    const before = (await count.textContent())?.trim() ?? "";
    const value = await timed(
      "search",
      () => input.fill("主動脈"),
      () => page.waitForFunction((previous) => {
        const current = document.querySelector(".results-heading strong")?.textContent?.trim() ?? "";
        return current && current !== previous;
      }, before, { timeout: 20_000 }),
    );
    return { searchMs: value.ms, resultCount: (await count.textContent())?.trim() ?? "" };
  });

  await scenario("practice-random-first-question", async () => {
    await ready(page, "#practice");
    const value = await timed(
      "start",
      () => page.getByRole("button", { name: /隨機學習/ }).first().click(),
      () => page.locator('[id^="question-heading-"]').first().waitFor({ state: "visible", timeout: 20_000 }),
    );
    const option = page.locator(".answer-options button:not([disabled])").first();
    const select = await timed(
      "select-answer",
      () => option.click(),
      () => page.waitForFunction(() => document.querySelector(".answer-options button[aria-pressed='true']") !== null, null, { timeout: 5_000 }),
    );
    return { firstQuestionMs: value.ms, selectAnswerMs: select.ms };
  });

  await scenario("guide-next-chapter", async () => {
    await ready(page, "#guides/tintinalli/001");
    await page.waitForFunction(() => location.hash.includes("/001"), null, { timeout: 10_000 });
    const next = page.locator('button[aria-label^="下一章"]:visible:not([disabled])').first();
    const value = await timed(
      "next",
      () => next.click(),
      () => page.waitForFunction(() => location.hash.includes("/002"), null, { timeout: 20_000 }),
    );
    return { nextChapterMs: value.ms };
  });

  await scenario("audio-library-filter", async () => {
    await ready(page, "#audio");
    const cards = page.locator(".audio-collection-card");
    await cards.first().waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll(".audio-collection-card").length >= 2, null, { timeout: 20_000 });
    const target = cards.nth(1);
    const value = await timed(
      "filter",
      () => target.click(),
      () => page.waitForFunction(() => document.querySelectorAll(".audio-collection-card")[1]?.getAttribute("aria-pressed") === "true", null, { timeout: 5_000 }),
    );
    return { filterMs: value.ms, cards: await cards.count() };
  });

  if (profile.isMobile) {
    await scenario("mobile-pdf-first-page", async () => {
      const started = performance.now();
      await page.goto(`${baseUrl}/#documents`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector("main h1", { state: "visible", timeout: 30_000 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector(".learning-document-pdf-reader canvas");
        return canvas instanceof HTMLCanvasElement && canvas.width > 1 && canvas.height > 1;
      }, null, { timeout: 30_000 });
      return { firstRenderedPageMs: Math.round((performance.now() - started) * 10) / 10 };
    });
  }

  await scenario("theme-menu", async () => {
    await ready(page, "#dashboard");
    const trigger = page.locator('button[aria-label^="顯示模式："]').first();
    const open = await timed(
      "open-theme",
      () => trigger.click(),
      () => page.locator("[data-theme-value]").first().waitFor({ state: "visible", timeout: 5_000 }),
    );
    const dark = page.locator('[data-theme-value="dark"]').first();
    const switchValue = await timed(
      "dark",
      () => dark.click(),
      () => page.waitForFunction(() => document.documentElement.dataset.themeMode === "dark", null, { timeout: 5_000 }),
    );
    return { menuMs: open.ms, switchMs: switchValue.ms };
  });

  const filteredErrors = [...new Set(pageErrors)].filter((message) => !message.includes("MutationObserver"));
  await context.close();
  return { profile: profile.name, rows, pageErrors: filteredErrors };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const profile of profiles) results.push(await runProfile(browser, profile));
} finally {
  await browser.close();
}

const report = { baseUrl, generatedAt: new Date().toISOString(), results };
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
