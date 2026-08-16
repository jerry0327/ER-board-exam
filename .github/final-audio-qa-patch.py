from pathlib import Path
import re

BRANCH_MARKER = "/* Audio Player consolidated Section + subtitle presentation */"


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected text not found")
    return text.replace(old, new, 1)


def remove_layer_containing(source: str, marker: str) -> str:
    while marker in source:
        pos = source.index(marker)
        start = source.rfind("@layer ", 0, pos)
        if start < 0:
            raise SystemExit(f"layer start not found for {marker}")
        brace = source.find("{", start, pos)
        if brace < 0:
            raise SystemExit(f"layer brace not found for {marker}")
        depth = 0
        quote = None
        escape = False
        end = None
        for i in range(brace, len(source)):
            ch = source[i]
            if quote:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == quote:
                    quote = None
                continue
            if ch in ('"', "'"):
                quote = ch
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end is None:
            raise SystemExit(f"layer end not found for {marker}")
        while end < len(source) and source[end] in "\r\n":
            end += 1
        source = source[:start] + source[end:]
    return source


# ---------------------------------------------------------------------------
# Shared player event boundary
# ---------------------------------------------------------------------------
events_path = Path("app/lib/audio-player-section-events.ts")
events = events_path.read_text()
if "AUDIO_PLAYER_SETTINGS_OPEN_EVENT" not in events:
    events = require_replace(
        events,
        'export const QUESTION_AUDIO_CHOICE_EVENT = "em-board-question-audio-choice";\n',
        'export const QUESTION_AUDIO_CHOICE_EVENT = "em-board-question-audio-choice";\n'
        'export const AUDIO_PLAYER_SETTINGS_OPEN_EVENT = "em-board-audio-player-settings-open";\n',
        "settings event constant",
    )
events_path.write_text(events)


# ---------------------------------------------------------------------------
# Player provider: make Settings an accessible, mutually exclusive popover.
# ---------------------------------------------------------------------------
provider_path = Path("app/components/audio-player-provider.tsx")
provider = provider_path.read_text()
provider = require_replace(
    provider,
    'import { QUESTION_BANK_READY_ATTRIBUTE, QUESTION_BANK_READY_EVENT } from "../lib/app-readiness";\n',
    'import { QUESTION_BANK_READY_ATTRIBUTE, QUESTION_BANK_READY_EVENT } from "../lib/app-readiness";\n'
    'import { AUDIO_PLAYER_SETTINGS_OPEN_EVENT } from "../lib/audio-player-section-events";\n',
    "provider settings event import",
)
provider = require_replace(
    provider,
    '  const [randomNextId, setRandomNextId] = useState<string | null>(null);\n\n\n  useEffect(() => {\n',
    '  const [randomNextId, setRandomNextId] = useState<string | null>(null);\n'
    '  const settingsDetailsRef = useRef<HTMLDetailsElement | null>(null);\n\n\n  useEffect(() => {\n',
    "provider settings ref",
)
subtitle_effect = '''  useEffect(() => {
    try {
      setSubtitlesEnabledState(window.localStorage.getItem(SUBTITLE_PREFERENCE_KEY) === "true");
    } catch {
      // Subtitle preference is optional when storage is unavailable.
    }
  }, []);
'''
provider = require_replace(
    provider,
    subtitle_effect,
    subtitle_effect + '''

  useEffect(() => {
    const closeSettings = (restoreFocus: boolean) => {
      const details = settingsDetailsRef.current;
      if (!details?.open) return;
      details.open = false;
      if (restoreFocus) {
        window.requestAnimationFrame(() => details.querySelector<HTMLElement>("summary")?.focus());
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const details = settingsDetailsRef.current;
      const target = event.target;
      if (!details?.open || !(target instanceof Node) || details.contains(target)) return;
      closeSettings(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !settingsDetailsRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (expanded && !stowed) return;
    if (settingsDetailsRef.current) settingsDetailsRef.current.open = false;
  }, [expanded, stowed]);
''',
    "provider settings lifecycle",
)
provider = require_replace(
    provider,
    '<details className="audio-player-settings">\n                    <summary className="audio-player-utility" aria-label="播放設定"><Settings aria-hidden="true" /></summary>',
    '<details\n                    ref={settingsDetailsRef}\n                    className="audio-player-settings"\n                    onToggle={(event) => {\n                      if (event.currentTarget.open) window.dispatchEvent(new Event(AUDIO_PLAYER_SETTINGS_OPEN_EVENT));\n                    }}\n                  >\n                    <summary className="audio-player-utility" aria-label="播放設定" aria-haspopup="menu"><Settings aria-hidden="true" /></summary>',
    "provider settings details",
)
provider_path.write_text(provider)


