import assert from 'node:assert/strict';
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
      sourceId,
      position: 12,
      rate: 1,
      expanded: true,
      stowed: false,
      continuousPlay: true,
      queueIds: [],
      randomReview: false,
    }));
    localStorage.setItem('em-board-audio-subtitles-v1', 'false');
  }, id);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.audio-player-dock').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.audio-section-companion').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(350);
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded' });
const entries = await catalog(page);
const source = entries.find((entry) => entry.kind === 'textbook-chapter' || entry.kind === 'textbook-section');
assert.ok(source, 'No textbook source available');
await seed(page, source.id);

const dock = page.locator('.audio-player-dock');
const input = page.locator('.audio-player-timeline > input[type="range"]');
const layer = page.locator('.audio-section-node-layer');
const node = page.locator('.audio-section-node').first();
const timeRow = page.locator('.audio-player-timeline > input[type="range"] + div');
const before = await dock.boundingBox();
const ib = await input.boundingBox();
const lb = await layer.boundingBox();
const nb = await node.boundingBox();
const tb = await timeRow.boundingBox();
assert.ok(before && ib && lb && nb && tb);
console.log('base geometry', JSON.stringify({ dock: before, input: ib, layer: lb, node: nb, time: tb }));
assert.ok(Math.abs(ib.height - 18) < 1, `Seek input remains inflated: ${ib.height}`);
assert.ok(Math.abs(ib.y - lb.y) < 1, 'Section layer is not aligned to seek input');
assert.ok(nb.width <= 3.5 && nb.height >= 7, 'Section boundary is not rendered as a tick');
assert.ok(tb.y >= ib.y + 18, 'Time labels overlap the timeline');
await page.screenshot({ path: 'visual-proof/01-desktop-expanded.png', fullPage: false });

await page.locator('.audio-player-settings > summary').click();
const subtitleOption = page.locator('.audio-player-subtitle-option');
assert.equal(await subtitleOption.count(), 1, 'Subtitle setting is missing');
await page.screenshot({ path: 'visual-proof/02-desktop-settings.png', fullPage: false });
await subtitleOption.click();
await page.locator('.audio-player-settings > summary').click();
await page.locator('.audio-subtitle-float').waitFor({ state: 'visible', timeout: 10000 });
const subtitleBox = await page.locator('.audio-subtitle-float').boundingBox();
const afterSubtitle = await dock.boundingBox();
assert.ok(subtitleBox && afterSubtitle);
assert.ok(Math.abs(afterSubtitle.width - before.width) < 2 && Math.abs(afterSubtitle.height - before.height) < 2, 'Subtitles changed player geometry');
assert.ok(subtitleBox.y + subtitleBox.height <= afterSubtitle.y + 2, 'Subtitle preview is not floating above the player');
assert.equal(await page.locator('.audio-subtitle-line.is-current').count(), 1, 'No active subtitle cue');
await page.screenshot({ path: 'visual-proof/03-desktop-subtitles.png', fullPage: false });

const beforeSeek = Number(await input.inputValue());
const clickableLine = page.locator('.audio-subtitle-line.is-next').first();
if (await clickableLine.count()) {
  await clickableLine.click();
  await page.waitForTimeout(80);
  assert.notEqual(Number(await input.inputValue()), beforeSeek, 'Clicking a subtitle line did not seek');
}

await page.locator('.audio-section-toggle').click();
await page.waitForTimeout(100);
const afterSection = await dock.boundingBox();
const panel = await page.locator('.audio-section-panel').boundingBox();
assert.ok(afterSection && panel);
assert.ok(Math.abs(afterSection.width - before.width) < 2 && Math.abs(afterSection.height - before.height) < 2, 'Section popover changed desktop player geometry');
assert.ok(panel.x >= afterSection.x + afterSection.width + 4, 'Desktop Section list is not a side popover');
assert.equal(await page.locator('.audio-player-timeline').isVisible(), true);
assert.equal(await page.locator('.audio-player-controls').isVisible(), true);
await page.screenshot({ path: 'visual-proof/04-desktop-sections.png', fullPage: false });
await page.locator('.audio-section-toggle').click();

const timelineBeforeSettings = await page.locator('.audio-player-timeline').boundingBox();
await page.locator('.audio-player-settings > summary').click();
await page.waitForTimeout(80);
const timelineAfterSettings = await page.locator('.audio-player-timeline').boundingBox();
assert.ok(timelineBeforeSettings && timelineAfterSettings);
assert.ok(Math.abs(timelineBeforeSettings.y - timelineAfterSettings.y) < 1 && Math.abs(timelineBeforeSettings.height - timelineAfterSettings.height) < 1, 'Settings changed timeline geometry');
await page.screenshot({ path: 'visual-proof/05-desktop-settings-subtitles-on.png', fullPage: false });
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 412, height: 915 } });
const mp = await mobile.newPage();
await seed(mp, source.id);
await mp.locator('.audio-player-settings > summary').click();
await mp.locator('.audio-player-subtitle-option').click();
await mp.locator('.audio-player-settings > summary').click();
await mp.locator('.audio-subtitle-float').waitFor({ state: 'visible', timeout: 10000 });
const mobileDock = mp.locator('.audio-player-dock');
const mobileBefore = await mobileDock.boundingBox();
const mobileSubtitle = await mp.locator('.audio-subtitle-float').boundingBox();
assert.ok(mobileBefore && mobileSubtitle);
assert.ok(mobileSubtitle.y + mobileSubtitle.height <= mobileBefore.y + 2, 'Mobile subtitles are not floating above player');
await mp.screenshot({ path: 'visual-proof/06-mobile-subtitles.png', fullPage: false });
await mp.locator('.audio-section-toggle').click();
await mp.waitForTimeout(80);
const mobileAfter = await mobileDock.boundingBox();
const mobilePanel = await mp.locator('.audio-section-panel').boundingBox();
assert.ok(mobileAfter && mobilePanel);
assert.ok(Math.abs(mobileAfter.width - mobileBefore.width) < 2 && Math.abs(mobileAfter.height - mobileBefore.height) < 2, 'Mobile Section list changed player geometry');
assert.equal(await mp.locator('.audio-player-timeline').isVisible(), true);
assert.equal(await mp.locator('.audio-player-controls').isVisible(), true);
assert.ok(mobilePanel.y + mobilePanel.height <= mobileAfter.y + 2, 'Mobile Section list is not a floating panel');
await mp.screenshot({ path: 'visual-proof/07-mobile-sections.png', fullPage: false });
await mobile.close();

await browser.close();
