from pathlib import Path

# Replace formatting-sensitive or stale regex assertions with semantic checks.
# The contracts stay strict about the original player skeleton while allowing
# harmless descendant scoping inside the enhancement layer.

dock_path = Path('tests/audio-player-dock-contract.test.mjs')
dock = dock_path.read_text()
old_dock_candidates = [
    r'''  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-edge-progress,\s*\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);''',
    r'''  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);''',
]
new_dock = '''  const stowedHiddenStart = css.indexOf(".audio-player-dock.is-stowed .audio-player-edge-progress,");
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

# sourcePrefetchesRef is a ref declaration. The prior contract accidentally
# asserted an assignment to `.current`, which is not the implementation and
# does not represent the intended bounded-prefetch behavior.
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
new_settings = '''  const settingsOptionsStart = enhancement.indexOf(".audio-player-settings-panel .audio-player-options");
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

# Descendant selectors such as `.audio-player-dock > .audio-section-panel`
# are legitimate enhancement scoping. Forbid only direct shell/state selector
# blocks so the enhancement layer cannot redefine the original dock geometry.
old_shell_guard = r'''  assert.doesNotMatch(enhancement, /\.audio-player-dock(?:\s|,|\{|\.is-(?:expanded|collapsed|stowed))/u);'''
new_shell_guard = r'''  assert.doesNotMatch(enhancement, /(?:^|\n)\s*\.audio-player-dock(?:\.is-(?:expanded|collapsed|stowed))?\s*(?:,|\{)/u);'''
if old_shell_guard in section:
    section = section.replace(old_shell_guard, new_shell_guard, 1)
elif new_shell_guard not in section:
    raise RuntimeError('player-shell guard assertion not found')

section_path.write_text(section)
