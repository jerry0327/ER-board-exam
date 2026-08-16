from pathlib import Path

provider = Path('app/components/audio-player-provider.tsx')
text = provider.read_text()

if '  Captions,\n' not in text:
    text = text.replace('import {\n  ChevronDown,', 'import {\n  Captions,\n  ChevronDown,', 1)

if 'const SUBTITLE_PREFERENCE_KEY' not in text:
    text = text.replace(
        'const LISTENING_HISTORY_STORAGE_KEY = "em-board-audio-listening-history-v1";\n',
        'const LISTENING_HISTORY_STORAGE_KEY = "em-board-audio-listening-history-v1";\nconst SUBTITLE_PREFERENCE_KEY = "em-board-audio-subtitles-v1";\n',
        1,
    )

context_anchor = '  stowed: boolean;\n  queueOpen: boolean;\n};'
if 'subtitlesEnabled: boolean;' not in text:
    if context_anchor not in text:
        raise SystemExit('context type anchor not found')
    text = text.replace(
        context_anchor,
        '  stowed: boolean;\n  queueOpen: boolean;\n  subtitlesEnabled: boolean;\n  setSubtitlesEnabled: (enabled: boolean) => void;\n};',
        1,
    )

state_anchor = '  const [playbackRate, setPlaybackRateState] = useState(1);\n  const [volume, setVolumeState] = useState(1);'
if 'setSubtitlesEnabledState' not in text:
    if state_anchor not in text:
        raise SystemExit('subtitle state anchor not found')
    text = text.replace(
        state_anchor,
        '  const [playbackRate, setPlaybackRateState] = useState(1);\n  const [volume, setVolumeState] = useState(1);\n  const [subtitlesEnabled, setSubtitlesEnabledState] = useState(false);',
        1,
    )

preference_effect = '''\n  useEffect(() => {\n    try {\n      setSubtitlesEnabledState(window.localStorage.getItem(SUBTITLE_PREFERENCE_KEY) === "true");\n    } catch {\n      // Subtitle preference is optional when storage is unavailable.\n    }\n  }, []);\n'''
ref_anchor = '  const currentRef = useRef<AudioSummarySource | null>(null);'
if 'Subtitle preference is optional when storage is unavailable.' not in text:
    if ref_anchor not in text:
        raise SystemExit('subtitle preference effect anchor not found')
    text = text.replace(ref_anchor, preference_effect + '\n' + ref_anchor, 1)

updater = '''\n  function updateSubtitlesEnabled(enabled: boolean) {\n    setSubtitlesEnabledState(enabled);\n    try {\n      window.localStorage.setItem(SUBTITLE_PREFERENCE_KEY, enabled ? "true" : "false");\n    } catch {\n      // Keep the in-memory preference when storage is unavailable.\n    }\n  }\n\n'''
queued_anchor = '  const queuedSources = queueIds\n'
if 'function updateSubtitlesEnabled' not in text:
    if queued_anchor not in text:
        raise SystemExit('subtitle updater anchor not found')
    text = text.replace(queued_anchor, updater + queued_anchor, 1)

value_anchor = '    stowed,\n    queueOpen,\n  };'
if '    subtitlesEnabled,\n    setSubtitlesEnabled: updateSubtitlesEnabled,' not in text:
    if value_anchor not in text:
        raise SystemExit('context value anchor not found')
    text = text.replace(
        value_anchor,
        '    stowed,\n    queueOpen,\n    subtitlesEnabled,\n    setSubtitlesEnabled: updateSubtitlesEnabled,\n  };',
        1,
    )

