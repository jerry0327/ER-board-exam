from pathlib import Path

# Replace two formatting-sensitive regex assertions with small semantic slices.
# This keeps the contracts strict about behavior while no longer depending on
# whether grouped selectors happen to be line-broken in one exact way.

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
section_path.write_text(section)
