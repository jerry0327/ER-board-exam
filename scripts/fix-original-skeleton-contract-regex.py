from pathlib import Path
import re

# Repair focused contracts and small runtime integration regressions while
# keeping the original player shell itself intact.

dock_path = Path('tests/audio-player-dock-contract.test.mjs')
dock = dock_path.read_text()
old_dock_candidates = [
    r'''  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-edge-progress,\s*\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);''',
    r'''  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);''',
]
new_dock = r'''  const stowedHiddenStart = css.indexOf(".audio-player-dock.is-stowed .audio-player-edge-progress,");
  assert.ok(stowedHiddenStart >= 0, "stowed hidden group must include edge progress");
  const stowedHiddenEnd = css.indexOf("}", stowedHiddenStart);
  const stowedHiddenGroup = css.slice(stowedHiddenStart, stowedHiddenEnd + 1);
  assert.match(stowedHiddenGroup, /\.audio-player-dock\.is-stowed \.audio-player-mini,/u);
  assert.match(stowedHiddenGroup, /\.audio-player-dock\.is-stowed \.audio-player-details\s*\{/u);
  assert.match(stowedHiddenGroup, /display:\s*none;/u);'''
if 'const stowedHiddenStart = css.indexOf(' not in dock:
    for old in old_dock_candidates:
        if old in dock:
            dock = dock.replace(old, new_dock, 1)
            break
    else:
        raise RuntimeError('stowed hidden-selector assertion not found')

old_prefetch_ref = r'''  assert.match(provider, /sourcePrefetchesRef\.current = useRef\(new Map<string, Promise<void>>\(\)\)/u);'''
new_prefetch_ref = r'''  assert.match(provider, /const sourcePrefetchesRef = useRef\(new Map<string, Promise<void>>\(\)\);/u);'''
if old_prefetch_ref in dock:
    dock = dock.replace(old_prefetch_ref, new_prefetch_ref, 1)
elif new_prefetch_ref not in dock:
    raise RuntimeError('sourcePrefetchesRef assertion not found')
dock_path.write_text(dock)

section_path = Path('tests/audio-player-section-subtitle-contract.test.mjs')
section = section_path.read_text()
old_settings_candidates = [
    r'''  assert.match(enhancement, /\.audio-player-settings-panel\s+\.audio-player-options\s*\{[\s\S]*?display:\s*grid;/u);''',
    r'''  assert.match(enhancement, /\.audio-player-settings-panel \.audio-player-options\s*\{[^}]*display: grid;/u);''',
]
new_settings = r'''  const settingsOptionsStart = enhancement.indexOf(".audio-player-settings-panel .audio-player-options");
  assert.ok(settingsOptionsStart >= 0, "Settings options selector must exist");
  const settingsOptionsEnd = enhancement.indexOf("}", settingsOptionsStart);
  const settingsOptionsBlock = enhancement.slice(settingsOptionsStart, settingsOptionsEnd + 1);
  assert.match(settingsOptionsBlock, /display:\s*grid;/u);'''
if 'const settingsOptionsStart = enhancement.indexOf(' not in section:
    for old in old_settings_candidates:
        if old in section:
            section = section.replace(old, new_settings, 1)
            break
    else:
        raise RuntimeError('settings-grid assertion not found')

old_shell_guard = r'''  assert.doesNotMatch(enhancement, /\.audio-player-dock(?:\s|,|\{|\.is-(?:expanded|collapsed|stowed))/u);'''
new_shell_guard = r'''  assert.doesNotMatch(enhancement, /(?:^|\n)\s*\.audio-player-dock(?:\.is-(?:expanded|collapsed|stowed))?\s*(?:,|\{)/u);'''
if old_shell_guard in section:
    section = section.replace(old_shell_guard, new_shell_guard, 1)
elif new_shell_guard not in section:
    raise RuntimeError('player-shell guard assertion not found')
section_path.write_text(section)

# Runtime: when a paused stowed player is long-pressed, provide immediate
# buffering feedback before the async audio graph resumes. The actual play path
# remains togglePlayback(); this only makes the gesture state deterministic.
provider_path = Path('app/components/audio-player-provider.tsx')
provider = provider_path.read_text()
old_long_press = '''      restorePlaybackToggledRef.current = true;
      restoreLongPressTriggeredRef.current = true;
      void togglePlayback();'''
new_long_press = '''      restorePlaybackToggledRef.current = true;
      restoreLongPressTriggeredRef.current = true;
      if (!playingIntentRef.current && phaseRef.current === "paused") updatePhase("buffering");
      void togglePlayback();'''