# ---------------------------------------------------------------------------
# Section + subtitle companion: revision-safe data, popover semantics, focus.
# ---------------------------------------------------------------------------
companion_path = Path("app/components/audio-section-companion.tsx")
companion = companion_path.read_text()
companion = require_replace(
    companion,
    '  useMemo,\n  useState,\n} from "react";',
    '  useMemo,\n  useRef,\n  useState,\n} from "react";',
    "companion useRef import",
)
companion = require_replace(
    companion,
    'import {\n  QUESTION_AUDIO_CHOICE_EVENT,\n  type QuestionAudioChoiceRequest,\n} from "../lib/audio-player-section-events";',
    'import {\n  AUDIO_PLAYER_SETTINGS_OPEN_EVENT,\n  QUESTION_AUDIO_CHOICE_EVENT,\n  type QuestionAudioChoiceRequest,\n} from "../lib/audio-player-section-events";',
    "companion settings event import",
)
companion = require_replace(
    companion,
    'type LoadedSectionBundle = {\n  sourceId: string;\n  runtime: LoadedRuntimeSemanticAudioChapters;',
    'type LoadedSectionBundle = {\n  sourceId: string;\n  sourceRevision: string;\n  runtime: LoadedRuntimeSemanticAudioChapters;',
    "bundle revision type",
)
companion = require_replace(
    companion,
    'type QuestionPlaybackScope = {\n  sourceId: string;\n  questionId: string;',
    'type QuestionPlaybackScope = {\n  sourceId: string;\n  sourceRevision: string;\n  questionId: string;',
    "scope revision type",
)
companion = require_replace(
    companion,
    '    return { sourceId: source.id, runtime, locales };',
    '    return { sourceId: source.id, sourceRevision: source.revision, runtime, locales };',
    "bundle revision result",
)
companion = require_replace(
    companion,
    '    sourceId: source.id,\n    questionId,',
    '    sourceId: source.id,\n    sourceRevision: source.revision,\n    questionId,',
    "scope revision result",
)
companion = require_replace(
    companion,
    '  const activeBundle = bundle?.sourceId === currentSource?.id ? bundle : null;\n  const activeScope = scope?.sourceId === currentSource?.id ? scope : null;',
    '  const activeBundle = bundle?.sourceId === currentSource?.id && bundle.sourceRevision === currentSource.revision ? bundle : null;\n  const activeScope = scope?.sourceId === currentSource?.id && scope.sourceRevision === currentSource.revision ? scope : null;',
    "revision-safe active bundle",
)
companion = require_replace(
    companion,
    '  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);\n  const currentSource = player.current;',
    '  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);\n'
    '  const sectionToggleRef = useRef<HTMLButtonElement | null>(null);\n'
    '  const sectionPanelRef = useRef<HTMLElement | null>(null);\n'
    '  const questionDialogRef = useRef<HTMLElement | null>(null);\n'
    '  const questionChoiceTriggerRef = useRef<HTMLElement | null>(null);\n'
    '  const currentSource = player.current;',
    "interaction refs",
)
companion = require_replace(
    companion,
    '      setChoiceError(null);\n      setLoadingChoice(false);\n      setQuestionChoice(request);',
    '      setChoiceError(null);\n      setLoadingChoice(false);\n      questionChoiceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n      setQuestionChoice(request);',
    "question trigger capture",
)
old_question_effect = '''  useEffect(() => {
    if (!questionChoice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuestionChoice(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [questionChoice]);
'''
new_question_effect = '''  useEffect(() => {
    if (!questionChoice) return;
    const dialog = questionDialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFrame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setQuestionChoice(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => questionChoiceTriggerRef.current?.focus());
    };
  }, [questionChoice]);
'''
companion = require_replace(companion, old_question_effect, new_question_effect, "question dialog focus lifecycle")
# Close the Section list whenever the underlying audio identity changes.
companion = require_replace(
    companion,
    '  useEffect(() => {\n    if (!currentSource) {\n      setBundle(null);\n      setSectionOpen(false);',
    '  useEffect(() => {\n    setSectionOpen(false);\n    if (!currentSource) {\n      setBundle(null);',
    "section close on source change",
)
companion = require_replace(
    companion,
    '    if (scope && scope.sourceId !== currentSource.id) setScope(null);',
    '    if (scope && (scope.sourceId !== currentSource.id || scope.sourceRevision !== currentSource.revision)) setScope(null);',
    "scope revision reset",
)
# Settings and Section are mutually exclusive.
anchor = '''  useEffect(() => {
    const dock = document.querySelector<HTMLElement>(".audio-player-dock");
    if (!dock) return;
    dock.classList.toggle("has-audio-sections", Boolean(activeBundle));
    dock.classList.toggle("is-question-scope", Boolean(activeScope));
    return () => {
      dock.classList.remove("has-audio-sections", "is-question-scope");
    };
  }, [activeBundle, activeScope, sectionOpen]);
'''
companion = require_replace(
    companion,
    anchor,
    anchor + '''

  useEffect(() => {
    const handleSettingsOpen = () => setSectionOpen(false);
    window.addEventListener(AUDIO_PLAYER_SETTINGS_OPEN_EVENT, handleSettingsOpen);
    return () => window.removeEventListener(AUDIO_PLAYER_SETTINGS_OPEN_EVENT, handleSettingsOpen);
  }, []);

  useEffect(() => {
    if (!sectionOpen || !activeBundle) return;
    const panel = sectionPanelRef.current;
    const trigger = sectionToggleRef.current;
    if (!panel || !trigger) return;
    const focusFrame = window.requestAnimationFrame(() => {
      (panel.querySelector<HTMLElement>('[aria-current="true"]') ?? panel.querySelector<HTMLElement>("button"))?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panel.contains(target) || trigger.contains(target)) return;
      setSectionOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSectionOpen(false);
      window.requestAnimationFrame(() => trigger.focus());
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeBundle, sectionOpen]);
''',
    "section popover lifecycle",
)
companion = require_replace(
    companion,
    '''  function seekChapter(chapter: AudioChapterL1) {
    setScope(null);
    setSectionOpen(false);
    player.seek(playerSecondsForChapter(chapter));
  }
''',
    '''  function seekChapter(chapter: AudioChapterL1) {
    setScope(null);
    setSectionOpen(false);
    player.seek(playerSecondsForChapter(chapter));
    window.requestAnimationFrame(() => sectionToggleRef.current?.focus());
  }

  function toggleSectionPanel() {
    if (sectionOpen) {
      setSectionOpen(false);
      window.requestAnimationFrame(() => sectionToggleRef.current?.focus());
      return;
    }
    const settings = document.querySelector<HTMLDetailsElement>(".audio-player-settings[open]");
    if (settings) settings.open = false;
    setSectionOpen(true);
  }
''',
    "section toggle helpers",
)
companion = require_replace(
    companion,
    '                aria-current={isCurrent ? "true" : undefined}\n                onClick={() => seekSubtitleCue(cue)}',
    '                aria-current={isCurrent ? "true" : undefined}\n                aria-label={`從 ${formatTime(siteSecondsFromSourceSeconds(cue.startSourceSeconds))} 播放字幕：${cue.text}`}\n                onClick={() => seekSubtitleCue(cue)}',
    "subtitle cue label",
)
old_trigger = '''          <button type="button" className="audio-section-toggle" aria-expanded={sectionOpen} onClick={() => setSectionOpen((open) => !open)}>
            <span>段落</span><ChevronDown aria-hidden="true" />
          </button>'''