settings_anchor = '''                        <button type="button" className={`audio-player-option ${continuousPlay ? "is-active" : ""}`.trim()} aria-pressed={continuousPlay} onClick={() => updateContinuousPlay(!continuousPlay)}>\n                          <Repeat2 aria-hidden="true" /><span><strong>連續播放</strong><small>{continuousPlay ? "開" : "關"}</small></span>\n                        </button>'''
subtitle_button = '''                        <button type="button" className={`audio-player-option audio-player-subtitle-option ${subtitlesEnabled ? "is-active" : ""}`.trim()} aria-pressed={subtitlesEnabled} onClick={() => updateSubtitlesEnabled(!subtitlesEnabled)}>\n                          <Captions aria-hidden="true" /><span><strong>字幕</strong><small>{subtitlesEnabled ? "開" : "關"}</small></span>\n                        </button>\n'''
if 'audio-player-subtitle-option' not in text:
    if settings_anchor not in text:
        raise SystemExit('settings subtitle anchor not found')
    text = text.replace(settings_anchor, subtitle_button + settings_anchor, 1)

provider.write_text(text)

companion = Path('app/components/audio-section-companion.tsx')
text = companion.read_text()

if '  currentSubtitleCueAt,\n' not in text:
    text = text.replace(
        '  currentAudioChapterAt,\n  level1AudioChapterMarkers,',
        '  currentAudioChapterAt,\n  currentSubtitleCueAt,\n  level1AudioChapterMarkers,',
        1,
    )
if '  type SubtitleCue,\n' not in text:
    text = text.replace(
        '  type AudioChapterL1,\n} from "../lib/audio-chapters";',
        '  type AudioChapterL1,\n  type SubtitleCue,\n} from "../lib/audio-chapters";',
        1,
    )
if 'siteSecondsFromSourceSeconds' not in text:
    text = text.replace(
        'import type { LoadedRuntimeSemanticAudioChapters } from "../lib/audio-runtime-semantic-package";\n',
        'import type { LoadedRuntimeSemanticAudioChapters } from "../lib/audio-runtime-semantic-package";\nimport { siteSecondsFromSourceSeconds } from "../lib/audio-playback";\n',
        1,
    )

state_anchor = '  const [timelineTarget, setTimelineTarget] = useState<HTMLElement | null>(null);\n'
if 'dockTarget' not in text:
    if state_anchor not in text:
        raise SystemExit('dock target state anchor not found')
    text = text.replace(state_anchor, state_anchor + '  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);\n', 1)

dock_effect = '''\n  useEffect(() => {\n    if (player.stowed || !currentSource) {\n      setDockTarget(null);\n      return;\n    }\n    let frame = window.requestAnimationFrame(() => {\n      frame = 0;\n      setDockTarget(document.querySelector<HTMLElement>(".audio-player-dock"));\n    });\n    return () => {\n      if (frame) window.cancelAnimationFrame(frame);\n    };\n  }, [currentSource, player.stowed]);\n'''
details_effect_anchor = '  useEffect(() => {\n    if (!player.expanded || player.stowed || !currentSource) {'
if 'setDockTarget(document.querySelector<HTMLElement>(".audio-player-dock"))' not in text:
    if details_effect_anchor not in text:
        raise SystemExit('dock effect insertion anchor not found')
    text = text.replace(details_effect_anchor, dock_effect + '\n' + details_effect_anchor, 1)

current_title_anchor = '''  const currentTitle = activeScope?.title\n    ?? (activeBundle && currentChapter ? sectionLabel(activeBundle, currentChapter) : null);\n'''
subtitle_state = '''  const currentSubtitleCue = activeBundle && player.subtitlesEnabled\n    ? currentSubtitleCueAt(activeBundle.runtime.subtitle, player.position)\n    : null;\n  const subtitleCueIndex = currentSubtitleCue ? currentSubtitleCue.index - 1 : -1;\n  const subtitleWindow = activeBundle && subtitleCueIndex >= 0\n    ? activeBundle.runtime.subtitle.cues.slice(\n      Math.max(0, subtitleCueIndex - 1),\n      Math.min(activeBundle.runtime.subtitle.cues.length, subtitleCueIndex + 2),\n    )\n    : [];\n'''
if 'const currentSubtitleCue =' not in text:
    if current_title_anchor not in text:
        raise SystemExit('current subtitle state anchor not found')
    text = text.replace(current_title_anchor, current_title_anchor + subtitle_state, 1)

