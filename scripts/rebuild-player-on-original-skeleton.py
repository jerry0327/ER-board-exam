from pathlib import Path

provider_path = Path('app/components/audio-player-provider.tsx')
provider = provider_path.read_text()

# Add a stable Section insertion slot immediately after the original timeline.
needle = '''              </div>\n\n              <div className="audio-player-controls">'''
replacement = '''              </div>\n\n              <div className="audio-section-slot" />\n\n              <div className="audio-player-controls">'''
if needle not in provider:
    raise RuntimeError('timeline/control insertion point not found')
provider = provider.replace(needle, replacement, 1)

start = provider.index('              <div className="audio-player-controls">')
end = provider.index('\n\n              {error && (', start)
controls = '''              <div className="audio-player-controls">
                <label className="audio-player-rate">
                  <span>速度</span>
                  <select
                    className="field-control"
                    value={playbackRate}
                    aria-label="播放速度"
                    onChange={(event) => updatePlaybackRate(Number(event.target.value))}
                  >
                    {AUDIO_PLAYBACK_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}×</option>
                    ))}
                  </select>
                </label>

                <div className="audio-player-transport" role="group" aria-label="播放控制">
                  <button
                    type="button"
                    className="audio-player-chapter-control"
                    aria-label="播放上一章"
                    disabled={phase === "loading" || !adjacentAudioSummary(current.id, -1)}
                    onClick={() => void playAdjacentSource(-1)}
                  >
                    <SkipBack aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="audio-player-skip"
                    aria-label="倒退 15 秒"
                    disabled={phase === "loading"}
                    onClick={() => jumpBy(-15)}
                  >
                    <RotateCcw aria-hidden="true" /><span>15</span>
                  </button>
                  <button
                    type="button"
                    className="audio-player-main-toggle"
                    aria-label={isPlaybackActive ? "暫停" : "播放"}
                    disabled={phase === "loading"}
                    onClick={() => void togglePlayback()}
                  >
                    {isPlaybackActive ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="audio-player-skip"
                    aria-label="快進 30 秒"
                    disabled={phase === "loading"}
                    onClick={() => jumpBy(30)}
                  >
                    <span>30</span><RotateCw aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="audio-player-chapter-control"
                    aria-label={randomReview ? "隨機播放下一章" : "播放下一章"}
                    disabled={phase === "loading" || !canPlayNext}
                    onClick={() => void playNextSource()}
                  >
                    <SkipForward aria-hidden="true" />
                  </button>
                </div>

                <div className="audio-player-utilities">
                  <button
                    type="button"
                    className="audio-player-utility"
                    aria-label="回到開頭"
                    disabled={phase === "loading"}
                    onClick={() => seekTo(0)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                  <details
                    ref={settingsDetailsRef}
                    className="audio-player-settings"
                    onToggle={(event) => {
                      if (event.currentTarget.open) window.dispatchEvent(new Event(AUDIO_PLAYER_SETTINGS_OPEN_EVENT));
                    }}
                  >
                    <summary className="audio-player-utility" aria-label="播放設定">
                      <Settings aria-hidden="true" />
                    </summary>
                    <div className="audio-player-settings-panel">
                      <div className="audio-player-options" role="group" aria-label="播放選項">
                        <label className="audio-player-option audio-player-option-select">
                          <Timer aria-hidden="true" />
                          <select
                            value={sleepTimer ?? ""}
                            aria-label={sleepTimerLabel}
                            onChange={(event) => updateSleepTimer(
                              event.target.value === "chapter-end"
                                ? "chapter-end"
                                : event.target.value
                                  ? Number(event.target.value) as 15 | 30 | 45 | 60
                                  : null,
                            )}
                          >
                            <option value="">睡眠計時</option>
                            <option value="chapter-end">本章播完</option>
                            <option value="15">15 分鐘</option>
                            <option value="30">30 分鐘</option>
                            <option value="45">45 分鐘</option>
                            <option value="60">60 分鐘</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className={`audio-player-option audio-player-subtitle-option ${subtitlesEnabled ? "is-active" : ""}`.trim()}
                          aria-pressed={subtitlesEnabled}
                          onClick={() => updateSubtitlesEnabled(!subtitlesEnabled)}
                        >
                          <Captions aria-hidden="true" />
                          <span><strong>字幕</strong><small>{subtitlesEnabled ? "開" : "關"}</small></span>
                        </button>
                        <button
                          type="button"
                          className={`audio-player-option ${continuousPlay ? "is-active" : ""}`.trim()}
                          aria-pressed={continuousPlay}
                          onClick={() => updateContinuousPlay(!continuousPlay)}
                        >
                          <Repeat2 aria-hidden="true" />
                          <span><strong>連續播放</strong><small>{continuousPlay ? "開" : "關"}</small></span>
                        </button>
                        <button
                          type="button"
                          className={`audio-player-option ${randomReview ? "is-active" : ""}`.trim()}
                          aria-pressed={randomReview}
                          onClick={() => updateRandomReview(!randomReview)}
                        >
                          <Shuffle aria-hidden="true" />
                          <span><strong>隨機複習</strong><small>{randomReview ? "開" : "關"}</small></span>
                        </button>
                        <button
                          type="button"
                          className={`audio-player-option ${queueOpen ? "is-active" : ""}`.trim()}
                          aria-expanded={queueOpen}
                          aria-controls="audio-player-queue-panel"
                          onClick={() => setQueueOpen((open) => !open)}
                        >
                          <ListMusic aria-hidden="true" />
                          <span>
                            <strong>接下來</strong>
                            <small>{queuedSources.length > 0 ? `${queuedSources.length} 章` : nextUpSource ? "下一章" : "已播完"}</small>
                          </span>
                        </button>
                      </div>
                      {queueOpen && (
                        <section id="audio-player-queue-panel" className="audio-player-queue-panel" aria-label="待播內容">
                          <header>
                            <span>{queuedSources.length > 0 ? "待播清單" : randomReview ? "隨機複習下一章" : "依章節順序"}</span>
                            {queuedSources.length > 0 && <button type="button" onClick={() => updateQueue([])}>清除</button>}
                          </header>
                          {queuedSources.length > 0 ? (
                            <ol>
                              {queuedSources.slice(0, 4).map((source) => (
                                <li key={source.id}>
                                  <span><small>{audioSummaryDisplayMarker(source)}</small><strong>{audioSummaryDisplayTitle(source)}</strong></span>
                                  <button type="button" aria-label={`從待播清單移除 ${audioSummaryDisplayName(source)}`} onClick={() => removeFromQueue(source.id)}>
                                    <X aria-hidden="true" />
                                  </button>
                                </li>
                              ))}
                            </ol>
                          ) : nextUpSource ? (
                            <p><small>{audioSummaryDisplayMarker(nextUpSource)}</small><strong>{audioSummaryDisplayTitle(nextUpSource)}</strong></p>
                          ) : (
                            <p>這個系列已經播放到最後一章。</p>
                          )}
                          {!continuousPlay && <small className="audio-player-queue-note">連續播放已關閉，本章播完後會停下。</small>}
                        </section>
                      )}
                    </div>
                  </details>
                  <button
                    type="button"
                    className="audio-player-utility audio-player-close"
                    aria-label="關閉播放器"
                    onClick={dismissPlayer}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              </div>'''