if old_long_press in provider:
    provider = provider.replace(old_long_press, new_long_press, 1)
elif new_long_press not in provider:
    raise RuntimeError('restore long-press callback not found')
provider_path.write_text(provider)

# The original dock clips its contents. Expanded-only overflow must be visible
# so Section and subtitle popovers can sit outside the shell without changing
# its dimensions, compact state, or stowed state.
css_path = Path('app/site.css')
css = css_path.read_text()
old_expanded = '''  .audio-player-dock.is-expanded {
    width: min(780px, calc(100vw - 32px));
  }'''
new_expanded = '''  .audio-player-dock.is-expanded {
    overflow: visible;
    width: min(780px, calc(100vw - 32px));
  }'''
if old_expanded in css:
    css = css.replace(old_expanded, new_expanded, 1)
elif new_expanded not in css:
    raise RuntimeError('expanded original player block not found')

# Ensure the sleep-timer label is a visible Settings row. It was present in the
# DOM but the legacy flex presentation could collapse the label in this panel.
select_anchor = '''  .audio-player-settings-panel .audio-player-option-select select {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    min-height: 40px;
    width: 100%;
  }'''
visible_select = '''  .audio-player-settings-panel .audio-player-option-select {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    min-height: 44px;
    width: 100%;
  }

''' + select_anchor
if 'grid-template-columns: 18px minmax(0, 1fr);' not in css:
    if select_anchor not in css:
        raise RuntimeError('Settings sleep-timer selector block not found')
    css = css.replace(select_anchor, visible_select, 1)

# Keep all player overlays on exactly the same established reader chrome as the
# original player shell. No new colors, radii, or shadows are introduced here.
# Section, Settings, and subtitles therefore follow the site's theme tokens in
# light, dark, and black modes instead of looking like separate white widgets.
panel_skin = '''

  /* Audio overlays inherit the native reader-panel visual language. */
  .audio-player-settings-panel,
  .audio-section-panel,
  .audio-subtitle-float {
    background: var(--site-reader-chrome);
    border-color: color-mix(in srgb, var(--site-line-strong) 66%, transparent);
    border-radius: var(--site-panel-radius);
    box-shadow: var(--site-shadow-low);
    color: var(--site-ink);
  }

  .audio-player-settings-panel .audio-player-option,
  .audio-section-list button,
  .audio-subtitle-line {
    border-radius: var(--site-radius);
  }

  .audio-player-settings-panel .audio-player-option:hover,
  .audio-player-settings-panel .audio-player-option:focus-visible,
  .audio-section-list button:hover,
  .audio-section-list button:focus-visible,
  .audio-subtitle-line:hover,
  .audio-subtitle-line:focus-visible {
    background: var(--site-surface-hover);
  }
'''
if 'Audio overlays inherit the native reader-panel visual language.' not in css:
    marker = '  /* Audio Section + Subtitle Incremental Enhancement */'
    if marker in css:
        css = css.replace(marker, panel_skin + '\n' + marker, 1)
    else:
        # The exact comment is intentionally not a runtime dependency; append to
        # the existing site-features layer before its final mobile rules when the
        # marker is absent.
        insert_at = css.rfind('\n@layer site-utilities')
        if insert_at < 0:
            raise RuntimeError('site feature insertion point not found')
        css = css[:insert_at] + panel_skin + css[insert_at:]

# Spoken-audio transport: preserve the established -15/+30 behavior but remove
# decorative pills around the secondary chapter/skip controls. Their 44px hit
# areas stay intact; only the visual chrome disappears until hover/focus.
transport_skin = '''

  /* Spoken-audio transport: quiet secondary actions, primary play anchor. */
  .audio-player-chapter-control,
  .audio-player-skip {
    background: transparent;
    border-color: transparent;
    border-radius: var(--site-radius);
    color: var(--site-ink-soft);
    transition:
      background-color 140ms var(--site-ease),
      color 140ms var(--site-ease),
      scale 120ms var(--site-ease);
  }

  .audio-player-chapter-control:hover:not(:disabled),
  .audio-player-chapter-control:focus-visible,
  .audio-player-skip:hover:not(:disabled),
  .audio-player-skip:focus-visible {
    background: var(--site-surface-hover);
    border-color: transparent;
    color: var(--site-primary);
  }

  .audio-player-chapter-control:active:not(:disabled),
  .audio-player-skip:active:not(:disabled) {
    scale: .94;
  }

  .audio-player-skip span {
    color: currentColor;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
'''
if 'Spoken-audio transport: quiet secondary actions' not in css:
    anchor = panel_skin
    if anchor in css:
        css = css.replace(anchor, anchor + transport_skin, 1)
    else:
        raise RuntimeError('panel skin insertion anchor missing')