seek_anchor = '  function seekChapter(chapter: AudioChapterL1) {\n'
seek_cue = '''  function seekSubtitleCue(cue: SubtitleCue) {\n    setScope(null);\n    player.seek(siteSecondsFromSourceSeconds(cue.startSourceSeconds));\n  }\n\n'''
if 'function seekSubtitleCue' not in text:
    if seek_anchor not in text:
        raise SystemExit('subtitle seek anchor not found')
    text = text.replace(seek_anchor, seek_cue + seek_anchor, 1)

section_portal_anchor = '  const sectionPortal = activeBundle && detailsTarget\n'
subtitle_portal = '''  const subtitlePortal = player.subtitlesEnabled && activeBundle && dockTarget && currentSubtitleCue\n    ? createPortal(\n      <aside className="audio-subtitle-float" aria-label="同步字幕">\n        <div className="audio-subtitle-lines">\n          {subtitleWindow.map((cue) => {\n            const isCurrent = cue.index === currentSubtitleCue.index;\n            return (\n              <button\n                key={cue.index}\n                type="button"\n                className={`audio-subtitle-line ${isCurrent ? "is-current" : cue.index < currentSubtitleCue.index ? "is-previous" : "is-next"}`}\n                aria-current={isCurrent ? "true" : undefined}\n                onClick={() => seekSubtitleCue(cue)}\n              >\n                <span>{cue.text}</span>\n              </button>\n            );\n          })}\n        </div>\n        <span className="sr-only" aria-live="polite">{currentSubtitleCue.text}</span>\n      </aside>,\n      dockTarget,\n    )\n    : null;\n\n'''
if 'const subtitlePortal =' not in text:
    if section_portal_anchor not in text:
        raise SystemExit('subtitle portal anchor not found')
    text = text.replace(section_portal_anchor, subtitle_portal + section_portal_anchor, 1)

return_anchor = '    <>\n      {sectionPortal}\n'
if '{subtitlePortal}' not in text:
    if return_anchor not in text:
        raise SystemExit('subtitle return anchor not found')
    text = text.replace(return_anchor, '    <>\n      {subtitlePortal}\n      {sectionPortal}\n', 1)

companion.write_text(text)

