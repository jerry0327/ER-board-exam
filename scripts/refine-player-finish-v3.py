from pathlib import Path
import re

branch_marker = "Player finishing pass v3"

companion_path = Path("app/components/audio-section-companion.tsx")
provider_path = Path("app/components/audio-player-provider.tsx")
hook_path = Path("app/hooks/use-learning-audio.ts")
events_path = Path("app/lib/audio-player-section-events.ts")
css_path = Path("app/site.css")
contract_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")

companion = companion_path.read_text()
provider = provider_path.read_text()
hook = hook_path.read_text()
events = events_path.read_text()
css = css_path.read_text()
contract = contract_path.read_text()

# 1) Carry the exact clicked question-audio button through the event boundary.
if "QuestionAudioChoiceEventDetail" not in events:
    events = events.replace(
        "export type QuestionAudioChoiceRequest = {\n  sourceId: string;\n  questionId: string;\n};\n",
        "export type QuestionAudioChoiceRequest = {\n  sourceId: string;\n  questionId: string;\n};\n\nexport type QuestionAudioChoiceEventDetail = QuestionAudioChoiceRequest & {\n  trigger?: HTMLElement | null;\n};\n",
    )
    events = events.replace(
        "export function requestQuestionAudioChoice(request: QuestionAudioChoiceRequest) {\n  if (typeof window === \"undefined\") return;\n  window.dispatchEvent(new CustomEvent<QuestionAudioChoiceRequest>(QUESTION_AUDIO_CHOICE_EVENT, {\n    detail: request,\n  }));\n}",
        "export function requestQuestionAudioChoice(\n  request: QuestionAudioChoiceRequest,\n  trigger?: HTMLElement | null,\n) {\n  if (typeof window === \"undefined\") return;\n  const detail: QuestionAudioChoiceEventDetail = { ...request, trigger: trigger ?? null };\n  window.dispatchEvent(new CustomEvent<QuestionAudioChoiceEventDetail>(QUESTION_AUDIO_CHOICE_EVENT, {\n    detail,\n  }));\n}",
    )

events_path.write_text(events)

if "type MouseEvent" not in hook.split("\n", 4)[2]:
    hook = hook.replace(
        'import { useCallback, useEffect, useState } from "react";',
        'import { useCallback, useEffect, useState, type MouseEvent } from "react";',
    )

old_open = '''  const open = useCallback(() => {\n    if (!source) return;\n    prepare();\n    if (resource?.kind === "question" && resource.questionId) {\n      requestQuestionAudioChoice({ sourceId: source.id, questionId: resource.questionId });\n      return;\n    }\n    if (currentSourceId === source.id) openPlayer();\n    else void loadSource(source);\n  }, [currentSourceId, loadSource, openPlayer, prepare, resource, source]);'''
new_open = '''  const open = useCallback((event?: MouseEvent<HTMLElement>) => {\n    if (!source) return;\n    prepare();\n    if (resource?.kind === "question" && resource.questionId) {\n      const clickedTrigger = event?.currentTarget instanceof HTMLElement\n        ? event.currentTarget\n        : typeof document !== "undefined" && document.activeElement instanceof HTMLElement\n          ? document.activeElement\n          : null;\n      requestQuestionAudioChoice(\n        { sourceId: source.id, questionId: resource.questionId },\n        clickedTrigger,\n      );\n      return;\n    }\n    if (currentSourceId === source.id) openPlayer();\n    else void loadSource(source);\n  }, [currentSourceId, loadSource, openPlayer, prepare, resource, source]);'''
if old_open in hook:
    hook = hook.replace(old_open, new_open)
elif "clickedTrigger" not in hook:
    raise SystemExit("useLearningAudio open callback target not found")

hook_path.write_text(hook)

# Companion reads the explicit event trigger first, then falls back to activeElement.
companion = companion.replace(
    "  type QuestionAudioChoiceRequest,\n} from \"../lib/audio-player-section-events\";",
    "  type QuestionAudioChoiceEventDetail,\n  type QuestionAudioChoiceRequest,\n} from \"../lib/audio-player-section-events\";",
)
old_handle = '''    const handleChoice = (event: Event) => {\n      const request = (event as CustomEvent<QuestionAudioChoiceRequest>).detail;\n      if (!request?.sourceId || !request.questionId) return;\n      setChoiceError(null);\n      setLoadingChoice(false);\n      setSectionOpen(false);\n      const settings = document.querySelector<HTMLDetailsElement>(".audio-player-settings[open]");\n      if (settings) settings.open = false;\n      questionChoiceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n      setQuestionChoice(request);\n    };'''
new_handle = '''    const handleChoice = (event: Event) => {\n      const request = (event as CustomEvent<QuestionAudioChoiceEventDetail>).detail;\n      if (!request?.sourceId || !request.questionId) return;\n      setChoiceError(null);\n      setLoadingChoice(false);\n      setSectionOpen(false);\n      const settings = document.querySelector<HTMLDetailsElement>(".audio-player-settings[open]");\n      if (settings) settings.open = false;\n      questionChoiceTriggerRef.current = request.trigger instanceof HTMLElement\n        ? request.trigger\n        : document.activeElement instanceof HTMLElement\n          ? document.activeElement\n          : null;\n      setQuestionChoice({ sourceId: request.sourceId, questionId: request.questionId });\n    };'''
if old_handle in companion:
    companion = companion.replace(old_handle, new_handle)