new_trigger = '''          <button
            ref={sectionToggleRef}
            type="button"
            className="audio-section-toggle"
            aria-expanded={sectionOpen}
            aria-haspopup="dialog"
            aria-controls="audio-player-section-panel"
            onClick={toggleSectionPanel}
          >
            <span>段落</span><ChevronDown aria-hidden="true" />
          </button>'''
companion = require_replace(companion, old_trigger, new_trigger, "section trigger semantics")
companion = require_replace(
    companion,
    '<section className="audio-section-panel audio-section-panel-floating" aria-label="音檔段落">\n        <header>\n          <span>段落</span>',
    '<section\n        ref={sectionPanelRef}\n        id="audio-player-section-panel"\n        className="audio-section-panel audio-section-panel-floating"\n        role="dialog"\n        aria-labelledby="audio-player-section-panel-title"\n      >\n        <header>\n          <span id="audio-player-section-panel-title">段落</span>',
    "section panel semantics",
)
companion = require_replace(
    companion,
    '          <section\n            className="audio-question-choice"\n            role="dialog"',
    '          <section\n            ref={questionDialogRef}\n            className="audio-question-choice"\n            role="dialog"',
    "question dialog ref",
)
companion_path.write_text(companion)


# ---------------------------------------------------------------------------
# CSS: remove all transitional player/companion layers and append one layer.
# ---------------------------------------------------------------------------
css_path = Path("app/site.css")
css = css_path.read_text()
for marker in (
    "/* Audio Section Companion */",
    "/* Audio Player final verified feature-layer styling */",
    "/* Audio Player final screenshot polish */",
    "/* Audio Player final input reset */",
    "/* Audio Player final companion finishing rules */",
    "/* Audio Player section-node primitives */",
    "/* Audio Player final runtime presentation */",
):
    css = remove_layer_containing(css, marker)

if BRANCH_MARKER in css:
    raise SystemExit("consolidated player marker already exists unexpectedly")