css = Path('app/site.css')
css_text = css.read_text()
marker = '/* Audio Player synchronized subtitle + final geometry */'
if marker not in css_text:
    css_text += r'''

@layer site-features {
  /* Audio Player synchronized subtitle + final geometry */
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"] {
    block-size: 18px !important;
    height: 18px !important;
    max-block-size: 18px !important;
    max-height: 18px !important;
    min-block-size: 18px !important;
    min-height: 18px !important;
  }
  .audio-player-timeline > input[type="range"] + div {
    inset: 22px 0 auto 0;
    margin: 0;
    position: absolute;
    z-index: 2;
  }
  .audio-player-timeline > div.audio-section-node-layer {
    height: 18px;
    inset: 0 0 auto 0;
    margin: 0;
    position: absolute;
    z-index: 9;
  }

  .audio-section-node,
  .audio-section-node.is-current,
  .audio-section-node.is-past {
    background: color-mix(in srgb, var(--site-line-strong) 76%, var(--site-paper));
    border: 0;
    border-radius: 2px;
    box-shadow: none;
    height: 8px;
    top: 5px;
    transform: translateX(-50%);
    width: 2px;
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
    border: 0;
    border-radius: 2px;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-primary) 9%, transparent);
    height: 12px;
    top: 3px;
    transform: translateX(-50%);
    width: 3px;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    background: var(--site-primary);
    border: 2px solid var(--site-paper);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--site-primary), 0 2px 7px color-mix(in srgb, var(--site-primary) 24%, transparent);
    height: 11px;
    margin-top: -4.5px;
    width: 11px;
  }
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-thumb {
    background: var(--site-primary);
    border: 2px solid var(--site-paper);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--site-primary), 0 2px 7px color-mix(in srgb, var(--site-primary) 24%, transparent);
    height: 11px;
    width: 11px;
  }

  .audio-player-dock.is-expanded,
  .audio-player-details,
  .audio-section-companion {
    overflow: visible;
  }
  .audio-section-companion {
    position: relative;
  }
  .audio-section-panel {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 11px;
    box-shadow: 0 18px 46px color-mix(in srgb, var(--site-ink) 18%, transparent);
    bottom: calc(100% + 58px);
    left: auto;
    margin: 0;
    max-height: min(390px, calc(100vh - 32px));
    overflow: auto;
    position: absolute;
    right: 0;
    top: auto;
    width: min(290px, calc(100vw - 32px));
    z-index: 120;
  }
  @media (min-width: 1200px) {
    .audio-section-panel {
      bottom: auto;
      left: calc(100% + 12px);
      right: auto;
      top: 0;
      width: 264px;
    }
  }
  @media (min-width: 701px) {
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) {
      min-height: 0;
      width: min(640px, calc(100vw - 28px));
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-details {
      min-height: 0;
      padding-right: 14px;
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-controls {
      margin-top: 0;
    }
  }
  @media (max-width: 700px) {
    .audio-section-panel {
      bottom: calc(100% + 54px);
      left: 0;
      max-height: min(44vh, 330px);
      right: 0;
      top: auto;
      width: 100%;
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-timeline {
      display: block;
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-controls {
      display: grid;
    }
  }

  .audio-subtitle-float {
    background: var(--site-paper);
    border: 1px solid color-mix(in srgb, var(--site-line-strong) 60%, var(--site-paper));
    border-radius: 12px;
    bottom: calc(100% + 10px);
    box-shadow: 0 16px 42px color-mix(in srgb, var(--site-ink) 17%, transparent);
    left: 50%;
    max-width: calc(100vw - 24px);
    padding: 7px 12px 8px;
    pointer-events: auto;
    position: absolute;
    transform: translateX(-50%);
    transition: opacity 150ms var(--site-ease), transform 180ms var(--site-ease);
    width: min(680px, calc(100vw - 24px));
    z-index: 112;
  }
  .audio-subtitle-lines {
    display: grid;
    gap: 1px;
  }
  .audio-subtitle-line {
    background: transparent;
    border: 0;
    color: var(--site-muted);
    cursor: pointer;
    display: block;
    font-family: var(--site-sans);
    font-size: 11px;
    line-height: 1.42;
    min-height: 0;
    opacity: .58;
    overflow: hidden;
    padding: 2px 8px;
    text-align: center;
    text-overflow: ellipsis;
    transition: color 140ms var(--site-ease), opacity 140ms var(--site-ease), transform 140ms var(--site-ease);
    white-space: nowrap;
    width: 100%;
  }
  .audio-subtitle-line.is-current {
    color: var(--site-ink);
    display: -webkit-box;
    font-size: 14px;
    font-weight: 720;
    line-height: 1.52;
    opacity: 1;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
  }
  .audio-subtitle-line:hover,
  .audio-subtitle-line:focus-visible {
    color: var(--site-primary);
    opacity: 1;
    outline: none;
    transform: translateY(-1px);
  }
  .audio-subtitle-line.is-current:hover,
  .audio-subtitle-line.is-current:focus-visible {
    color: var(--site-ink);
  }
  .audio-player-subtitle-option.is-active svg {
    color: var(--site-primary);
  }
  .audio-player-dock:has(.audio-player-settings[open]) .audio-subtitle-float,
  .audio-player-dock:has(.audio-section-toggle[aria-expanded="true"]) .audio-subtitle-float {
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, 5px);
  }
  @media (max-width: 700px) {
    .audio-subtitle-float {
      border-radius: 10px;
      bottom: calc(100% + 8px);
      padding: 6px 8px 7px;
      width: calc(100vw - 24px);
    }
    .audio-subtitle-line {
      font-size: 10px;
      padding-inline: 5px;
    }
    .audio-subtitle-line.is-current {
      font-size: 13px;
      line-height: 1.48;
    }
    .audio-subtitle-line.is-previous {
      display: none;
    }
  }
}
'''
css.write_text(css_text)