elif "request.trigger instanceof HTMLElement" not in companion:
    raise SystemExit("question choice event handler target not found")

# Position the popover directly below and horizontally centered on the clicked button.
start = companion.find("    const positionMenu = () => {", companion.find("// The question audio menu stays anchored"))
end = companion.find("\n\n    const focusFrame = window.requestAnimationFrame", start)
if start < 0 or end < 0:
    if "--audio-question-caret-x" not in companion:
        raise SystemExit("question menu position function target not found")
else:
    companion = companion[:start] + '''    const positionMenu = () => {\n      const anchor = trigger.getBoundingClientRect();\n      const menuBox = menu.getBoundingClientRect();\n      const gutter = 8;\n      const gap = 8;\n      const maxLeft = Math.max(gutter, window.innerWidth - menuBox.width - gutter);\n      const preferredLeft = anchor.left + anchor.width / 2 - menuBox.width / 2;\n      const left = Math.min(maxLeft, Math.max(gutter, preferredLeft));\n      const top = anchor.bottom + gap;\n      const maxHeight = Math.max(88, window.innerHeight - top - gutter);\n      const caretX = Math.min(menuBox.width - 18, Math.max(18, anchor.left + anchor.width / 2 - left));\n      menu.style.left = `${Math.round(left)}px`;\n      menu.style.top = `${Math.round(top)}px`;\n      menu.style.maxHeight = `${Math.round(maxHeight)}px`;\n      menu.style.setProperty("--audio-question-caret-x", `${Math.round(caretX)}px`);\n    };''' + companion[end:]

old_focus = '''    const focusFrame = window.requestAnimationFrame(() => {\n      positionMenu();\n      menu.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();\n    });'''
new_focus = '''    const focusFrame = window.requestAnimationFrame(() => {\n      const anchor = trigger.getBoundingClientRect();\n      const roomBelow = window.innerHeight - anchor.bottom - 16;\n      if (roomBelow < Math.min(112, menu.scrollHeight + 8)) {\n        trigger.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });\n        window.requestAnimationFrame(positionMenu);\n      } else {\n        positionMenu();\n      }\n      menu.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();\n    });'''
if old_focus in companion:
    companion = companion.replace(old_focus, new_focus)
elif "roomBelow < Math.min(112" not in companion:
    raise SystemExit("question menu focus frame target not found")

# 2) Remove permanent chapter tick buttons from the progress bar. Section navigation remains in the Section picker.
marker_start = companion.find("        {markers.map((marker, index) => {")
marker_end = companion.find("        })}\n      </div>,", marker_start)
if marker_start >= 0 and marker_end >= 0:
    marker_end += len("        })}\n")
    companion = companion[:marker_start] + companion[marker_end:]
elif "className={`audio-section-node" in companion:
    raise SystemExit("timeline chapter marker block target not found")

# The progress layer is now decorative only; the native range remains the interaction surface.
companion = companion.replace(
    '<div className="audio-section-node-layer">\n        <span className="audio-section-track-base"',
    '<div className="audio-section-node-layer" aria-hidden="true">\n        <span className="audio-section-track-base"',
)
companion_path.write_text(companion)

# 3) Move permanent close off the expanded mobile surface and into Settings.
settings_insert_anchor = '''                      {queueOpen && (\n                        <section id="audio-player-queue-panel" className="audio-player-queue-panel" aria-label="待播內容">'''
# Insert after the queue block by using its stable closing tail.
queue_tail = '''                          {!continuousPlay && <small className="audio-player-queue-note">連續播放已關閉，本章播完後會停下。</small>}\n                        </section>\n                      )}\n                    </div>'''
settings_dismiss = '''                          {!continuousPlay && <small className="audio-player-queue-note">連續播放已關閉，本章播完後會停下。</small>}\n                        </section>\n                      )}\n                      <button\n                        type="button"\n                        className="audio-player-settings-dismiss"\n                        onClick={dismissPlayer}\n                      >\n                        <X aria-hidden="true" />\n                        <span>關閉播放器</span>\n                      </button>\n                    </div>'''
if queue_tail in provider:
    provider = provider.replace(queue_tail, settings_dismiss, 1)