css = css.rstrip() + r'''

@layer site-features {
  /* Audio Player consolidated Section + subtitle presentation */
  .audio-player-dock {
    background: var(--site-paper);
    background-image: none;
    backdrop-filter: none;
    border: 1px solid var(--site-line);
    border-radius: 14px;
    box-shadow: var(--site-shadow-card);
    opacity: 1;
    overflow: visible;
  }

  .audio-player-dock.is-expanded {
    max-width: calc(100vw - 32px);
    width: min(640px, calc(100vw - 32px));
  }

  .audio-player-dock.is-collapsed {
    max-width: calc(100vw - 24px);
    width: min(330px, calc(100vw - 24px));
  }

  .audio-player-mark,
  .audio-player-stow {
    display: none;
  }

  .audio-player-dock.is-expanded .audio-player-mini {
    align-items: center;
    background: var(--site-paper);
    border: 0;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr) 36px;
    min-height: 52px;
    padding: 12px 16px 4px;
  }

  .audio-player-dock.is-expanded .audio-player-title {
    grid-column: 1;
    justify-self: stretch;
    max-width: none;
    min-width: 0;
    padding: 0;
    text-align: left;
    width: 100%;
  }

  .audio-player-dock.is-expanded .audio-player-title strong {
    display: block;
    font-size: 14px;
    font-weight: 720;
    line-height: 1.35;
    max-width: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .audio-player-dock.is-expanded .audio-player-title span,
  .audio-player-dock.is-expanded .audio-player-mini-time,
  .audio-player-dock.is-expanded .audio-player-mini-toggle,
  .audio-player-dock.is-expanded .audio-player-mini-close {
    display: none;
  }

  .audio-player-dock.is-expanded .audio-player-expand {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: var(--site-muted);
    display: inline-flex;
    grid-column: 2;
    height: 36px;
    justify-content: center;
    min-height: 36px;
    min-width: 36px;
    padding: 0;
    width: 36px;
  }

  .audio-player-details {
    background: var(--site-paper);
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: visible;
    padding: 0 16px 16px;
    position: relative;
  }

  .audio-section-companion {
    border: 0;
    margin: 0;
    order: -1;
    overflow: visible;
    padding: 0;
    position: relative;
  }

  .audio-section-summary {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 36px;
  }

  .audio-section-current {
    min-width: 0;
  }

  .audio-section-current small,
  .audio-section-current strong {
    display: block;
  }

  .audio-section-current small {
    color: var(--site-muted);
    font-size: 12px;
    line-height: 1.35;
    margin: 0;
  }

  .audio-section-current strong {
    color: var(--site-primary);
    font-size: 14px;
    font-weight: 720;
    line-height: 1.35;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-section-toggle {
    align-items: center;
    background: transparent;
    border: 1px solid var(--site-line);
    border-radius: 8px;
    color: var(--site-ink-soft);
    cursor: pointer;
    display: inline-flex;
    font-size: 14px;
    gap: 4px;
    min-height: 36px;
    padding: 0 8px;
  }

  .audio-section-toggle:hover {
    background: var(--site-surface-hover);
    border-color: color-mix(in srgb, var(--site-primary) 40%, var(--site-line));
  }

  .audio-section-toggle svg {
    height: 16px;
    transition: rotate 160ms var(--site-ease);
    width: 16px;
  }

  .audio-section-toggle[aria-expanded="true"] svg {
    rotate: 180deg;
  }

  .audio-section-panel {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 14px;
    box-shadow: var(--site-shadow-overlay);
    box-sizing: border-box;
    max-height: min(440px, calc(100vh - 32px));
    overflow: auto;
    overscroll-behavior: contain;
    padding: 8px;
  }

  .audio-section-panel header {
    align-items: center;
    color: var(--site-muted);
    display: flex;
    font-size: 12px;
    justify-content: space-between;
    min-height: 36px;
    padding: 0 8px;
  }

  .audio-section-list {
    display: grid;
    gap: 4px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .audio-section-list button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--site-ink);
    cursor: pointer;
    display: grid;
    font-size: 13px;
    gap: 8px;
    grid-template-columns: 12px minmax(0, 1fr) auto;
    min-height: 40px;
    padding: 4px 8px;
    text-align: left;
    width: 100%;
  }

  .audio-section-list button:hover {
    background: var(--site-surface-hover);
  }

  .audio-section-list button.is-current {
    background: color-mix(in srgb, var(--site-primary) 9%, var(--site-paper));
    color: var(--site-primary);
  }

  .audio-section-list-dot {
    background: var(--site-paper);
    border: 1px solid var(--site-line-strong);
    border-radius: 50%;
    height: 8px;
    width: 8px;
  }

  .audio-section-list button.is-current .audio-section-list-dot {
    background: var(--site-primary);
    border-color: var(--site-primary);
  }

  .audio-section-number,
  .audio-section-scope-badge {
    display: none;
  }

  .audio-section-list strong {
    font-size: 13px;
    font-weight: 690;
    line-height: 1.35;
    min-width: 0;
  }

  .audio-section-list time {
    color: var(--site-muted);
    font-family: var(--site-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .audio-player-dock > .audio-section-panel-floating {
    bottom: calc(100% + 8px);
    left: auto;
    margin: 0;
    position: absolute;
    right: 0;
    top: auto;
    width: min(320px, calc(100vw - 32px));
    z-index: 4;
  }

  .audio-player-timeline {
    height: 40px;
    isolation: isolate;
    overflow: visible;
    padding: 0;
    position: relative;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"] {
    appearance: none;
    background: transparent;
    border: 0;
    box-shadow: none;
    cursor: pointer;
    height: 18px;
    inset: 0 0 auto 0;
    margin: 0;
    padding: 0;
    position: absolute;
    width: 100%;
    z-index: 2;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-runnable-track,
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-track {
    background: transparent;
    border: 0;
    height: 2px;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    background: var(--site-primary);
    border: 0;
    border-radius: 50%;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--site-primary) 28%, transparent);
    height: 10px;
    margin-top: -4px;
    width: 10px;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-thumb {
    background: var(--site-primary);
    border: 0;
    border-radius: 50%;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--site-primary) 28%, transparent);
    height: 10px;
    width: 10px;
  }

  .audio-player-timeline > input[type="range"] + div {
    color: var(--site-muted);
    font-family: var(--site-mono);
    font-size: 12px;
    inset: 22px 0 auto 0;
    margin: 0;
    position: absolute;
    z-index: 1;
  }

  .audio-player-timeline > div.audio-section-node-layer {
    height: 18px;
    inset: 0 0 auto 0;
    margin: 0;
    pointer-events: none;
    position: absolute;
    z-index: 3;
  }

  .audio-section-track-base,
  .audio-section-track-progress {
    border-radius: 1px;
    height: 2px;
    left: 0;
    position: absolute;
    top: 8px;
  }

  .audio-section-track-base {
    background: color-mix(in srgb, var(--site-line-strong) 54%, var(--site-paper));
    right: 0;
  }

  .audio-section-track-progress {
    background: var(--site-primary);
  }

  .audio-section-node,
  .audio-section-node.is-current,
  .audio-section-node.is-past {
    background: color-mix(in srgb, var(--site-line-strong) 76%, var(--site-paper));
    border: 0;
    border-radius: 2px;
    box-shadow: none;
    height: 8px;
    padding: 0;
    pointer-events: auto;
    position: absolute;
    top: 5px;
    transform: translateX(-50%);
    width: 2px;
  }

  .audio-section-node::before {
    content: "";
    inset: -10px;
    position: absolute;
  }

  .audio-section-node.is-past {
    background: color-mix(in srgb, var(--site-primary) 64%, var(--site-paper));
  }

  .audio-section-node.is-current {
    background: var(--site-primary);
    height: 10px;
    top: 4px;
  }

  .audio-section-node:hover,
  .audio-section-node:focus-visible {
    background: var(--site-primary);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-primary) 9%, transparent);
    height: 12px;
    outline: 2px solid var(--site-info);
    outline-offset: 4px;
    top: 3px;
    width: 3px;
  }

  .audio-section-node-tooltip {
    background: var(--site-primary-fill-strong);
    border-radius: 8px;
    bottom: 14px;
    box-shadow: var(--site-shadow-card);
    color: var(--site-on-primary);
    display: grid;
    font-size: 12px;
    gap: 4px;
    left: 50%;
    max-width: 220px;
    min-width: 120px;
    opacity: 0;
    padding: 8px;
    pointer-events: none;
    position: absolute;
    transform: translate(-50%, 4px);
    transition: opacity 140ms var(--site-ease), transform 140ms var(--site-ease);
    visibility: hidden;
    white-space: normal;
    z-index: 7;
  }

  .audio-section-node-tooltip strong,
  .audio-section-node-tooltip time {
    font-size: 12px;
    line-height: 1.35;
  }

  .audio-section-node:hover .audio-section-node-tooltip,
  .audio-section-node:focus-visible .audio-section-node-tooltip {
    opacity: 1;
    transform: translate(-50%, 0);
    visibility: visible;
  }

  .audio-section-node.is-edge-start .audio-section-node-tooltip {
    left: -8px;
    transform: translate(0, 4px);
  }

  .audio-section-node.is-edge-start:hover .audio-section-node-tooltip,
  .audio-section-node.is-edge-start:focus-visible .audio-section-node-tooltip {
    transform: translate(0, 0);
  }

  .audio-section-node.is-edge-end .audio-section-node-tooltip {
    left: auto;
    right: -8px;
    transform: translate(0, 4px);
  }

  .audio-section-node.is-edge-end:hover .audio-section-node-tooltip,
  .audio-section-node.is-edge-end:focus-visible .audio-section-node-tooltip {
    transform: translate(0, 0);
  }

  .audio-player-dock.is-question-scope .audio-player-timeline > input:first-child,
  .audio-player-dock.is-question-scope .audio-player-timeline > input:first-child + div {
    display: none;
  }

  .audio-question-scope-timeline input {
    accent-color: var(--site-primary);
    cursor: pointer;
    display: block;
    height: 18px;
    inline-size: 100%;
    margin: 0;
  }

  .audio-question-scope-time {
    align-items: center;
    color: var(--site-muted);
    display: grid;
    font-family: var(--site-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    gap: 8px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    margin-top: 4px;
  }

  .audio-question-scope-time strong {
    color: var(--site-primary);
    font-family: var(--site-sans);
    font-size: 12px;
    font-weight: 760;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-player-controls {
    align-items: center;
    border-top: 0;
    display: flex;
    gap: 8px;
    padding: 4px 0 0;
  }

  .audio-player-transport {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    order: 1;
  }

  .audio-player-rate {
    flex: 0 0 auto;
    min-width: 64px;
    order: 2;
  }

  .audio-player-rate > span {
    display: none;
  }

  .audio-player-rate select {
    min-height: 36px;
    padding: 0 24px 0 8px;
  }

  .audio-player-transport :is(.audio-player-skip, .audio-player-chapter-control) {
    background: transparent;
    border: 0;
    border-radius: 50%;
    height: 36px;
    min-height: 36px;
    min-width: 36px;
    padding: 0;
    width: 36px;
  }

  .audio-player-main-toggle {
    border-radius: 50%;
    height: 44px;
    margin-inline: 4px;
    width: 44px;
  }

  .audio-player-utilities {
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    gap: 4px;
    justify-content: flex-end;
    margin-left: auto;
    min-width: 0;
    order: 3;
    position: relative;
  }

  .audio-player-volume {
    align-items: center;
    background: transparent;
    border: 0;
    box-shadow: none;
    color: var(--site-muted);
    display: flex;
    flex: 1 1 96px;
    gap: 8px;
    max-width: 120px;
    min-height: 0;
    min-width: 80px;
    outline: 0;
    padding: 0;
  }

  .audio-player-volume:focus-within {
    outline: 0;
  }

  .audio-player-volume svg {
    flex: 0 0 auto;
    height: 16px;
    width: 16px;
  }

  .audio-player-volume input[type="range"] {
    appearance: none;
    background: transparent;
    border: 0;
    box-shadow: none;
    height: 18px;
    margin: 0;
    min-width: 0;
    outline: 0;
    padding: 0;
    width: 100%;
  }

  .audio-player-volume input[type="range"]::-webkit-slider-runnable-track,
  .audio-player-volume input[type="range"]::-moz-range-track {
    background: color-mix(in srgb, var(--site-primary) 72%, var(--site-line));
    border-radius: 1px;
    height: 2px;
  }

  .audio-player-volume input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    background: var(--site-paper);
    border: 1px solid var(--site-primary);
    border-radius: 50%;
    height: 10px;
    margin-top: -4px;
    width: 10px;
  }

  .audio-player-volume input[type="range"]::-moz-range-thumb {
    background: var(--site-paper);
    border: 1px solid var(--site-primary);
    border-radius: 50%;
    height: 10px;
    width: 10px;
  }

  .audio-player-utility,
  .audio-player-settings > summary {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: var(--site-ink-soft);
    cursor: pointer;
    display: inline-flex;
    height: 36px;
    justify-content: center;
    list-style: none;
    min-height: 36px;
    min-width: 36px;
    padding: 0;
    width: 36px;
  }

  .audio-player-settings > summary::-webkit-details-marker {
    display: none;
  }

  .audio-player-settings {
    position: relative;
    z-index: 5;
  }

  .audio-player-settings-panel {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 14px;
    bottom: calc(100% + 8px);
    box-shadow: var(--site-shadow-overlay);
    padding: 8px;
    position: absolute;
    right: 0;
    width: 280px;
    z-index: 6;
  }

  .audio-player-settings-panel .audio-player-options {
    border: 0;
    display: grid;
    gap: 4px;
    overflow: visible;
    padding: 0;
  }

  .audio-player-settings-panel .audio-player-option {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--site-ink);
    display: grid;
    font-size: 14px;
    gap: 8px;
    grid-template-columns: 24px minmax(0, 1fr);
    justify-content: start;
    min-height: 40px;
    padding: 4px 8px;
    text-align: left;
    width: 100%;
  }

  .audio-player-settings-panel .audio-player-option:hover {
    background: var(--site-surface-hover);
  }

  .audio-player-settings-panel .audio-player-option span small {
    color: var(--site-muted);
    display: inline;
    font-size: 12px;
    margin-left: 8px;
  }

  .audio-player-settings-panel .audio-player-option-select select {
    font-size: 14px;
    min-height: 36px;
    width: 100%;
  }

  .audio-player-settings-actions {
    border-top: 1px solid var(--site-line);
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 8px;
    padding-top: 8px;
  }

  .audio-player-settings-actions button {
    background: transparent;
    border: 1px solid var(--site-line);
    border-radius: 8px;
    color: var(--site-ink-soft);
    font-size: 12px;
    min-height: 36px;
  }

  .audio-player-settings-panel .audio-player-queue-panel {
    background: var(--site-surface-muted);
    border: 0;
    border-radius: 8px;
    box-shadow: none;
    margin-top: 8px;
    max-height: 168px;
    overflow: auto;
    padding: 8px;
    position: static;
  }

  .audio-player-subtitle-option.is-active svg {
    color: var(--site-primary);
  }

  .audio-subtitle-float {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 14px;
    bottom: calc(100% + 8px);
    box-shadow: var(--site-shadow-overlay);
    box-sizing: border-box;
    left: 50%;
    max-width: calc(100vw - 24px);
    padding: 8px 12px;
    pointer-events: auto;
    position: absolute;
    transform: translateX(-50%);
    transition: opacity 160ms var(--site-ease), transform 160ms var(--site-ease);
    width: min(680px, calc(100vw - 24px));
    z-index: 2;
  }

  .audio-subtitle-lines {
    display: grid;
    gap: 4px;
  }

  .audio-subtitle-line {
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--site-ink-soft);
    cursor: pointer;
    display: block;
    font-family: var(--site-sans);
    font-size: 12px;
    line-height: 1.45;
    min-height: 32px;
    opacity: .72;
    overflow: hidden;
    padding: 4px 8px;
    text-align: center;
    text-overflow: ellipsis;
    transition: background-color 140ms var(--site-ease), color 140ms var(--site-ease), opacity 140ms var(--site-ease);
    white-space: nowrap;
    width: 100%;
  }

  .audio-subtitle-line.is-current {
    color: var(--site-ink);
    display: -webkit-box;
    font-size: 14px;
    font-weight: 720;
    line-height: 1.5;
    min-height: 40px;
    opacity: 1;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
  }

  .audio-subtitle-line:hover,
  .audio-subtitle-line:focus-visible {
    background: var(--site-surface-hover);
    color: var(--site-primary);
    opacity: 1;
  }

  .audio-subtitle-line.is-current:hover,
  .audio-subtitle-line.is-current:focus-visible {
    color: var(--site-ink);
  }

  .audio-player-dock:has(.audio-player-settings[open]) .audio-subtitle-float,
  .audio-player-dock:has(.audio-section-toggle[aria-expanded="true"]) .audio-subtitle-float {
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, 4px);
  }

  :is(
    .audio-section-toggle,
    .audio-section-list button,
    .audio-subtitle-line,
    .audio-player-utility,
    .audio-player-settings > summary,
    .audio-player-settings-actions button,
    .audio-question-choice-close,
    .audio-question-choice-option
  ):focus-visible {
    outline: 2px solid var(--site-info);
    outline-offset: 2px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini {
    align-items: center;
    background: var(--site-paper);
    display: grid;
    gap: 4px 8px;
    grid-template-columns: 40px minmax(0, 1fr) 36px;
    grid-template-rows: 32px 16px;
    min-height: 68px;
    padding: 8px 12px;
    position: relative;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-toggle {
    grid-column: 1;
    grid-row: 1 / 3;
    height: 40px;
    width: 40px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-title {
    display: block;
    grid-column: 2;
    grid-row: 1;
    max-width: none;
    min-width: 0;
    padding: 0;
    width: 100%;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-title strong {
    display: block;
    font-size: 12px;
    line-height: 1.3;
    max-width: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-title span {
    display: none;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-time {
    align-items: end;
    color: var(--site-muted);
    display: flex;
    font-family: var(--site-mono);
    font-size: 12px;
    grid-column: 2;
    grid-row: 2;
    justify-content: space-between;
    line-height: 1;
    width: 100%;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-time > span:nth-child(2) {
    display: none;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-expand {
    grid-column: 3;
    grid-row: 1 / 3;
    height: 36px;
    min-height: 36px;
    min-width: 36px;
    padding: 0;
    width: 36px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-edge-progress {
    background: color-mix(in srgb, var(--site-line-strong) 50%, var(--site-paper));
    border-radius: 1px;
    bottom: 24px;
    display: block;
    height: 1px;
    left: 60px;
    overflow: visible;
    position: absolute;
    right: 44px;
    top: auto;
    z-index: 1;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-edge-progress > span {
    background: var(--site-primary);
    border-radius: 1px;
    display: block;
    height: 2px;
    transform: translateY(-.5px);
  }

  .audio-question-choice-backdrop {
    align-items: center;
    background: var(--site-scrim);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 24px;
    position: fixed;
    z-index: var(--site-z-overlay);
  }

  .audio-question-choice {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 14px;
    box-shadow: var(--site-shadow-overlay);
    color: var(--site-ink);
    max-width: 360px;
    padding: 16px;
    width: 100%;
  }

  .audio-question-choice > header {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) 40px;
    margin-bottom: 12px;
  }

  .audio-question-choice > header > strong {
    font-family: var(--site-display);
    font-size: 18px;
    line-height: 1.35;
  }

  .audio-question-choice-close {
    align-items: center;
    background: transparent;
    border: 1px solid var(--site-line);
    border-radius: 50%;
    color: var(--site-ink);
    cursor: pointer;
    display: inline-flex;
    height: 40px;
    justify-content: center;
    min-height: 40px;
    min-width: 40px;
    width: 40px;
  }

  .audio-question-source {
    display: none;
  }

  .audio-question-choice-options {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .audio-question-choice-option {
    align-items: center;
    background: var(--site-surface-muted);
    border: 1px solid var(--site-line);
    border-radius: 8px;
    color: var(--site-ink);
    cursor: pointer;
    display: flex;
    font-size: 14px;
    font-weight: 720;
    justify-content: center;
    min-height: 44px;
    padding: 0 12px;
    text-align: center;
    width: 100%;
  }

  .audio-question-choice-option:first-child {
    background: var(--site-primary-fill);
    border-color: var(--site-primary-fill);
    color: var(--site-on-primary);
  }

  .audio-question-choice-option:hover {
    background: var(--site-surface-hover);
  }

  .audio-question-choice-option:first-child:hover {
    background: var(--site-primary-fill-strong);
    border-color: var(--site-primary-fill-strong);
  }

  .audio-question-choice-option:disabled {
    cursor: wait;
    opacity: .58;
  }

  .audio-question-choice-error {
    color: var(--site-danger);
    font-size: 12px;
    line-height: 1.5;
    margin: 8px 0 0;
  }

  @media (max-width: 600px) {
    .audio-player-dock.is-expanded {
      max-width: calc(100vw - 24px);
      width: calc(100vw - 24px);
    }

    .audio-player-dock.is-expanded .audio-player-mini {
      grid-template-columns: minmax(0, 1fr) 36px;
      min-height: 48px;
      padding: 8px 12px 4px;
    }

    .audio-player-dock.is-expanded .audio-player-title strong {
      font-size: 13px;
    }

    .audio-player-details {
      gap: 8px;
      padding: 0 12px 12px;
    }

    .audio-section-summary {
      min-height: 36px;
    }

    .audio-section-toggle span {
      display: none;
    }

    .audio-player-dock > .audio-section-panel-floating {
      bottom: calc(100% + 8px);
      left: 0;
      max-height: min(52vh, 440px);
      right: 0;
      width: 100%;
    }

    .audio-player-controls {
      display: grid;
      gap: 8px;
      grid-template-columns: auto minmax(0, 1fr);
    }

    .audio-player-transport {
      grid-column: 1 / -1;
      justify-content: space-around;
      order: 1;
      width: 100%;
    }

    .audio-player-rate {
      grid-column: 1;
      order: 2;
    }

    .audio-player-utilities {
      display: grid;
      gap: 8px;
      grid-column: 2;
      grid-template-columns: minmax(0, 1fr) 36px;
      margin-left: 0;
      order: 3;
      width: 100%;
    }

    .audio-player-volume {
      max-width: none;
      min-width: 0;
      width: 100%;
    }

    .audio-player-fullscreen {
      display: none;
    }

    .audio-player-settings-panel {
      right: 0;
      width: min(280px, calc(100vw - 32px));
    }

    .audio-subtitle-float {
      border-radius: 10px;
      bottom: calc(100% + 8px);
      padding: 8px;
      width: calc(100vw - 24px);
    }

    .audio-subtitle-line.is-previous {
      display: none;
    }

    .audio-question-choice-backdrop {
      align-items: flex-end;
      padding: 0;
    }

    .audio-question-choice {
      border-bottom: 0;
      border-left: 0;
      border-radius: 14px 14px 0 0;
      border-right: 0;
      max-width: none;
      padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    }
  }

  @media (pointer: coarse) {
    .audio-player-dock.is-expanded .audio-player-expand,
    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-toggle,
    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-expand,
    .audio-section-toggle,
    .audio-section-list button,
    .audio-player-transport :is(.audio-player-skip, .audio-player-chapter-control),
    .audio-player-main-toggle,
    .audio-player-utility,
    .audio-player-settings > summary,
    .audio-player-settings-panel .audio-player-option,
    .audio-player-settings-panel .audio-player-option-select select,
    .audio-player-settings-actions button,
    .audio-question-choice-close,
    .audio-question-choice-option {
      min-height: 44px;
    }

    .audio-player-dock.is-expanded .audio-player-expand,
    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-toggle,
    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-expand,
    .audio-player-transport :is(.audio-player-skip, .audio-player-chapter-control),
    .audio-player-main-toggle,
    .audio-player-utility,
    .audio-player-settings > summary,
    .audio-question-choice-close {
      min-width: 44px;
      width: 44px;
    }

    .audio-player-volume input[type="range"] {
      height: 44px;
    }

    .audio-player-timeline {
      height: 64px;
    }

    .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"] {
      height: 44px;
    }

    .audio-player-timeline > input[type="range"] + div {
      inset: 48px 0 auto 0;
    }

    .audio-player-timeline > div.audio-section-node-layer {
      height: 44px;
    }

    .audio-section-track-base,
    .audio-section-track-progress {
      top: 21px;
    }

    .audio-section-node,
    .audio-section-node.is-current,
    .audio-section-node.is-past {
      pointer-events: none;
      top: 18px;
    }

    .audio-section-node.is-current {
      top: 17px;
    }

    .audio-subtitle-line {
      min-height: 44px;
    }

    .audio-question-scope-timeline input {
      height: 44px;
    }
  }
}
'''

