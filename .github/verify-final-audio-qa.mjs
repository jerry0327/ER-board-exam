import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const base = "http://127.0.0.1:4173/";
const report = { interactions: {}, matrix: [] };
const same = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

async function catalog(page) {
  return page.evaluate(async () => (await (await fetch("/audio/snac/catalog.json")).json()).entries);
}

async function seed(page, sourceId, { subtitles = false, position = 12 } = {}) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ sourceId, subtitles, position }) => {
    localStorage.setItem("em-board-audio-player-v2", JSON.stringify({
      sourceId,
      position,
      rate: 1,
      expanded: true,
      stowed: false,
      continuousPlay: true,
      queueIds: [],
      randomReview: false,
    }));
    localStorage.setItem("em-board-audio-subtitles-v1", subtitles ? "true" : "false");
  }, { sourceId, subtitles, position });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".audio-player-dock").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".audio-player-timeline").waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForCompanion(page) {
  await page.locator(".audio-section-companion").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(100);
}

async function box(locator, label) {
  const value = await locator.boundingBox();
  assert.ok(value, `${label} must have a bounding box`);
  return value;
}

async function noHorizontalOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    geometry.documentWidth <= geometry.viewportWidth + 1,
    `${label}: horizontal overflow ${geometry.documentWidth} > ${geometry.viewportWidth}`,
  );
}

async function applyTheme(page, theme) {
  await page.evaluate((themeName) => {
    const root = document.documentElement;
    root.removeAttribute("data-theme");
    root.removeAttribute("data-theme-mode");
    if (themeName === "dark") {
      root.setAttribute("data-theme", "dark");
      root.setAttribute("data-theme-mode", "dark");
    } else if (themeName === "black") {
      root.setAttribute("data-theme", "dark");
      root.setAttribute("data-theme-mode", "black");
    }
  }, theme);
  await page.waitForTimeout(30);
}

async function openSection(page) {
  await page.locator(".audio-section-toggle").click();
  await page.locator(".audio-section-panel-floating").waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(50);
}

async function closeSectionWithEscape(page) {
  await page.keyboard.press("Escape");
  await page.locator(".audio-section-panel-floating").waitFor({ state: "detached", timeout: 5_000 });
}

const desktopContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await desktopContext.newPage();
await page.goto(base, { waitUntil: "domcontentloaded" });
const entries = await catalog(page);
const source = entries.find((entry) => entry.kind === "textbook-chapter" || entry.kind === "textbook-section");
assert.ok(source, "A textbook audio source is required for player QA");
const questionSource = entries.find((entry) => entry.kind === "question-set" && entry.questionExam && Number.isInteger(entry.questionStart));
assert.ok(questionSource, "A question-set source is required for dialog QA");

await seed(page, source.id, { subtitles: false, position: 12 });
await waitForCompanion(page);
await applyTheme(page, "light");
await noHorizontalOverflow(page, "desktop base");

const dock = page.locator(".audio-player-dock");
const timeline = page.locator(".audio-player-timeline");
const baseDock = await box(dock, "desktop dock");
const baseTimeline = await box(timeline, "desktop timeline");
await page.screenshot({ path: "visual-proof/01-desktop-light-base.png", fullPage: false });