elif "audio-player-settings-dismiss" not in provider:
    raise SystemExit("settings close insertion target not found")
provider_path.write_text(provider)

# 4) Final visual geometry. Keep desktop structure, use one symmetric 5-column rail on mobile.
finish_css = r'''

@layer site-utilities {
  /* Player finishing pass v3: quiet progress track, symmetric mobile controls, anchored question menu. */
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-runnable-track,
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-track,
  .audio-section-track-base,
  .audio-section-track-progress {
    height: 3px;
  }

  .audio-section-track-base {
    background: color-mix(in srgb, var(--site-line-strong) 34%, transparent);
  }

  .audio-section-track-progress {
    background: color-mix(in srgb, var(--site-primary) 88%, var(--site-ink));
  }

  .audio-section-playhead {
    border: 2px solid var(--site-reader-chrome);
    box-shadow: 0 1px 5px color-mix(in srgb, var(--site-primary) 20%, transparent);
    height: 10px;
    width: 10px;
  }

  .audio-player-timeline:focus-within .audio-section-playhead,
  .audio-player-timeline:hover .audio-section-playhead {
    height: 12px;
    width: 12px;
  }

  .audio-player-settings-dismiss {
    display: none;
  }

  .audio-question-choice.audio-question-choice-popover {
    background: var(--site-reader-chrome);
    border: 1px solid color-mix(in srgb, var(--site-line-strong) 66%, transparent);
    border-radius: var(--site-panel-radius);
    box-shadow: var(--site-shadow-low);
    max-width: calc(100vw - 16px);
    overflow: auto;
    padding: 6px;
    width: min(240px, calc(100vw - 16px));
  }

  .audio-question-choice.audio-question-choice-popover::before {
    background: var(--site-reader-chrome);
    border-left: 1px solid color-mix(in srgb, var(--site-line-strong) 66%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--site-line-strong) 66%, transparent);
    content: "";
    height: 8px;
    left: var(--audio-question-caret-x, 50%);
    pointer-events: none;
    position: absolute;
    top: -5px;
    transform: translateX(-50%) rotate(45deg);
    width: 8px;
  }

  @media (max-width: 600px) {
    .audio-player-controls {
      column-gap: 4px;
      display: grid;
      grid-template-areas: none;
      grid-template-columns: 44px 50px 56px 50px 44px;
      grid-template-rows: auto auto;
      justify-content: center;
      margin-top: 8px;
      row-gap: 8px;
      width: 100%;
    }

    .audio-player-transport {
      display: grid;
      gap: 4px;
      grid-column: 1 / -1;
      grid-row: 1;
      grid-template-columns: 44px 50px 56px 50px 44px;
      justify-content: center;
      justify-self: center;
    }

    .audio-player-transport > button {
      justify-self: center;
    }

    .audio-player-transport .audio-player-chapter-control {
      min-width: 44px;
      width: 44px;
    }

    .audio-player-transport .audio-player-skip {
      min-width: 50px;
      width: 50px;
    }

    .audio-player-transport .audio-player-main-toggle {
      height: 56px;
      min-width: 56px;
      width: 56px;
    }

    .audio-player-secondary-left,
    .audio-player-utilities {
      display: contents;
      width: auto;
    }

    .audio-player-rate {
      grid-column: 2;
      grid-row: 2;
      justify-self: center;
    }

    .audio-player-secondary-left .audio-player-reset {
      grid-column: 3;
      grid-row: 2;
      justify-self: center;
    }

    .audio-player-settings {
      grid-column: 4;
      grid-row: 2;
      justify-self: center;
    }

    .audio-player-close {
      display: none;
    }

    .audio-player-settings-dismiss {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: var(--site-radius);
      color: var(--site-danger);
      display: grid;
      font-family: var(--site-sans);
      font-size: 12px;
      font-weight: 680;
      gap: 8px;
      grid-template-columns: 22px minmax(0, 1fr);
      margin-top: 4px;
      min-height: 44px;
      padding: 5px 8px;
      text-align: left;
      width: 100%;
    }

    .audio-player-settings-dismiss:hover,
    .audio-player-settings-dismiss:focus-visible {
      background: color-mix(in srgb, var(--site-danger) 8%, transparent);
    }

    .audio-player-settings-dismiss svg {
      height: 17px;
      width: 17px;
    }

    .audio-question-choice.audio-question-choice-popover {
      border: 1px solid color-mix(in srgb, var(--site-line-strong) 66%, transparent);
      border-radius: var(--site-panel-radius);
      max-width: calc(100vw - 16px);
      padding: 6px;
      width: min(240px, calc(100vw - 16px));
    }
  }
}
'''
if branch_marker not in css:
    css += finish_css
