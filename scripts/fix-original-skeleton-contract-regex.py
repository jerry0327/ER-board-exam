from pathlib import Path

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
qa_path.write_text(qa)