// Section popover: geometry-neutral, focus-managed, Escape and outside dismiss.
await openSection(page);
const sectionPanel = page.locator(".audio-section-panel-floating");
const sectionDock = await box(dock, "dock with Section open");
const panelBox = await box(sectionPanel, "Section panel");
assert.ok(same(baseDock.width, sectionDock.width) && same(baseDock.height, sectionDock.height), "Section changed player geometry");
assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= 1920, "Section panel exceeds desktop viewport horizontally");
assert.ok(panelBox.y >= 0 && panelBox.y + panelBox.height <= baseDock.y + 1, "Section panel must float above the dock");
assert.equal(await page.evaluate(() => document.querySelector(".audio-section-panel-floating")?.contains(document.activeElement)), true, "Section should move focus into its popover");
const sectionRows = page.locator(".audio-section-list button");
assert.ok(await sectionRows.count() >= 8, "Section list should expose the full L1 structure");
for (let i = 0; i < await sectionRows.count(); i += 1) {
  const row = await box(sectionRows.nth(i), `desktop Section row ${i + 1}`);
  assert.ok(row.height >= 39, "Desktop Section row is unexpectedly compressed");
}
await closeSectionWithEscape(page);
assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".audio-section-toggle")), true, "Escape should return focus to Section trigger");
await openSection(page);
await page.evaluate(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
await page.locator(".audio-section-panel-floating").waitFor({ state: "detached", timeout: 5_000 });

// Settings and Section must be mutually exclusive and Settings must dismiss correctly.
await openSection(page);
await page.locator(".audio-player-settings > summary").click();
assert.equal(await page.locator(".audio-player-settings").evaluate((node) => node.open), true, "Settings should open");
assert.equal(await page.locator(".audio-section-panel-floating").count(), 0, "Opening Settings must close Section");
const settingsTimeline = await box(timeline, "timeline with Settings open");
assert.ok(same(settingsTimeline.y, baseTimeline.y) && same(settingsTimeline.height, baseTimeline.height), "Settings changed timeline geometry");
await page.screenshot({ path: "visual-proof/02-desktop-light-settings.png", fullPage: false });
await page.keyboard.press("Escape");
await page.waitForTimeout(30);
assert.equal(await page.locator(".audio-player-settings").evaluate((node) => node.open), false, "Escape should close Settings");
assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".audio-player-settings > summary")), true, "Settings Escape should restore trigger focus");
await page.locator(".audio-player-settings > summary").click();
assert.equal(await page.locator(".audio-player-settings").evaluate((node) => node.open), true);
await page.locator(".audio-section-toggle").click();
await page.locator(".audio-section-panel-floating").waitFor({ state: "visible", timeout: 5_000 });
assert.equal(await page.locator(".audio-player-settings").evaluate((node) => node.open), false, "Opening Section must close Settings");
await closeSectionWithEscape(page);

// Subtitle toggle, seek behavior, geometry neutrality, and persistence.
await page.locator(".audio-player-settings > summary").click();
const subtitleToggle = page.locator(".audio-player-subtitle-option");
assert.equal(await subtitleToggle.getAttribute("aria-pressed"), "false");
await subtitleToggle.click();
assert.equal(await subtitleToggle.getAttribute("aria-pressed"), "true");
await page.locator(".audio-player-settings > summary").click();
await page.locator(".audio-subtitle-float").waitFor({ state: "visible", timeout: 10_000 });
const subtitleDock = await box(dock, "dock with subtitles");
assert.ok(same(baseDock.width, subtitleDock.width) && same(baseDock.height, subtitleDock.height), "Subtitles changed player geometry");
assert.equal(await page.locator(".audio-subtitle-line.is-current").count(), 1, "Exactly one current subtitle cue is expected");
const timelineInput = page.locator('.audio-player-timeline > input[type="range"]').first();
const nextSubtitle = page.locator(".audio-subtitle-line.is-next");
if (await nextSubtitle.count()) {
  const beforeSeek = Number(await timelineInput.inputValue());
  await nextSubtitle.click();
  await page.waitForTimeout(50);
  const afterSeek = Number(await timelineInput.inputValue());
  assert.ok(afterSeek > beforeSeek, `Subtitle click should seek forward (${beforeSeek} -> ${afterSeek})`);
}
await applyTheme(page, "dark");
await page.screenshot({ path: "visual-proof/03-desktop-dark-subtitles.png", fullPage: false });
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".audio-player-dock").waitFor({ state: "visible", timeout: 30_000 });
await waitForCompanion(page);
await page.locator(".audio-subtitle-float").waitFor({ state: "visible", timeout: 10_000 });
assert.equal(await page.locator(".audio-player-subtitle-option").getAttribute("aria-pressed"), "true", "Subtitle preference should survive reload");

