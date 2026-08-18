import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "playwright";

const baseUrl = process.env.CI_PERF_BASE_URL ?? "http://127.0.0.1:4173";
const outputDir = path.resolve(process.env.CI_PERF_OUT_DIR ?? "qa-deep-performance");
const buildRoot = path.resolve(process.env.CI_PERF_BUILD_ROOT ?? "dist/client");

const routes = [
  { name: "dashboard", hash: "#dashboard" },
  { name: "practice", hash: "#practice" },
  { name: "browse", hash: "#browse" },
  { name: "reader", hash: "#reader" },
  { name: "guides", hash: "#guides" },
  { name: "tintinalli-001", hash: "#guides/tintinalli/001" },
  { name: "rosens-001", hash: "#guides/rosens/001" },
  { name: "audio", hash: "#audio" },
  { name: "documents", hash: "#documents" },
  { name: "review", hash: "#review" },
  { name: "notebook", hash: "#notebook" },
  { name: "analytics", hash: "#analytics" },
  { name: "prep", hash: "#prep/checklist" },
  { name: "rest", hash: "#rest" },
];

const profiles = [
  {
    name: "desktop-native",
    viewport: { width: 1366, height: 768 },
    isMobile: false,
    hasTouch: false,
    cpuRate: 1,
    network: null,
    connection: { effectiveType: "4g", downlink: 100, rtt: 10, saveData: false },
    deviceMemory: 8,
    hardwareConcurrency: 8,
    routes,
  },
  {
    name: "mobile-fast4g",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    cpuRate: 4,
    network: { latency: 80, downloadThroughput: 5_000_000 / 8, uploadThroughput: 1_500_000 / 8 },
    connection: { effectiveType: "4g", downlink: 5, rtt: 80, saveData: false },
    deviceMemory: 8,
    hardwareConcurrency: 8,
    routes,
  },
  {
    name: "mobile-save-data",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    cpuRate: 6,
    network: { latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 },
    connection: { effectiveType: "3g", downlink: 1.6, rtt: 150, saveData: true },
    deviceMemory: 4,
    hardwareConcurrency: 4,
    routes: routes.filter((route) => [
      "dashboard", "practice", "browse", "reader", "guides", "tintinalli-001",
      "audio", "documents", "analytics", "prep",
    ].includes(route.name)),
  },
];

const snacProfiles = [
  {
    name: "snac-native",
    viewport: { width: 1366, height: 768 },
    cpuRate: 1,
    network: null,
    connection: { effectiveType: "4g", downlink: 100, rtt: 10, saveData: false },
    deviceMemory: 8,
    hardwareConcurrency: 8,
  },
  {
    name: "snac-100mbps",
    viewport: { width: 1366, height: 768 },
    cpuRate: 2,
    network: { latency: 20, downloadThroughput: 100_000_000 / 8, uploadThroughput: 20_000_000 / 8 },
    connection: { effectiveType: "4g", downlink: 100, rtt: 20, saveData: false },
    deviceMemory: 8,
    hardwareConcurrency: 8,
  },
];

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function addInstrumentation(context, profile) {
  await context.addInitScript(({ connection, deviceMemory, hardwareConcurrency }) => {
    const define = (target, key, value) => {
      try { Object.defineProperty(target, key, { configurable: true, get: () => value }); } catch { /* best effort */ }
    };
    define(Navigator.prototype, "connection", connection);
    define(Navigator.prototype, "deviceMemory", deviceMemory);
    define(Navigator.prototype, "hardwareConcurrency", hardwareConcurrency);

    window.__qaPerf = {
      lcp: 0,
      cls: 0,
      longTasks: [],
      h1At: null,
      appReadyAt: null,
      workerEvents: [],
    };

    const recordReady = () => {
      if (window.__qaPerf.appReadyAt === null && document.documentElement.getAttribute("data-question-bank-ready") === "true") {
        window.__qaPerf.appReadyAt = performance.now();
      }
      if (window.__qaPerf.h1At === null && document.querySelector("main h1")) {
        window.__qaPerf.h1At = performance.now();
      }
    };

    new MutationObserver(recordReady).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-question-bank-ready"],
    });
    document.addEventListener("DOMContentLoaded", recordReady, { once: true });

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__qaPerf.lcp = Math.max(window.__qaPerf.lcp, entry.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__qaPerf.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__qaPerf.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {}

    const NativeWorker = window.Worker;
    function InstrumentedWorker(...args) {
      const worker = new NativeWorker(...args);
      const workerId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const createdAt = performance.now();
      window.__qaPerf.workerEvents.push({ kind: "worker-created", workerId, at: createdAt, url: String(args[0]) });
      const nativePostMessage = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => {
        if (message && typeof message === "object" && ["warm", "prime", "load", "decode"].includes(message.kind)) {
          window.__qaPerf.workerEvents.push({ kind: `post-${message.kind}`, workerId, at: performance.now(), requestId: message.requestId ?? null });
        }
        return transfer === undefined ? nativePostMessage(message) : nativePostMessage(message, transfer);
      };
      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message && typeof message === "object" && ["warmed", "primed", "ready", "progress", "error"].includes(message.kind)) {
          window.__qaPerf.workerEvents.push({
            kind: message.kind,
            workerId,
            at: performance.now(),
            backend: message.backend ?? null,
            requestId: message.requestId ?? null,
            loadedBytes: message.loadedBytes ?? null,
            totalBytes: message.totalBytes ?? null,
            windows: message.windows ?? null,
            seconds: message.seconds ?? null,
            message: message.kind === "error" ? message.message : null,
          });
        }
      });
      return worker;
    }
    InstrumentedWorker.prototype = NativeWorker.prototype;
    try { Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: InstrumentedWorker }); } catch {}
  }, {
    connection: profile.connection,
    deviceMemory: profile.deviceMemory,
    hardwareConcurrency: profile.hardwareConcurrency,
  });
}

