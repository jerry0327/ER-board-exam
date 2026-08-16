from pathlib import Path
import re

companion_path = Path("app/components/audio-section-companion.tsx")
companion = companion_path.read_text()

old_fallback = '''  const number = questionNumber(questionId);\n  if (\n    number === null\n    || !Number.isInteger(source.questionStart)\n    || !Number.isInteger(source.questionEnd)\n    || number < Number(source.questionStart)\n    || number > Number(source.questionEnd)\n  ) return null;\n  return questions[number - Number(source.questionStart)] ?? null;\n'''
new_fallback = '''  const number = questionNumber(questionId);\n  if (\n    number === null\n    || !Number.isInteger(source.questionStart)\n    || !Number.isInteger(source.questionEnd)\n    || number < Number(source.questionStart)\n    || number > Number(source.questionEnd)\n  ) return null;\n  return questions.find((chapter) => questionNumber(chapter.title) === number) ?? null;\n'''
if old_fallback not in companion:
    raise SystemExit("Question fallback block not found")
companion = companion.replace(old_fallback, new_fallback, 1)

old_choice = '''      setChoiceError(null);\n      setLoadingChoice(false);\n      questionChoiceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n      setQuestionChoice(request);\n'''
new_choice = '''      setChoiceError(null);\n      setLoadingChoice(false);\n      setSectionOpen(false);\n      const settings = document.querySelector<HTMLDetailsElement>(".audio-player-settings[open]");\n      if (settings) settings.open = false;\n      questionChoiceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n      setQuestionChoice(request);\n'''
if old_choice not in companion:
    raise SystemExit("Question choice open block not found")
companion = companion.replace(old_choice, new_choice, 1)

old_title = '''            {activeScope && <strong title={currentTitle ?? undefined}>{currentTitle}</strong>}\n'''
new_title = '''            {currentTitle && <strong title={currentTitle}>{currentTitle}</strong>}\n'''
if old_title not in companion:
    raise SystemExit("Current Section title block not found")
companion = companion.replace(old_title, new_title, 1)
companion_path.write_text(companion)

provider_path = Path("app/components/audio-player-provider.tsx")
provider = provider_path.read_text()
old_summary = '<summary className="audio-player-utility" aria-label="播放設定" aria-haspopup="menu"><Settings aria-hidden="true" /></summary>'
new_summary = '<summary className="audio-player-utility" aria-label="播放設定"><Settings aria-hidden="true" /></summary>'
if old_summary not in provider:
    raise SystemExit("Settings summary block not found")
provider = provider.replace(old_summary, new_summary, 1)
provider_path.write_text(provider)

css_path = Path("app/site.css")
css = css_path.read_text()

old_current = '''  .audio-section-current {\n    min-width: 0;\n  }\n\n  .audio-section-current small,\n  .audio-section-current strong {\n    display: block;\n  }\n\n  .audio-section-current small {\n    color: var(--site-muted);\n    font-size: 12px;\n    line-height: 1.35;\n    margin: 0;\n  }\n\n  .audio-section-current strong {\n    color: var(--site-primary);\n    font-size: 14px;\n    font-weight: 720;\n    line-height: 1.35;\n    margin-top: 4px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n'''
new_current = '''  .audio-section-current {\n    align-items: baseline;\n    display: flex;\n    gap: 8px;\n    min-width: 0;\n  }\n\n  .audio-section-current small {\n    color: var(--site-muted);\n    flex: 0 0 auto;\n    font-size: 12px;\n    line-height: 1.35;\n    margin: 0;\n  }\n\n  .audio-section-current strong {\n    color: var(--site-primary);\n    display: block;\n    flex: 1 1 auto;\n    font-size: 14px;\n    font-weight: 720;\n    line-height: 1.35;\n    margin: 0;\n    min-width: 0;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n'''
if old_current not in css:
    raise SystemExit("Section current CSS block not found")
css = css.replace(old_current, new_current, 1)

