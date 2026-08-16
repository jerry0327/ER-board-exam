from pathlib import Path

path = Path("app/components/audio-section-companion.tsx")
text = path.read_text()

old_state = '''  const scopePosition = player.position;\n  const scopeIsPlaying = player.isPlaying;\n  const scopePlaybackRate = player.playbackRate;\n'''
new_state = '''  const scopePosition = player.position;\n  const scopeHasPlaybackIntent = player.isPlaying;\n  const scopeIsRendering = player.phase === "playing";\n  const scopePlaybackRate = player.playbackRate;\n'''
if old_state not in text:
    raise SystemExit("Scoped playback state block not found")
text = text.replace(old_state, new_state, 1)

old_boundary = '''    if (scopePosition >= activeScope.endSeconds - tolerance) {\n      if (scopeIsPlaying) scopePause();\n      if (Math.abs(scopePosition - activeScope.endSeconds) > tolerance) {\n        scopeSeek(activeScope.endSeconds);\n      }\n    }\n  }, [activeScope, scopeIsPlaying, scopePause, scopePosition, scopeSeek]);\n\n  useEffect(() => {\n    if (!activeScope || !scopeIsPlaying) return;\n'''
new_boundary = '''    if (scopePosition >= activeScope.endSeconds - tolerance) {\n      if (scopeHasPlaybackIntent) scopePause();\n      if (Math.abs(scopePosition - activeScope.endSeconds) > tolerance) {\n        scopeSeek(activeScope.endSeconds);\n      }\n    }\n  }, [activeScope, scopeHasPlaybackIntent, scopePause, scopePosition, scopeSeek]);\n\n  useEffect(() => {\n    if (!activeScope || !scopeIsRendering) return;\n'''
if old_boundary not in text:
    raise SystemExit("Scoped playback boundary/timer block not found")
text = text.replace(old_boundary, new_boundary, 1)

old_timer_deps = '''  }, [activeScope, scopeIsPlaying, scopePause, scopePlaybackRate, scopePosition, scopeSeek]);\n'''
new_timer_deps = '''  }, [activeScope, scopeIsRendering, scopePause, scopePlaybackRate, scopePosition, scopeSeek]);\n'''
if old_timer_deps not in text:
    raise SystemExit("Scoped playback timer dependencies not found")
text = text.replace(old_timer_deps, new_timer_deps, 1)

if "scopeIsPlaying" in text:
    raise SystemExit("Legacy scoped timer state remains")
path.write_text(text)

test_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")
test = test_path.read_text()
anchor = '''  assert.match(companion, /rememberSectionBundleRequest\\(key, pending\\)/u);\n'''
replacement = '''  assert.match(companion, /rememberSectionBundleRequest\\(key, pending\\)/u);\n  assert.match(companion, /scopeHasPlaybackIntent = player\\.isPlaying/u);\n  assert.match(companion, /scopeIsRendering = player\\.phase === "playing"/u);\n  assert.match(companion, /if \\(!activeScope \\|\\| !scopeIsRendering\\) return;/u);\n  assert.doesNotMatch(companion, /scopeIsPlaying/u);\n'''
if anchor not in test:
    raise SystemExit("Scoped playback contract test anchor not found")
test = test.replace(anchor, replacement, 1)
test_path.write_text(test)

print("Separated scoped playback intent from actual rendering for end timer")
# trigger=1