// Question-choice dialog: focus containment, scroll lock, Escape restoration.
await page.locator(".audio-section-toggle").focus();
const questionId = `${questionSource.questionExam}-Q${String(questionSource.questionStart).padStart(3, "0")}`;
await page.evaluate(({ sourceId, questionId }) => {
  window.dispatchEvent(new CustomEvent("em-board-question-audio-choice", { detail: { sourceId, questionId } }));
}, { sourceId: questionSource.id, questionId });
const questionDialog = page.locator(".audio-question-choice");
await questionDialog.waitFor({ state: "visible", timeout: 5_000 });
assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "Question dialog must lock background scroll");
assert.equal(await page.evaluate(() => document.querySelector(".audio-question-choice")?.contains(document.activeElement)), true, "Question dialog should take focus");
await page.keyboard.press("Shift+Tab");
assert.equal(await page.evaluate(() => document.querySelector(".audio-question-choice")?.contains(document.activeElement)), true, "Question dialog focus should remain trapped");
await page.keyboard.press("Escape");
await questionDialog.waitFor({ state: "detached", timeout: 5_000 });
await page.waitForTimeout(30);
assert.equal(await page.evaluate(() => document.body.style.overflow), "", "Question dialog must restore body scrolling");
assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".audio-section-toggle")), true, "Question dialog should restore the invoking focus");

// Final desktop Section screenshot in black mode.
await applyTheme(page, "black");
await openSection(page);
await noHorizontalOverflow(page, "desktop black Section");
await page.screenshot({ path: "visual-proof/04-desktop-black-sections.png", fullPage: false });
await closeSectionWithEscape(page);

report.interactions = {
  sectionEscapeAndOutsideDismiss: true,
  sectionSettingsMutualExclusion: true,
  settingsEscapeFocusReturn: true,
  subtitleToggleSeekAndPersistence: true,
  questionDialogFocusAndScrollLifecycle: true,
};

// Desktop theme/viewport matrix.
for (const size of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
  await page.setViewportSize(size);
  for (const theme of ["light", "dark", "black"]) {
    await applyTheme(page, theme);
    await noHorizontalOverflow(page, `desktop ${size.width}x${size.height} ${theme}`);
    const currentDock = await box(dock, `desktop dock ${size.width} ${theme}`);
    assert.ok(currentDock.x >= 0 && currentDock.x + currentDock.width <= size.width + 1, "Desktop dock left viewport");
    await openSection(page);
    const currentPanel = await box(page.locator(".audio-section-panel-floating"), `desktop panel ${size.width} ${theme}`);
    assert.ok(currentPanel.x >= 0 && currentPanel.x + currentPanel.width <= size.width + 1, "Desktop panel left viewport horizontally");
    assert.ok(currentPanel.y >= 0 && currentPanel.y + currentPanel.height <= size.height + 1, "Desktop panel left viewport vertically");
    report.matrix.push({ width: size.width, height: size.height, theme, touch: false, ok: true });
    await closeSectionWithEscape(page);
  }
}
await desktopContext.close();

// Fail-open: semantic subtitle/Section data failure cannot break core playback controls.
const failContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await failContext.route("**/subtitles-runtime/**", (route) => route.abort());
const failPage = await failContext.newPage();
await seed(failPage, source.id, { subtitles: true, position: 12 });
await failPage.waitForTimeout(500);
assert.equal(await failPage.locator(".audio-player-timeline").isVisible(), true, "Core timeline should survive subtitle runtime failure");
assert.equal(await failPage.locator(".audio-player-controls").isVisible(), true, "Core controls should survive subtitle runtime failure");
assert.equal(await failPage.locator(".audio-section-companion").count(), 0, "Failed semantic runtime should fail open without a broken Section shell");
assert.equal(await failPage.locator(".audio-player-subtitle-option").count(), 1, "Subtitle preference control should remain available");
report.interactions.semanticRuntimeFailOpen = true;
await failContext.close();