css_path.write_text(css)


# ---------------------------------------------------------------------------
# Permanent regression contract for the interaction and presentation boundary.
# ---------------------------------------------------------------------------
test_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")
test_path.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [companion, provider, events, css] = await Promise.all([
  readFile(new URL("../app/components/audio-section-companion.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/audio-player-section-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
]);

const marker = "/* Audio Player consolidated Section + subtitle presentation */";
const markerIndex = css.indexOf(marker);
assert.ok(markerIndex >= 0, "consolidated player CSS marker must exist");
const consolidatedStart = css.lastIndexOf("@layer site-features", markerIndex);
const consolidated = css.slice(consolidatedStart);

test("Section and subtitle runtime stays revision-safe and shares player-time seek helpers", () => {
  assert.match(companion, /sourceRevision: string;/u);
  assert.match(companion, /bundle\.sourceRevision === currentSource\.revision/u);
  assert.match(companion, /scope\.sourceRevision === currentSource\.revision/u);
  assert.match(companion, /currentSubtitleCueAt\(activeBundle\.runtime\.subtitle, player\.position\)/u);
  assert.match(companion, /siteSecondsFromSourceSeconds\(cue\.startSourceSeconds\)/u);
  assert.match(companion, /playerSecondsForChapter\(chapter\)/u);
  assert.match(companion, /setSectionOpen\(false\);\s*if \(!currentSource\)/u);
});

test("Section popover has explicit ownership, dismissal, focus return, and Settings exclusion", () => {
  assert.match(companion, /aria-haspopup="dialog"/u);
  assert.match(companion, /aria-controls="audio-player-section-panel"/u);
  assert.match(companion, /id="audio-player-section-panel"/u);
  assert.match(companion, /role="dialog"/u);
  assert.match(companion, /document\.addEventListener\("pointerdown", handlePointerDown\)/u);
  assert.match(companion, /event\.key !== "Escape"/u);
  assert.match(companion, /window\.requestAnimationFrame\(\(\) => trigger\.focus\(\)\)/u);
  assert.match(companion, /AUDIO_PLAYER_SETTINGS_OPEN_EVENT/u);
  assert.match(companion, /document\.querySelector<HTMLDetailsElement>\("\.audio-player-settings\[open\]"\)/u);
  assert.match(events, /AUDIO_PLAYER_SETTINGS_OPEN_EVENT = "em-board-audio-player-settings-open"/u);
  assert.match(provider, /window\.dispatchEvent\(new Event\(AUDIO_PLAYER_SETTINGS_OPEN_EVENT\)\)/u);
});

test("Settings and question-choice overlays support keyboard dismissal and focus lifecycle", () => {
  assert.match(provider, /settingsDetailsRef/u);
  assert.match(provider, /details\.open = false/u);
  assert.match(provider, /event\.key !== "Escape"/u);
  assert.match(provider, /document\.addEventListener\("pointerdown", handlePointerDown\)/u);
  assert.match(companion, /document\.body\.style\.overflow = "hidden"/u);
  assert.match(companion, /event\.key !== "Tab"/u);
  assert.match(companion, /questionChoiceTriggerRef\.current\?\.focus\(\)/u);
  assert.match(companion, /ref=\{questionDialogRef\}/u);
});

test("subtitle preference is durable and cue buttons expose a meaningful seek label", () => {
  assert.match(provider, /SUBTITLE_PREFERENCE_KEY = "em-board-audio-subtitles-v1"/u);
  assert.match(provider, /localStorage\.getItem\(SUBTITLE_PREFERENCE_KEY\) === "true"/u);
  assert.match(provider, /localStorage\.setItem\(SUBTITLE_PREFERENCE_KEY, enabled \? "true" : "false"\)/u);
  assert.match(provider, /aria-pressed=\{subtitlesEnabled\}/u);
  assert.match(companion, /aria-label=\{`從 \$\{formatTime\(siteSecondsFromSourceSeconds\(cue\.startSourceSeconds\)\)\} 播放字幕：\$\{cue\.text\}`\}/u);
});

test("player presentation is one feature layer and follows the player design contract", () => {
  assert.equal((css.match(/Audio Player consolidated Section \+ subtitle presentation/gu) ?? []).length, 1);
  for (const oldMarker of [
    "Audio Section Companion",
    "Audio Player final verified feature-layer styling",
    "Audio Player final screenshot polish",
    "Audio Player final input reset",
    "Audio Player final companion finishing rules",
    "Audio Player section-node primitives",
    "Audio Player final runtime presentation",
  ]) assert.doesNotMatch(css, new RegExp(oldMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(consolidated, /!important/u);
  assert.doesNotMatch(consolidated, /(?:min|max)-width:\s*(?:700|701|1200)px/u);
  const fontSizes = [...consolidated.matchAll(/font-size:\s*(\d+)px/gu)].map((match) => Number(match[1]));
  assert.ok(fontSizes.length > 0 && fontSizes.every((size) => size >= 12), `sub-12px player text found: ${fontSizes.filter((size) => size < 12).join(",")}`);
  assert.match(consolidated, /@media \(max-width: 600px\)/u);
  assert.match(consolidated, /@media \(pointer: coarse\)/u);
  assert.match(consolidated, /\.audio-section-node,[\s\S]*?pointer-events: none;/u);
  assert.match(consolidated, /\.audio-subtitle-line\s*\{\s*min-height: 44px;/u);
});
''')

print("Final audio QA patch applied")
