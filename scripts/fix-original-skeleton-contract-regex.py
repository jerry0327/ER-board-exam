from pathlib import Path

path = Path('tests/audio-player-dock-contract.test.mjs')
text = path.read_text()
old = r'''  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);'''
new = r'''  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-edge-progress,\s*\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);'''
if old not in text:
    raise RuntimeError('stowed hidden-selector assertion not found')
path.write_text(text.replace(old, new, 1))

path = Path('tests/audio-player-section-subtitle-contract.test.mjs')
text = path.read_text()
old = r'''  assert.match(enhancement, /\.audio-player-settings-panel \.audio-player-options\s*\{[^}]*display: grid;/u);'''
new = r'''  assert.match(enhancement, /\.audio-player-settings-panel\s+\.audio-player-options\s*\{[\s\S]*?display:\s*grid;/u);'''
if old not in text:
    raise RuntimeError('settings-grid assertion not found')
path.write_text(text.replace(old, new, 1))