// Touch/mobile matrix and target geometry.
const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobile = await mobileContext.newPage();
await seed(mobile, source.id, { subtitles: true, position: 12 });
await waitForCompanion(mobile);

for (const size of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  await mobile.setViewportSize(size);
  for (const theme of ["light", "dark", "black"]) {
    await applyTheme(mobile, theme);
    await noHorizontalOverflow(mobile, `mobile ${size.width}x${size.height} ${theme}`);
    const mobileDock = await box(mobile.locator(".audio-player-dock"), `mobile dock ${size.width} ${theme}`);
    assert.ok(mobileDock.x >= 0 && mobileDock.x + mobileDock.width <= size.width + 1, "Mobile dock left viewport");
    const sectionTriggerBox = await box(mobile.locator(".audio-section-toggle"), "mobile Section trigger");
    const settingsSummaryBox = await box(mobile.locator(".audio-player-settings > summary"), "mobile Settings trigger");
    const mobileTimelineInput = await box(mobile.locator('.audio-player-timeline > input[type="range"]').first(), "mobile timeline range");
    assert.ok(sectionTriggerBox.height >= 44, "Mobile Section trigger must be at least 44px high");
    assert.ok(settingsSummaryBox.height >= 44 && settingsSummaryBox.width >= 44, "Mobile Settings trigger must be 44x44");
    assert.ok(mobileTimelineInput.height >= 44, "Mobile timeline must expose a 44px touch target");
    const nodePointerEvents = await mobile.locator(".audio-section-node").first().evaluate((node) => getComputedStyle(node).pointerEvents);
    assert.equal(nodePointerEvents, "none", "Section ticks must not steal coarse-pointer timeline drags");

    const subtitleLines = mobile.locator(".audio-subtitle-line:visible");
    for (let i = 0; i < await subtitleLines.count(); i += 1) {
      const subtitleBox = await box(subtitleLines.nth(i), `mobile subtitle ${i + 1}`);
      assert.ok(subtitleBox.height >= 44, "Mobile subtitle cue must be at least 44px high");
    }

    const dockBeforeSection = await box(mobile.locator(".audio-player-dock"), "mobile dock before Section");
    await openSection(mobile);
    const dockAfterSection = await box(mobile.locator(".audio-player-dock"), "mobile dock after Section");
    assert.ok(same(dockBeforeSection.width, dockAfterSection.width) && same(dockBeforeSection.height, dockAfterSection.height), "Mobile Section changed dock geometry");
    const mobilePanel = await box(mobile.locator(".audio-section-panel-floating"), "mobile Section panel");
    assert.ok(mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= size.width + 1, "Mobile Section panel left viewport horizontally");
    assert.ok(mobilePanel.y >= 0 && mobilePanel.y + mobilePanel.height <= dockAfterSection.y + 1, "Mobile Section panel should float above player");
    const mobileRows = mobile.locator(".audio-section-list button");
    for (let i = 0; i < await mobileRows.count(); i += 1) {
      const rowBox = await box(mobileRows.nth(i), `mobile Section row ${i + 1}`);
      assert.ok(rowBox.height >= 44, "Mobile Section row must be at least 44px high");
    }
    report.matrix.push({ width: size.width, height: size.height, theme, touch: true, ok: true });
    await closeSectionWithEscape(mobile);
  }
}

await mobile.setViewportSize({ width: 390, height: 844 });
await applyTheme(mobile, "light");
await mobile.locator(".audio-subtitle-float").waitFor({ state: "visible", timeout: 10_000 });
await mobile.screenshot({ path: "visual-proof/05-mobile-390-light-subtitles.png", fullPage: false });
await mobile.setViewportSize({ width: 430, height: 932 });
await applyTheme(mobile, "black");
await openSection(mobile);
await mobile.screenshot({ path: "visual-proof/06-mobile-430-black-sections.png", fullPage: false });
await closeSectionWithEscape(mobile);
await mobileContext.close();

await writeFile("visual-proof/final-audio-qa.json", `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(report, null, 2));
