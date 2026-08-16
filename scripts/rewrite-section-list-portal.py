from pathlib import Path

path = Path("app/components/audio-section-companion.tsx")
text = path.read_text()
start = text.find("  const sectionListPortal =")
end = text.find("\n\n  const timelinePortal =", start)
if start < 0 or end < 0:
    raise SystemExit("Section list portal boundaries not found")

block = '''  const sectionListPortal = activeBundle && dockTarget && sectionOpen
    ? createPortal(
      <section
        ref={sectionPanelRef}
        id="audio-player-section-panel"
        className="audio-section-panel audio-section-panel-floating"
        role="dialog"
        aria-labelledby="audio-player-section-panel-title"
      >
        <header>
          <span id="audio-player-section-panel-title">段落</span>
          <span>{chapters.length} 主段 · {l2Count} 子段</span>
        </header>
        <ol className="audio-section-list">
          {chapters.map((chapter, index) => {
            const startSeconds = markers[index]?.playerStartSeconds ?? playerSecondsForChapter(chapter);
            const isCurrent = chapter.id === currentChapter?.id;
            return (
              <li key={chapter.id} className="audio-section-l1-item">
                <button
                  type="button"
                  className={`audio-section-list-l1 ${isCurrent ? "is-current" : ""}`.trim()}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => seekChapter(chapter)}
                >
                  <span className="audio-section-list-dot" aria-hidden="true" />
                  <strong>{sectionLabel(activeBundle, chapter)}</strong>
                  <time>{formatTime(startSeconds)}</time>
                </button>
                {chapter.children.length > 0 && (
                  <ol className="audio-section-sublist" aria-label={`${sectionLabel(activeBundle, chapter)} 子段落`}>
                    {chapter.children.map((child) => {
                      const isCurrentL2 = child.id === currentL2?.id;
                      return (
                        <li key={child.id}>
                          <button
                            type="button"
                            className={`audio-section-list-l2 ${isCurrentL2 ? "is-current-l2" : ""}`.trim()}
                            aria-current={isCurrentL2 ? "location" : undefined}
                            onClick={() => seekChapter(child)}
                          >
                            <span className="audio-section-list-branch" aria-hidden="true">↳</span>
                            <strong>{sectionLabel(activeBundle, child)}</strong>
                            <time>{formatTime(playerSecondsForChapter(child))}</time>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </section>,
      dockTarget,
    )
    : null;'''

next_text = text[:start] + block + text[end:]
path.write_text(next_text)