# YouTube-like chapter feedback while keeping the original range input as the
# precise seek surface. Chapter separators stay subtle until hover/focus, when
# the track, playhead and selected separator gain emphasis and the existing
# semantic title/time tooltip becomes visible with motion rather than popping.
timeline_skin = '''

  /* Chapter seeking feedback: one centerline, progressive hover disclosure. */
  .audio-section-track-base,
  .audio-section-track-progress {
    transition: height 140ms var(--site-ease), opacity 140ms var(--site-ease);
  }

  .audio-section-playhead {
    transition:
      height 140ms var(--site-ease),
      width 140ms var(--site-ease),
      box-shadow 140ms var(--site-ease);
  }

  .audio-section-node {
    cursor: pointer;
    transition:
      background-color 140ms var(--site-ease),
      height 140ms var(--site-ease),
      width 140ms var(--site-ease);
  }

  .audio-player-timeline:hover .audio-section-track-base,
  .audio-player-timeline:hover .audio-section-track-progress,
  .audio-player-timeline:focus-within .audio-section-track-base,
  .audio-player-timeline:focus-within .audio-section-track-progress {
    height: 4px;
  }

  .audio-player-timeline:hover .audio-section-playhead,
  .audio-player-timeline:focus-within .audio-section-playhead {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-primary) 12%, transparent);
    height: 13px;
    width: 13px;
  }

  .audio-section-node:hover,
  .audio-section-node:focus-visible {
    background: var(--site-primary);
    height: 15px;
    width: 3px;
  }

  .audio-section-node-tooltip {
    display: block;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, 4px);
    transition:
      opacity 120ms var(--site-ease),
      transform 160ms var(--site-ease),
      visibility 0s linear 160ms;
    visibility: hidden;
  }

  .audio-section-node:hover .audio-section-node-tooltip,
  .audio-section-node:focus-visible .audio-section-node-tooltip {
    opacity: 1;
    transform: translate(-50%, 0);
    transition-delay: 0s;
    visibility: visible;
  }
'''
if 'Chapter seeking feedback: one centerline' not in css:
    anchor = transport_skin
    if anchor in css:
        css = css.replace(anchor, anchor + timeline_skin, 1)
    else:
        raise RuntimeError('transport skin insertion anchor missing')

css_path.write_text(css)

# Mobile runtime QA must exercise an actual touch and a Section marker that is
# meaningfully separated from the seeded position. The prior nth(3) happened to
# be 06:46 while the seed was 06:45.4, so its >1s movement assertion produced a
# false negative even when the node was clicked correctly.
qa_path = Path('scripts/qa-original-player-skeleton.mjs')
qa = qa_path.read_text()
old_mobile_seek = '''  const node = page.locator(".audio-section-node").nth(3);
  const before = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  await node.click();
  await page.waitForTimeout(180);
  const after = Number(await page.locator(".audio-player-timeline > input[type=range]").inputValue());
  report.mobile[key].nodeSeek = { before, after };
  if (Math.abs(after - before) < 1) throw new Error(`mobile ${width}: Section node not clickable`);'''
new_mobile_seek = '''  const range = page.locator(".audio-player-timeline > input[type=range]");
  const before = Number(await range.inputValue());
  const duration = Number(await range.getAttribute("max"));
  const nodes = page.locator(".audio-section-node");
  const nodeCount = await nodes.count();
  if (nodeCount < 2) throw new Error(`mobile ${width}: expected multiple Section nodes`);
  const candidates = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const left = Number.parseFloat((await nodes.nth(index).getAttribute("style"))?.match(/left:\\s*([0-9.]+)%/u)?.[1] ?? "NaN");
    if (Number.isFinite(left)) candidates.push({ index, expected: duration * left / 100 });
  }
  candidates.sort((a, b) => Math.abs(b.expected - before) - Math.abs(a.expected - before));
  const target = candidates[0];
  if (!target || Math.abs(target.expected - before) < 30) throw new Error(`mobile ${width}: no distant Section node available`);
  await nodes.nth(target.index).tap();
  await page.waitForTimeout(220);
  const after = Number(await range.inputValue());
  report.mobile[key].nodeSeek = { before, after, expected: target.expected, index: target.index };
  if (Math.abs(after - target.expected) > 1.5) {
    throw new Error(`mobile ${width}: touch Section seek missed target; ${JSON.stringify(report.mobile[key].nodeSeek)}`);
  }'''
if old_mobile_seek in qa:
    qa = qa.replace(old_mobile_seek, new_mobile_seek, 1)