css_path.write_text(css)

# 5) Focused contracts follow the new interaction model.
if "learningAudio" not in contract.split("const [", 1)[1].split("]", 1)[0]:
    contract = contract.replace(
        "const [companion, provider, events, css] = await Promise.all([",
        "const [companion, provider, events, css, learningAudio] = await Promise.all([",
    )
    contract = contract.replace(
        '  readFile(new URL("../app/site.css", import.meta.url), "utf8"),\n]);',
        '  readFile(new URL("../app/site.css", import.meta.url), "utf8"),\n  readFile(new URL("../app/hooks/use-learning-audio.ts", import.meta.url), "utf8"),\n]);',
    )

contract = contract.replace(
    '  assert.match(companion, /window\\.addEventListener\\("scroll", handleViewportChange, true\\)/u);\n  assert.match(companion, /questionChoiceTriggerRef\\.current\\?\\.focus\\(\\)/u);',
    '  assert.match(companion, /window\\.addEventListener\\("scroll", handleViewportChange, true\\)/u);\n  assert.match(events, /type QuestionAudioChoiceEventDetail/u);\n  assert.match(learningAudio, /event\\?\\.currentTarget instanceof HTMLElement/u);\n  assert.match(learningAudio, /requestQuestionAudioChoice\\([\\s\\S]*?clickedTrigger/u);\n  assert.match(companion, /request\\.trigger instanceof HTMLElement/u);\n  assert.match(companion, /preferredLeft = anchor\\.left \\+ anchor\\.width \\/ 2 - menuBox\\.width \\/ 2/u);\n  assert.match(companion, /const top = anchor\\.bottom \\+ gap/u);\n  assert.match(companion, /questionChoiceTriggerRef\\.current\\?\\.focus\\(\\)/u);',
)

old_tick_assertions = '''  assert.match(enhancement, /\\.audio-section-node\\s*\\{[\\s\\S]*?pointer-events: auto;/u);\n  assert.match(enhancement, /@media \\(pointer: coarse\\)[\\s\\S]*?\\.audio-section-node::before\\s*\\{[^}]*inset: -18px -21px;/u);'''
new_tick_assertions = '''  assert.doesNotMatch(companion, /className=\\{`audio-section-node/u);\n  assert.match(companion, /className="audio-section-node-layer" aria-hidden="true"/u);\n  assert.match(enhancement, /\\.audio-section-track-base,\\s*\\.audio-section-track-progress/u);'''
if old_tick_assertions in contract:
    contract = contract.replace(old_tick_assertions, new_tick_assertions)
elif "assert.doesNotMatch(companion, /className=\\{`audio-section-node" not in contract:
    raise SystemExit("timeline tick contract target not found")

extra_test_anchor = 'test("subtitle preference is durable and cue buttons expose a meaningful seek label", () => {'
extra_test = r'''test("mobile player uses one symmetric control rail and moves destructive close into Settings", () => {
  assert.match(css, /Player finishing pass v3/u);
  assert.match(css, /grid-template-columns:\s*44px 50px 56px 50px 44px;/u);
  assert.match(css, /\.audio-player-rate\s*\{[^}]*grid-column:\s*2;/u);
  assert.match(css, /\.audio-player-secondary-left \.audio-player-reset\s*\{[^}]*grid-column:\s*3;/u);
  assert.match(css, /\.audio-player-settings\s*\{[^}]*grid-column:\s*4;/u);
  assert.match(css, /\.audio-player-close\s*\{\s*display:\s*none;/u);
  assert.match(provider, /className="audio-player-settings-dismiss"[\s\S]*?<span>關閉播放器<\/span>/u);
});

test("expanded timeline is a clean progress surface without permanent chapter ticks", () => {
  assert.doesNotMatch(companion, /audio-section-node-tooltip/u);
  assert.doesNotMatch(companion, /className=\{`audio-section-node/u);
  assert.match(companion, /audio-section-track-base/u);
  assert.match(companion, /audio-section-track-progress/u);
  assert.match(companion, /audio-section-playhead/u);
});

'''
if extra_test.strip() not in contract:
    contract = contract.replace(extra_test_anchor, extra_test + extra_test_anchor, 1)

contract_path.write_text(contract)

print("Applied player finishing pass v3")
