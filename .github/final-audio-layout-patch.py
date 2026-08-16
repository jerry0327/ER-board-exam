from pathlib import Path

companion = Path('app/components/audio-section-companion.tsx')
text = companion.read_text()

old = '''  const sectionPortal = activeBundle && detailsTarget
    ? createPortal(
      <div className="audio-section-companion">
        <div className="audio-section-summary">
          <div className="audio-section-current">
            <small>{activeScope ? "只播放本題" : `目前段落 ${currentIndex >= 0 ? currentIndex + 1 : 1} / ${Math.max(1, chapters.length)}`}</small>
            {activeScope && <strong title={currentTitle ?? undefined}>{currentTitle}</strong>}
          </div>
          <button type="button" className="audio-section-toggle" aria-expanded={sectionOpen} onClick={() => setSectionOpen((open) => !open)}>
            <span>段落</span><ChevronDown aria-hidden="true" />
          </button>
        </div>
        {sectionOpen && (
          <section className="audio-section-panel" aria-label="音檔段落">
            <header>
              <span>段落</span>
              <span>{chapters.length} 段</span>
            </header>
            <ol className="audio-section-list">
              {chapters.map((chapter, index) => {
                const startSeconds = markers[index]?.playerStartSeconds ?? playerSecondsForChapter(chapter);
                const isCurrent = chapter.id === currentChapter?.id;
                return (
                  <li key={chapter.id}>
                    <button
                      type="button"
                      className={isCurrent ? "is-current" : undefined}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => seekChapter(chapter)}
                    >
                      <span className="audio-section-list-dot" aria-hidden="true" />
                      <strong>{sectionLabel(activeBundle, chapter)}</strong>
                      <time>{formatTime(startSeconds)}</time>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>,
      detailsTarget,
    )
    : null;
'''

new = '''  const sectionPortal = activeBundle && detailsTarget
    ? createPortal(
      <div className="audio-section-companion">
        <div className="audio-section-summary">
          <div className="audio-section-current">
            <small>{activeScope ? "只播放本題" : `目前段落 ${currentIndex >= 0 ? currentIndex + 1 : 1} / ${Math.max(1, chapters.length)}`}</small>
            {activeScope && <strong title={currentTitle ?? undefined}>{currentTitle}</strong>}
          </div>
          <button type="button" className="audio-section-toggle" aria-expanded={sectionOpen} onClick={() => setSectionOpen((open) => !open)}>
            <span>段落</span><ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>,
      detailsTarget,
    )
    : null;

  const sectionListPortal = activeBundle && dockTarget && sectionOpen
    ? createPortal(
      <section className="audio-section-panel audio-section-panel-floating" aria-label="音檔段落">
        <header>
          <span>段落</span>
          <span>{chapters.length} 段</span>
        </header>
        <ol className="audio-section-list">
          {chapters.map((chapter, index) => {
            const startSeconds = markers[index]?.playerStartSeconds ?? playerSecondsForChapter(chapter);
            const isCurrent = chapter.id === currentChapter?.id;
            return (
              <li key={chapter.id}>
                <button
                  type="button"
                  className={isCurrent ? "is-current" : undefined}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => seekChapter(chapter)}
                >
                  <span className="audio-section-list-dot" aria-hidden="true" />
                  <strong>{sectionLabel(activeBundle, chapter)}</strong>
                  <time>{formatTime(startSeconds)}</time>
                </button>
              </li>
            );
          })}
        </ol>
      </section>,
      dockTarget,
    )
    : null;
'''

if 'const sectionListPortal =' not in text:
    if old not in text:
        raise SystemExit('section portal block not found')
    text = text.replace(old, new, 1)

return_anchor = '''      {subtitlePortal}
      {sectionPortal}
      {timelinePortal}'''
if '{sectionListPortal}' not in text:
    if return_anchor not in text:
        raise SystemExit('section list return anchor not found')
    text = text.replace(return_anchor, '''      {subtitlePortal}
      {sectionPortal}
      {sectionListPortal}
      {timelinePortal}''', 1)

companion.write_text(text)

css = Path('app/site.css')
css_text = css.read_text()
marker = '/* Audio Player final portal geometry correction */'
if marker not in css_text:
    css_text += r'''

@layer site-features {
  /* Audio Player final portal geometry correction */

  /* Opening a Section list must never alter player layout. */
  .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) {
    min-height: 0;
    width: min(640px, calc(100vw - 28px));
  }
  .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-details {
    min-height: 0;
    padding: 0 16px 14px;
  }
  .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-controls {
    margin-top: 0;
  }

  /* The list is portaled directly into the dock and positioned independently. */
  .audio-player-dock > .audio-section-panel-floating {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 11px;
    box-shadow: 0 18px 46px color-mix(in srgb, var(--site-ink) 18%, transparent);
    left: auto;
    margin: 0;
    max-height: min(360px, calc(100vh - 32px));
    overflow: auto;
    position: absolute;
    right: 0;
    top: auto;
    bottom: calc(100% + 10px);
    width: min(290px, calc(100vw - 32px));
    z-index: 160;
  }

  @media (min-width: 1200px) {
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) > .audio-section-panel-floating {
      bottom: 0;
      left: calc(100% + 14px);
      max-height: min(360px, calc(100vh - 32px));
      right: auto;
      top: auto;
      width: 264px;
    }
  }

  @media (max-width: 700px) {
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) {
      width: calc(100vw - 24px);
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-details {
      padding: 0 12px 12px;
    }
    .audio-player-dock > .audio-section-panel-floating {
      bottom: calc(100% + 10px);
      left: 0;
      max-height: min(44vh, 330px);
      right: 0;
      top: auto;
      width: 100%;
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-timeline,
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-controls {
      display: inherit;
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-timeline {
      display: block;
    }
    .audio-player-dock.is-expanded:has(.audio-section-toggle[aria-expanded="true"]) .audio-player-controls {
      display: grid;
    }
  }

  /* Solid burgundy playhead; Section ticks are the only other timeline marks. */
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    background: var(--site-primary) !important;
    border: 0 !important;
    border-radius: 50%;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--site-primary) 28%, transparent) !important;
    height: 10px;
    margin-top: -4px;
    width: 10px;
  }
  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-thumb {
    background: var(--site-primary) !important;
    border: 0 !important;
    border-radius: 50%;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--site-primary) 28%, transparent) !important;
    height: 10px;
    width: 10px;
  }

  /* Secondary context remains readable without competing with the active cue. */
  .audio-subtitle-line:not(.is-current) {
    color: var(--site-ink-soft);
    opacity: .7;
  }
}
'''
css.write_text(css_text)
