import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const base = 'http://127.0.0.1:4173/';

async function catalog(page) {
  return page.evaluate(async () => (await (await fetch('/audio/snac/catalog.json')).json()).entries);
}

async function seed(page, id) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate((sourceId) => {
    localStorage.setItem('em-board-audio-player-v2', JSON.stringify({
      sourceId, position: 12, rate: 1, expanded: true, stowed: false,
      continuousPlay: true, queueIds: [], randomReview: false,
    }));
    localStorage.setItem('em-board-audio-subtitles-v1', 'false');
  }, id);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.audio-player-dock').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.audio-section-companion').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(350);
}

async function geometry(page) {
  const selectors = {
    dock: '.audio-player-dock',
    mini: '.audio-player-mini',
    details: '.audio-player-details',
    companion: '.audio-section-companion',
    timeline: '.audio-player-timeline',
    controls: '.audio-player-controls',
    panel: '.audio-section-panel',
    settings: '.audio-player-settings-panel',
    subtitle: '.audio-subtitle-float',
  };
  const out = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const loc = page.locator(selector);
    out[key] = await loc.count() ? await loc.first().boundingBox() : null;
  }
  return out;
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await desktop.newPage();
await p.goto(base, { waitUntil: 'domcontentloaded' });
const entries = await catalog(p);
const source = entries.find((entry) => entry.kind === 'textbook-chapter' || entry.kind === 'textbook-section');
if (!source) throw new Error('no source');
await seed(p, source.id);
console.log('DESKTOP_BASE', JSON.stringify(await geometry(p)));
await p.screenshot({ path: 'visual-proof/01-desktop-base.png', fullPage: false });

await p.locator('.audio-player-settings > summary').click();
await p.locator('.audio-player-subtitle-option').click();
await p.locator('.audio-player-settings > summary').click();
await p.locator('.audio-subtitle-float').waitFor({ state: 'visible', timeout: 10000 });
console.log('DESKTOP_SUBTITLES', JSON.stringify(await geometry(p)));
await p.screenshot({ path: 'visual-proof/02-desktop-subtitles.png', fullPage: false });

await p.locator('.audio-section-toggle').click();
await p.waitForTimeout(100);
console.log('DESKTOP_SECTION_OPEN', JSON.stringify(await geometry(p)));
console.log('DESKTOP_DOCK_COMPUTED', await p.locator('.audio-player-dock').evaluate((el) => {
  const s = getComputedStyle(el);
  return { width:s.width, height:s.height, minHeight:s.minHeight, maxHeight:s.maxHeight, overflow:s.overflow, padding:s.padding };
}));
console.log('DESKTOP_DETAILS_COMPUTED', await p.locator('.audio-player-details').evaluate((el) => {
  const s = getComputedStyle(el);
  return { minHeight:s.minHeight, height:s.height, padding:s.padding, paddingRight:s.paddingRight, position:s.position };
}));
await p.screenshot({ path: 'visual-proof/03-desktop-section-open.png', fullPage: false });
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 412, height: 915 } });
const mp = await mobile.newPage();
await seed(mp, source.id);
await mp.locator('.audio-player-settings > summary').click();
await mp.locator('.audio-player-subtitle-option').click();
await mp.locator('.audio-player-settings > summary').click();
await mp.locator('.audio-subtitle-float').waitFor({ state: 'visible', timeout: 10000 });
console.log('MOBILE_SUBTITLES', JSON.stringify(await geometry(mp)));
await mp.screenshot({ path: 'visual-proof/04-mobile-subtitles.png', fullPage: false });
await mp.locator('.audio-section-toggle').click();
await mp.waitForTimeout(100);
console.log('MOBILE_SECTION_OPEN', JSON.stringify(await geometry(mp)));
await mp.screenshot({ path: 'visual-proof/05-mobile-section-open.png', fullPage: false });
await mobile.close();

await browser.close();