async function applyCdpProfile(page, profile, disableCache = true) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: disableCache });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
  if (profile.network) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: profile.network.latency,
      downloadThroughput: profile.network.downloadThroughput,
      uploadThroughput: profile.network.uploadThroughput,
      connectionType: profile.connection.effectiveType === "3g" ? "cellular3g" : "cellular4g",
    });
  }
  return cdp;
}

function requestCollector(context) {
  const records = [];
  const handler = async (request) => {
    try {
      const sizes = await request.sizes();
      const response = await request.response();
      records.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        status: response?.status() ?? null,
        requestBodySize: sizes.requestBodySize,
        requestHeadersSize: sizes.requestHeadersSize,
        responseBodySize: sizes.responseBodySize,
        responseHeadersSize: sizes.responseHeadersSize,
        transferBytes: Math.max(0, sizes.responseBodySize + sizes.responseHeadersSize),
      });
    } catch {}
  };
  context.on("requestfinished", handler);
  return { records, stop: () => context.off("requestfinished", handler) };
}

function summarizeRequests(records) {
  const totalBytes = records.reduce((sum, item) => sum + (item.transferBytes || 0), 0);
  const byType = {};
  for (const item of records) {
    const bucket = byType[item.resourceType] ?? { requests: 0, bytes: 0 };
    bucket.requests += 1;
    bucket.bytes += item.transferBytes || 0;
    byType[item.resourceType] = bucket;
  }
  const largest = [...records]
    .sort((a, b) => (b.transferBytes || 0) - (a.transferBytes || 0))
    .slice(0, 12)
    .map((item) => ({ url: item.url, type: item.resourceType, bytes: item.transferBytes, status: item.status }));
  return { requestCount: records.length, transferBytes: totalBytes, byType, largest };
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
    const qa = window.__qaPerf ?? { lcp: 0, cls: 0, longTasks: [], h1At: null, appReadyAt: null, workerEvents: [] };
    const longTaskTotal = qa.longTasks.reduce((sum, task) => sum + task.duration, 0);
    const tbt = qa.longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
    const heap = performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null;
    return {
      title: document.title,
      h1: document.querySelector("main h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      mainClass: document.querySelector("main")?.className ?? "",
      timing: nav ? {
        ttfb: nav.responseStart,
        responseEnd: nav.responseEnd,
        domContentLoaded: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
      } : null,
      fcp: paints["first-contentful-paint"] ?? null,
      fp: paints["first-paint"] ?? null,
      lcp: qa.lcp || null,
      cls: qa.cls,
      h1At: qa.h1At,
      appReadyAt: qa.appReadyAt,
      longTaskCount: qa.longTasks.length,
      longTaskTotal,
      tbt,
      heap,
      workerEvents: qa.workerEvents,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

async function waitForForeground(page) {
  await page.waitForSelector("main", { state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector("main h1") || document.documentElement.getAttribute("data-question-bank-ready") === "true", null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

async function measureColdRoute(browser, profile, route) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  await addInstrumentation(context, profile);
  const collector = requestCollector(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await applyCdpProfile(page, profile, true);
  const response = await page.goto(`${baseUrl}/${route.hash}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForForeground(page);
  const metrics = await collectPageMetrics(page);
  collector.stop();
  await context.close();
  return {
    status: response?.status() ?? null,
    ...metrics,
    ...summarizeRequests(collector.records),
    pageErrors: errors,
    overflow: Math.max(0, metrics.scrollWidth - metrics.innerWidth),
  };
}

async function measureWarmTransitions(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  await addInstrumentation(context, profile);
  const page = await context.newPage();
  await applyCdpProfile(page, profile, false);
  await page.goto(`${baseUrl}/#dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForForeground(page);
  const results = [];
  for (const route of routes.filter((item) => !["dashboard", "tintinalli-001", "rosens-001"].includes(item.name))) {
    const previous = await page.evaluate(() => ({ cls: document.querySelector("main")?.className ?? "", h1: document.querySelector("main h1")?.textContent ?? "" }));
    const started = await page.evaluate((hash) => {
      const now = performance.now();
      location.hash = hash;
      return now;
    }, route.hash);
    await page.waitForFunction((previousState) => {
      const main = document.querySelector("main");
      const h1 = main?.querySelector("h1")?.textContent ?? "";
      return Boolean(main) && (main.className !== previousState.cls || h1 !== previousState.h1);
    }, previous, { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(100);
    const finished = await page.evaluate(() => performance.now());
    results.push({ route: route.name, transitionMs: finished - started, h1: await page.locator("main h1").first().textContent().catch(() => "") });
  }
  await context.close();
  return results;
}

async function measureSnacWarm(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  await addInstrumentation(context, profile);
  const collector = requestCollector(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await applyCdpProfile(page, profile, true);
  await page.goto(`${baseUrl}/#guides/tintinalli/001`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("article.guide-article", { state: "visible", timeout: 45_000 });
  const audioButton = page.locator("button.guide-audio-action").first();
  await audioButton.waitFor({ state: "attached", timeout: 30_000 });
  await audioButton.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
  const outcome = await page.waitForFunction(() => {
    const events = window.__qaPerf?.workerEvents ?? [];
    return events.find((event) => event.kind === "warmed" || (event.kind === "error" && event.requestId == null)) ?? null;
  }, null, { timeout: 120_000 }).then((handle) => handle.jsonValue()).catch(() => null);
  const events = await page.evaluate(() => window.__qaPerf?.workerEvents ?? []);
  const postWarm = events.find((event) => event.kind === "post-warm") ?? null;
  const warmed = events.find((event) => event.kind === "warmed") ?? null;
  const progress = events.filter((event) => event.kind === "progress");
  collector.stop();
  await context.close();
  const snacRequests = collector.records.filter((item) => item.url.includes("/static-snac/"));
  return {
    outcome,
    warmMs: postWarm && warmed ? warmed.at - postWarm.at : null,
    workerCreatedToWarmMs: events.find((event) => event.kind === "worker-created") && warmed
      ? warmed.at - events.find((event) => event.kind === "worker-created").at
      : null,
    backend: warmed?.backend ?? null,
    modelProgressEvents: progress.length,
    modelLoadedBytes: progress.at(-1)?.loadedBytes ?? null,
    modelTotalBytes: progress.at(-1)?.totalBytes ?? null,
    requests: summarizeRequests(snacRequests),
    allWorkerEvents: events,
    pageErrors: errors,
  };
}

async function walkFiles(root) {
  const output = [];
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else output.push(full);
    }
  };
  try { await visit(root); } catch { return []; }
  return output;
}

async function scanBuildAssets() {
  const files = await walkFiles(buildRoot);
  const interesting = files.filter((file) => /\.(?:js|mjs|css|json|wasm)$/u.test(file));
  const rows = [];
  for (const file of interesting) {
    const bytes = await fs.readFile(file);
    const relative = path.relative(buildRoot, file).split(path.sep).join("/");
    let gzip = null;
    let brotli = null;
    if (bytes.byteLength <= 8 * 1024 * 1024) {
      gzip = zlib.gzipSync(bytes, { level: 9 }).byteLength;
      brotli = zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
    }
    rows.push({ path: relative, bytes: bytes.byteLength, gzip, brotli });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  const totals = rows.reduce((acc, row) => {
    const ext = path.extname(row.path) || "other";
    const bucket = acc[ext] ?? { files: 0, bytes: 0, gzip: 0, brotli: 0 };
    bucket.files += 1;
    bucket.bytes += row.bytes;
    bucket.gzip += row.gzip ?? 0;
    bucket.brotli += row.brotli ?? 0;
    acc[ext] = bucket;
    return acc;
  }, {});
  return { totals, largest: rows.slice(0, 80) };
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
const report = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  build: await scanBuildAssets(),
  cold: {},
  warmTransitions: {},
  snac: {},
};

try {
  for (const profile of profiles) {
    report.cold[profile.name] = {};
    for (const route of profile.routes) {
      console.log(`cold ${profile.name} ${route.name}`);
      report.cold[profile.name][route.name] = await measureColdRoute(browser, profile, route);
    }
  }
  for (const profile of profiles.slice(0, 2)) {
    console.log(`warm transitions ${profile.name}`);
    report.warmTransitions[profile.name] = await measureWarmTransitions(browser, profile);
  }
  for (const profile of snacProfiles) {
    console.log(`snac ${profile.name}`);
    report.snac[profile.name] = await measureSnacWarm(browser, profile);
  }
} finally {
  await browser.close();
}

const summaryRows = [];
for (const [profile, results] of Object.entries(report.cold)) {
  for (const [route, result] of Object.entries(results)) {
    summaryRows.push({
      profile,
      route,
      ttfb: round(result.timing?.ttfb),
      fcp: round(result.fcp),
      lcp: round(result.lcp),
      appReady: round(result.appReadyAt),
      tbt: round(result.tbt),
      cls: round(result.cls, 4),
      transferKB: round(result.transferBytes / 1024),
      requests: result.requestCount,
      heapMB: round((result.heap?.usedJSHeapSize ?? 0) / 1024 / 1024),
      overflow: result.overflow,
      errors: result.pageErrors.length,
    });
  }
}
report.summary = {
  coldRows: summaryRows,
  p75: Object.fromEntries(profiles.map((profile) => {
    const rows = summaryRows.filter((row) => row.profile === profile.name);
    return [profile.name, {
      fcp: percentile(rows.map((row) => row.fcp).filter(Number.isFinite), .75),
      lcp: percentile(rows.map((row) => row.lcp).filter(Number.isFinite), .75),
      appReady: percentile(rows.map((row) => row.appReady).filter(Number.isFinite), .75),
      tbt: percentile(rows.map((row) => row.tbt).filter(Number.isFinite), .75),
      transferKB: percentile(rows.map((row) => row.transferKB).filter(Number.isFinite), .75),
    }];
  })),
};

await fs.writeFile(path.join(outputDir, "performance-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "summary.tsv"), [
  "profile\troute\tttfb_ms\tfcp_ms\tlcp_ms\tapp_ready_ms\ttbt_ms\tcls\ttransfer_kb\trequests\theap_mb\toverflow\terrors",
  ...summaryRows.map((row) => [row.profile, row.route, row.ttfb, row.fcp, row.lcp, row.appReady, row.tbt, row.cls, row.transferKB, row.requests, row.heapMB, row.overflow, row.errors].join("\t")),
].join("\n") + "\n");
console.log(JSON.stringify(report.summary, null, 2));