provider = provider[:start] + controls + provider[end:]
provider_path.write_text(provider)

companion_path = Path('app/components/audio-section-companion.tsx')
companion = companion_path.read_text()
old = '      setDetailsTarget(document.querySelector<HTMLElement>(".audio-player-details"));'
new = '      setDetailsTarget(document.querySelector<HTMLElement>(".audio-section-slot"));'
if old not in companion:
    raise RuntimeError('Section slot target not found')
companion = companion.replace(old, new, 1)
companion_path.write_text(companion)

css_path = Path('app/site.css')
css = css_path.read_text()
marker = '@layer site-features {\n  /* Audio Player consolidated Section + subtitle presentation */'
start = css.find(marker)
if start < 0:
    raise RuntimeError('consolidated audio feature layer not found')
css = css[:start].rstrip() + '\n\n' + r'''@layer site-features {
  /* Original player skeleton: Section, subtitle and Settings enhancements only. */
  .audio-section-slot {
    margin-top: 8px;
  }

  .audio-section-summary {
    align-items: center;
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 38px;
  }

  .audio-section-current {
    min-width: 0;
  }

  .audio-section-current small,
  .audio-section-current strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-section-current small {
    color: var(--site-muted);
    font-family: var(--site-mono);
    font-size: 12px;
    line-height: 1.35;
  }

  .audio-section-current strong {
    color: var(--site-ink);
    font-size: 13px;
    font-weight: 720;
    line-height: 1.4;
    margin-top: 1px;
  }

  .audio-section-toggle {
    align-items: center;
    background: transparent;
    border: 1px solid var(--site-line);
    border-radius: var(--site-radius);
    color: var(--site-primary);
    cursor: pointer;
    display: inline-flex;
    font-size: 12px;
    font-weight: 720;
    gap: 4px;
    min-height: 36px;
    padding: 0 9px;
  }

  .audio-section-toggle:hover,
  .audio-section-toggle:focus-visible {
    background: color-mix(in srgb, var(--site-primary) 7%, var(--site-paper));
    border-color: color-mix(in srgb, var(--site-primary) 34%, var(--site-line));
  }

  .audio-section-toggle svg {
    height: 14px;
    width: 14px;
  }

  .audio-section-panel {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: var(--site-overlay-radius);
    box-shadow: var(--site-shadow-overlay);
    box-sizing: border-box;
    max-height: min(460px, calc(100vh - 32px));
    overflow: auto;
    overscroll-behavior: contain;
  }

  .audio-player-dock > .audio-section-panel-floating {
    bottom: calc(100% + 10px);
    position: absolute;
    right: 0;
    width: min(340px, calc(100vw - 32px));
    z-index: 5;
  }

  .audio-section-panel header {
    align-items: center;
    border-bottom: 1px solid var(--site-line);
    color: var(--site-muted);
    display: flex;
    font-family: var(--site-mono);
    font-size: 12px;
    justify-content: space-between;
    min-height: 40px;
    padding: 0 12px;
  }

  .audio-section-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .audio-section-list button {
    align-items: center;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--site-line);
    color: var(--site-ink);
    cursor: pointer;
    display: grid;
    gap: 9px;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    min-height: 44px;
    padding: 7px 12px;
    text-align: left;
    width: 100%;
  }

  .audio-section-list button:hover,
  .audio-section-list button.is-current {
    background: color-mix(in srgb, var(--site-primary) 7%, var(--site-paper));
  }

  .audio-section-list-dot {
    border: 1px solid var(--site-line-strong);
    border-radius: 50%;
    height: 6px;
    width: 6px;
  }

  .audio-section-list button.is-current .audio-section-list-dot {
    background: var(--site-primary);
    border-color: var(--site-primary);
  }

  .audio-section-list strong {
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-section-list time {
    color: var(--site-muted);
    font-family: var(--site-mono);
    font-size: 12px;
  }

  .audio-player-timeline {
    --audio-section-center: 8px;
    position: relative;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"] {
    appearance: none;
    background: transparent;
    height: 18px;
    position: relative;
    z-index: 3;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-runnable-track,
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-track {
    background: transparent;
    border: 0;
    height: 2px;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    background: transparent;
    border: 0;
    height: 28px;
    margin-top: -13px;
    opacity: 0;
    width: 28px;
  }

  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-thumb {
    background: transparent;
    border: 0;
    height: 28px;
    opacity: 0;
    width: 28px;
  }

  .audio-player-timeline > div.audio-section-node-layer {
    height: 18px;
    inset: 0;
    margin: 0;
    pointer-events: none;
    position: absolute;
    z-index: 4;
  }

  .audio-section-track-base,
  .audio-section-track-progress {
    border-radius: 999px;
    height: 2px;
    left: 0;
    position: absolute;
    top: var(--audio-section-center);
    transform: translateY(-50%);
  }

  .audio-section-track-base {
    background: color-mix(in srgb, var(--site-line-strong) 55%, transparent);
    right: 0;
  }

  .audio-section-track-progress {
    background: var(--site-primary);
  }

  .audio-section-playhead {
    background: var(--site-primary);
    border: 2px solid var(--site-reader-chrome);
    border-radius: 50%;
    box-shadow: 0 1px 4px color-mix(in srgb, var(--site-primary) 24%, transparent);
    height: 11px;
    pointer-events: none;
    position: absolute;
    top: var(--audio-section-center);
    transform: translate(-50%, -50%);
    width: 11px;
    z-index: 5;
  }

  .audio-section-node {
    background: color-mix(in srgb, var(--site-line-strong) 78%, var(--site-paper));
    border: 0;
    border-radius: 999px;
    height: 8px;
    padding: 0;
    pointer-events: auto;
    position: absolute;
    top: var(--audio-section-center);
    transform: translate(-50%, -50%);
    width: 2px;
  }

  .audio-section-node::before {
    content: "";
    inset: -10px -12px;
    position: absolute;
  }

  .audio-section-node.is-current {
    background: var(--site-primary);
    height: 11px;
  }

  .audio-section-node-tooltip {
    background: var(--site-ink);
    border-radius: var(--site-radius);
    bottom: calc(100% + 10px);
    color: var(--site-paper);
    display: none;
    left: 50%;
    max-width: 260px;
    min-width: 140px;
    padding: 7px 9px;
    pointer-events: none;
    position: absolute;
    transform: translateX(-50%);
    z-index: 8;
  }

  .audio-section-node:hover .audio-section-node-tooltip,
  .audio-section-node:focus-visible .audio-section-node-tooltip {
    display: block;
  }

  .audio-section-node-tooltip strong,
  .audio-section-node-tooltip time {
    display: block;
    font-size: 12px;
  }

  .audio-section-node-tooltip time {
    margin-top: 2px;
    opacity: .72;
  }

  .audio-player-transport {
    gap: 4px;
  }

  .audio-player-skip {
    background: color-mix(in srgb, var(--site-surface-muted) 82%, transparent);
    border-color: color-mix(in srgb, var(--site-line-strong) 64%, transparent);
    min-width: 48px;
  }

  .audio-player-skip span {
    font-family: var(--site-mono);
    font-size: 12px;
    font-weight: 760;
  }

  .audio-player-main-toggle {
    box-shadow: 0 4px 12px color-mix(in srgb, var(--site-primary-fill) 20%, transparent);
  }

  .audio-player-settings {
    position: relative;
  }

  .audio-player-settings > summary {
    list-style: none;
  }

  .audio-player-settings > summary::-webkit-details-marker {
    display: none;
  }

  .audio-player-settings-panel {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: var(--site-overlay-radius);
    bottom: calc(100% + 10px);
    box-shadow: var(--site-shadow-overlay);
    padding: 8px;
    position: absolute;
    right: 0;
    width: 286px;
    z-index: 7;
  }

  .audio-player-settings-panel .audio-player-options {
    display: grid;
    gap: 2px;
    margin: 0;
    overflow: visible;
    padding: 0;
  }

  .audio-player-settings-panel .audio-player-option {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--site-radius);
    color: var(--site-ink);
    display: grid;
    gap: 8px;
    grid-template-columns: 22px minmax(0, 1fr);
    justify-content: start;
    min-height: 42px;
    padding: 5px 8px;
    text-align: left;
    width: 100%;
  }

  .audio-player-settings-panel .audio-player-option:hover,
  .audio-player-settings-panel .audio-player-option:focus-visible {
    background: var(--site-surface-hover);
  }

  .audio-player-settings-panel .audio-player-option.is-active {
    background: color-mix(in srgb, var(--site-primary) 10%, var(--site-paper));
    color: var(--site-primary);
  }

  .audio-player-settings-panel .audio-player-option > span {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
  }

  .audio-player-settings-panel .audio-player-option strong,
  .audio-player-settings-panel .audio-player-option small,
  .audio-player-settings-panel .audio-player-option select {
    font-size: 12px;
  }

  .audio-player-settings-panel .audio-player-option-select select {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    min-height: 40px;
    width: 100%;
  }

  .audio-player-settings-panel .audio-player-queue-panel {
    margin-top: 6px;
    max-height: 180px;
  }

  .audio-subtitle-float {
    background: color-mix(in srgb, var(--site-paper) 97%, transparent);
    border: 1px solid var(--site-line);
    border-radius: var(--site-overlay-radius);
    bottom: calc(100% + 10px);
    box-shadow: var(--site-shadow-overlay);
    box-sizing: border-box;
    left: 50%;
    max-width: calc(100vw - 24px);
    padding: 8px 10px;
    pointer-events: auto;
    position: absolute;
    transform: translateX(-50%);
    width: min(620px, calc(100vw - 24px));
    z-index: 4;
  }

  .audio-subtitle-lines {
    display: grid;
    gap: 2px;
  }

  .audio-subtitle-line {
    background: transparent;
    border: 0;
    border-radius: var(--site-radius);
    color: var(--site-muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1.45;
    min-height: 32px;
    opacity: .7;
    padding: 4px 8px;
    text-align: center;
    width: 100%;
  }

  .audio-subtitle-line.is-current {
    color: var(--site-ink);
    font-size: 14px;
    font-weight: 720;
    min-height: 40px;
    opacity: 1;
  }

  .audio-subtitle-line:hover,
  .audio-subtitle-line:focus-visible {
    background: var(--site-surface-hover);
  }

  .audio-player-dock:has(.audio-player-settings[open]) .audio-subtitle-float,
  .audio-player-dock:has(.audio-section-toggle[aria-expanded="true"]) .audio-subtitle-float {
    opacity: 0;
    pointer-events: none;
  }

  .audio-question-scope-timeline {
    inset: 0;
    position: absolute;
    z-index: 6;
  }

  .audio-question-scope-timeline input {
    width: 100%;
  }

  .audio-question-scope-time {
    align-items: center;
    color: var(--site-muted);
    display: grid;
    font-family: var(--site-mono);
    font-size: 12px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    margin-top: 5px;
  }

  .audio-question-scope-time strong {
    color: var(--site-primary);
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    border-radius: var(--site-overlay-radius);
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
  }

  .audio-question-choice-close {
    align-items: center;
    background: transparent;
    border: 1px solid var(--site-line);
    border-radius: 50%;
    color: var(--site-ink);
    display: inline-flex;
    height: 40px;
    justify-content: center;
    width: 40px;
  }

  .audio-question-choice-options {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .audio-question-choice-option {
    background: var(--site-surface-muted);
    border: 1px solid var(--site-line);
    border-radius: var(--site-radius);
    color: var(--site-ink);
    font-size: 14px;
    font-weight: 720;
    min-height: 44px;
    padding: 0 12px;
  }

  .audio-question-choice-option:first-child {
    background: var(--site-primary-fill);
    border-color: var(--site-primary-fill);
    color: var(--site-on-primary);
  }

  .audio-question-choice-error {
    color: var(--site-danger);
    font-size: 12px;
    margin: 8px 0 0;
  }

  @media (max-width: 600px) {
    .audio-player-dock > .audio-section-panel-floating {
      bottom: calc(100% + 8px);
      left: 0;
      max-height: min(52vh, 440px);
      right: 0;
      width: 100%;
    }

    .audio-section-toggle span {
      display: none;
    }

    .audio-player-settings-panel {
      position: fixed;
      bottom: calc(var(--site-bottom-nav-height) + 78px);
      left: 14px;
      right: 14px;
      width: auto;
    }

    .audio-subtitle-float {
      bottom: calc(100% + 8px);
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
      border-radius: var(--site-overlay-radius) var(--site-overlay-radius) 0 0;
      border-right: 0;
      max-width: none;
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }
  }

  @media (pointer: coarse) {
    .audio-player-timeline {
      --audio-section-center: 22px;
      min-height: 58px;
    }

    .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"] {
      height: 44px;
    }

    .audio-player-timeline > div.audio-section-node-layer {
      height: 44px;
    }

    .audio-section-node::before {
      inset: -18px -21px;
    }

    .audio-section-toggle,
    .audio-section-list button,
    .audio-subtitle-line,
    .audio-player-settings > summary,
    .audio-player-settings-panel .audio-player-option,
    .audio-question-choice-option {
      min-height: 44px;
    }
  }
}
'''
css_path.write_text(css)
