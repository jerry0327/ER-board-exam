import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const base = 'http://127.0.0.1:4173/';

async function catalog(page) {
  return page.evaluate(async () => (await (await fetch('/audio/snac/catalog.json')).json()).entries);
}

async function seed(page, id, subtitles = false) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ sourceId, subtitles }) => {
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
    localStorage.setItem('em-board-audio-subtitles-v1', subtitles ? 'true' : 'false');
  }, { sourceId: id, subtitles });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.audio-player-dock').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.audio-section-companion').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(350);
}

function closeEnough(a, b, tolerance = 1) {
  return Math.abs(a - b) <= tolerance;
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded' });
const entries = await catalog(page);
const source = entries.find((entry) => entry.kind === 'textbook-chapter' || entry.kind === 'textbook-section');
assert.ok(source, 'No textbook source available');
await seed(page, source.id, false);

const dock = page.locator('.audio-player-dock');
const timeline = page.locator('.audio-player-timeline');
const input = page.locator('.audio-player-timeline > input[type="range"]');
const layer = page.locator('.audio-section-node-layer');
const nodes = page.locator('.audio-section-node');
const before = await dock.boundingBox();
const timelineBase = await timeline.boundingBox();
const inputBox = await input.boundingBox();
const layerBox = await layer.boundingBox();
assert.ok(before && timelineBase && inputBox && layerBox);
assert.ok(closeEnough(inputBox.height, 18, 0.5), `Seek input height ${inputBox.height}`);
assert.ok(closeEnough(inputBox.y, layerBox.y, 0.5), 'Section layer is vertically displaced');
assert.ok(await nodes.count() > 1, 'Section markers are missing');
for (let index = 0; index < Math.min(await nodes.count(), 4); index += 1) {
  const box = await nodes.nth(index).boundingBox();
  assert.ok(box && box.width <= 3.5 && box.height >= 7, 'Section marker is not a tick');
}
await page.screenshot({ path: 'visual-proof/01-desktop-base.png', fullPage: false });

await page.locator('.audio-player-settings > summary').click();
assert.equal(await page.locator('.audio-player-subtitle-option').count(), 1, 'Subtitle toggle missing from Settings');
const timelineSettings = await timeline.boundingBox();
assert.ok(timelineSettings && closeEnough(timelineSettings.y, timelineBase.y, 0.5) && closeEnough(timelineSettings.height, timelineBase.height, 0.5), 'Opening Settings moves timeline');
await page.screenshot({ path: 'visual-proof/02-desktop-settings.png', fullPage: false });
await page.locator('.audio-player-subtitle-option').click();
await page.locator('.audio-player-settings > summary').click();
await page.locator('.audio-subtitle-float').waitFor({ state: 'visible', timeout: 10000 });
const withSubtitle = await dock.boundingBox();
const subtitleBox = await page.locator('.audio-subtitle-float').boundingBox();
assert.ok(withSubtitle && subtitleBox);
assert.ok(closeEnough(withSubtitle.width, before.width) && closeEnough(withSubtitle.height, before.height), 'Subtitle overlay changes dock size');
assert.ok(subtitleBox.y + subtitleBox.height <= withSubtitle.y + 2, 'Subtitle does not float above dock');
assert.equal(await page.locator('.audio-subtitle-line.is-current').count(), 1, 'Active subtitle cue missing');
await page.screenshot({ path: 'visual-proof/03-desktop-subtitles.png', fullPage: false });

const oldPosition = Number(await input.inputValue());
const nextCue = page.locator('.audio-subtitle-line.is-next').first();
if (await nextCue.count()) {
  await nextCue.click();
  await page.waitForTimeout(80);
  assert.notEqual(Number(await input.inputValue()), oldPosition, 'Subtitle cue click failed to seek');
}

const beforeSection = await dock.boundingBox();
await page.locator('.audio-section-toggle').click();
await page.waitForTimeout(100);
const afterSection = await dock.boundingBox();
const panel = page.locator('.audio-section-panel-floating');
const panelBox = await panel.boundingBox();
assert.ok(beforeSection && afterSection && panelBox);
assert.ok(closeEnough(afterSection.width, beforeSection.width) && closeEnough(afterSection.height, beforeSection.height), `Section changed dock geometry ${JSON.stringify({beforeSection,afterSection})}`);
assert.ok(panelBox.x >= afterSection.x + afterSection.width + 8, `Section panel is not detached: ${JSON.stringify({afterSection,panelBox})}`);
assert.ok(panelBox.y >= 16 && panelBox.y + panelBox.height <= 884, 'Section panel exceeds desktop viewport');
assert.equal(await timeline.isVisible(), true, 'Timeline hidden by Section list');
assert.equal(await page.locator('.audio-player-controls').isVisible(), true, 'Controls hidden by Section list');
assert.ok(await page.locator('.audio-subtitle-float').evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)) < 0.05, 'Subtitle should recede while Section list is open');
await page.screenshot({ path: 'visual-proof/04-desktop-sections.png', fullPage: false });
await page.locator('.audio-section-toggle').click();

await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 412, height: 915 } });
const mp = await mobile.newPage();
await seed(mp, source.id, true);
await mp.locator('.audio-subtitle-float').waitFor({ state: 'visible', timeout: 10000 });
const mobileDock = mp.locator('.audio-player-dock');
const mobileBefore = await mobileDock.boundingBox();
const mobileSubtitle = await mp.locator('.audio-subtitle-float').boundingBox();
assert.ok(mobileBefore && mobileSubtitle);
assert.ok(mobileSubtitle.y + mobileSubtitle.height <= mobileBefore.y + 2, 'Mobile subtitle does not float above dock');
await mp.screenshot({ path: 'visual-proof/05-mobile-subtitles.png', fullPage: false });

await mp.locator('.audio-section-toggle').click();
await mp.waitForTimeout(100);
const mobileAfter = await mobileDock.boundingBox();
const mobilePanel = await mp.locator('.audio-section-panel-floating').boundingBox();
assert.ok(mobileAfter && mobilePanel);
assert.ok(closeEnough(mobileAfter.width, mobileBefore.width) && closeEnough(mobileAfter.height, mobileBefore.height), 'Mobile Section list changes player size');
assert.ok(mobilePanel.y + mobilePanel.height <= mobileAfter.y + 2, 'Mobile Section list is not detached above dock');
assert.equal(await mp.locator('.audio-player-timeline').isVisible(), true);
assert.equal(await mp.locator('.audio-player-controls').isVisible(), true);
await mp.screenshot({ path: 'visual-proof/06-mobile-sections.png', fullPage: false });
await mobile.close();

await browser.close();