elif 'touch Section seek missed target' not in qa:
    raise RuntimeError('mobile Section QA block not found')

# Strengthen live browser QA for visual-language reuse and chapter hover. The
# overlays must compute to the same reader-chrome background as the player and
# a chapter hover/focus must reveal a non-empty semantic title/time tooltip.
old_desktop_settings = '''  await page.locator(".audio-player-settings > summary").click();
  await page.locator(".audio-player-settings-panel").waitFor({ state: "visible" });
  await shot(page, "02-desktop-settings.png");
  await page.keyboard.press("Escape");'''
new_desktop_settings = '''  await page.locator(".audio-player-settings > summary").click();
  await page.locator(".audio-player-settings-panel").waitFor({ state: "visible" });
  const settingsSurface = await page.evaluate(() => ({
    dock: getComputedStyle(document.querySelector(".audio-player-dock")).backgroundColor,
    panel: getComputedStyle(document.querySelector(".audio-player-settings-panel")).backgroundColor,
  }));
  report.desktop.settingsSurface = settingsSurface;
  if (settingsSurface.dock !== settingsSurface.panel) throw new Error(`Settings surface diverges from player: ${JSON.stringify(settingsSurface)}`);
  await shot(page, "02-desktop-settings.png");
  await page.keyboard.press("Escape");'''
if old_desktop_settings in qa:
    qa = qa.replace(old_desktop_settings, new_desktop_settings, 1)
elif 'settingsSurface' not in qa:
    raise RuntimeError('desktop Settings QA block not found')

old_desktop_sections = '''  await page.locator(".audio-section-toggle").click();
  await page.locator(".audio-section-panel-floating").waitFor({ state: "visible" });
  await shot(page, "03-desktop-sections.png");
  await page.keyboard.press("Escape");'''
new_desktop_sections = '''  await page.locator(".audio-section-toggle").click();
  await page.locator(".audio-section-panel-floating").waitFor({ state: "visible" });
  const sectionSurface = await page.evaluate(() => ({
    dock: getComputedStyle(document.querySelector(".audio-player-dock")).backgroundColor,
    panel: getComputedStyle(document.querySelector(".audio-section-panel-floating")).backgroundColor,
  }));
  report.desktop.sectionSurface = sectionSurface;
  if (sectionSurface.dock !== sectionSurface.panel) throw new Error(`Section surface diverges from player: ${JSON.stringify(sectionSurface)}`);
  await shot(page, "03-desktop-sections.png");
  await page.keyboard.press("Escape");

  const hoverNode = page.locator(".audio-section-node").nth(4);
  await hoverNode.hover();
  const tooltip = hoverNode.locator(".audio-section-node-tooltip");
  await tooltip.waitFor({ state: "visible" });
  const tooltipText = (await tooltip.innerText()).trim();
  report.desktop.chapterHover = { text: tooltipText };
  if (!tooltipText || !/\\d{2}:\\d{2}/u.test(tooltipText)) throw new Error(`Chapter hover tooltip missing title/time: ${JSON.stringify(tooltipText)}`);
  await shot(page, "03b-desktop-timeline-hover.png");'''
if old_desktop_sections in qa:
    qa = qa.replace(old_desktop_sections, new_desktop_sections, 1)
elif 'chapterHover' not in qa:
    raise RuntimeError('desktop Section QA block not found')

# The subtitle float is visible in the base expanded state. Confirm its computed
# surface is the same native reader chrome instead of a separate white card.
old_expanded_shot = '''  if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error("desktop stow missing in expanded state");
  await shot(page, "01-desktop-original-expanded.png");'''
new_expanded_shot = '''  if (!(await page.locator(".audio-player-stow").isVisible())) throw new Error("desktop stow missing in expanded state");
  const subtitleSurface = await page.evaluate(() => {
    const dock = document.querySelector(".audio-player-dock");
    const subtitle = document.querySelector(".audio-subtitle-float");
    return subtitle ? { dock: getComputedStyle(dock).backgroundColor, panel: getComputedStyle(subtitle).backgroundColor } : null;
  });
  report.desktop.subtitleSurface = subtitleSurface;
  if (subtitleSurface && subtitleSurface.dock !== subtitleSurface.panel) throw new Error(`Subtitle surface diverges from player: ${JSON.stringify(subtitleSurface)}`);
  await shot(page, "01-desktop-original-expanded.png");'''
if old_expanded_shot in qa:
    qa = qa.replace(old_expanded_shot, new_expanded_shot, 1)
elif 'subtitleSurface' not in qa:
    raise RuntimeError('desktop expanded QA block not found')

qa_path.write_text(qa)