old_mobile_util = '''    .audio-player-utilities {\n      display: grid;\n      gap: 8px;\n      grid-column: 2;\n      grid-template-columns: minmax(0, 1fr) 36px;\n      margin-left: 0;\n      order: 3;\n      width: 100%;\n    }\n'''
new_mobile_util = '''    .audio-player-utilities {\n      display: flex;\n      gap: 8px;\n      grid-column: 2;\n      justify-content: flex-end;\n      margin-left: 0;\n      order: 3;\n      width: 100%;\n    }\n'''
if old_mobile_util not in css:
    raise SystemExit("Mobile utilities CSS block not found")
css = css.replace(old_mobile_util, new_mobile_util, 1)

# Volume/fullscreen were reverted from product scope; remove all now-dead styling rules.
css = re.sub(r"(?ms)^\s*\.audio-player-volume[^\{]*\{[^{}]*\}\n?", "", css)
css = re.sub(r"(?ms)^\s*\.audio-player-fullscreen[^\{]*\{[^{}]*\}\n?", "", css)
if "audio-player-volume" in css or "audio-player-fullscreen" in css:
    raise SystemExit("Dead volume/fullscreen CSS remains")
css_path.write_text(css)

test_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")
test = test_path.read_text()
anchor = '''  assert.match(companion, /requestAnimationFrame\\(\\(\\) => setSectionOpen\\(false\\)\\)/u);\n});\n'''
replacement = '''  assert.match(companion, /requestAnimationFrame\\(\\(\\) => setSectionOpen\\(false\\)\\)/u);\n  assert.match(companion, /questions\\.find\\(\\(chapter\\) => questionNumber\\(chapter\\.title\\) === number\\)/u);\n  assert.match(companion, /\\{currentTitle && <strong title=\\{currentTitle\\}>\\{currentTitle\\}<\\/strong>\\}/u);\n});\n'''
if anchor not in test:
    raise SystemExit("Runtime contract test anchor not found")
test = test.replace(anchor, replacement, 1)
anchor2 = '''  assert.match(provider, /aria-pressed=\\{subtitlesEnabled\\}/u);\n  assert.match(companion, /aria-label=\\{`從 \\$\\{formatTime\\(siteSecondsFromSourceSeconds\\(cue\\.startSourceSeconds\\)\\)\\} 播放字幕：\\$\\{cue\\.text\\}`\\}/u);\n});\n'''
replacement2 = '''  assert.match(provider, /aria-pressed=\\{subtitlesEnabled\\}/u);\n  assert.match(companion, /aria-label=\\{`從 \\$\\{formatTime\\(siteSecondsFromSourceSeconds\\(cue\\.startSourceSeconds\\)\\)\\} 播放字幕：\\$\\{cue\\.text\\}`\\}/u);\n  assert.match(provider, /aria-label="快進 30 秒"/u);\n  assert.doesNotMatch(provider, /(?:Volume2|Maximize2|gainNodeRef|updateVolume)/u);\n});\n'''
if anchor2 not in test:
    raise SystemExit("Subtitle contract test anchor not found")
test = test.replace(anchor2, replacement2, 1)
anchor3 = '''  assert.match(consolidated, /\\.audio-subtitle-line\\s*\\{\\s*min-height: 44px;/u);\n});\n'''
replacement3 = '''  assert.match(consolidated, /\\.audio-subtitle-line\\s*\\{\\s*min-height: 44px;/u);\n  assert.doesNotMatch(consolidated, /audio-player-(?:volume|fullscreen)/u);\n  assert.match(consolidated, /@media \\(max-width: 600px\\)[\\s\\S]*?\\.audio-player-utilities \\{[\\s\\S]*?display: flex;[\\s\\S]*?justify-content: flex-end;/u);\n});\n'''
if anchor3 not in test:
    raise SystemExit("Presentation contract test anchor not found")
test = test.replace(anchor3, replacement3, 1)
test_path.write_text(test)

print("Applied final Section/player scope polish")
