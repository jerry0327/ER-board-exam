from pathlib import Path

path = Path("app/site.css")
css = path.read_text()

old = '''  @media (max-width: 600px) {
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
'''

new = '''  @media (max-width: 600px) {
    .audio-player-dock > .audio-section-panel-floating {
      bottom: calc(var(--site-bottom-nav-height) + 78px);
      left: 14px;
      max-height: min(42vh, 320px);
      position: fixed;
      right: 14px;
      width: auto;
      z-index: 8;
    }

    .audio-section-panel header {
      background: var(--site-reader-chrome);
      min-height: 38px;
      position: sticky;
      top: 0;
      z-index: 2;
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
      bottom: calc(100% + 6px);
      box-shadow: var(--site-shadow-card);
      padding: 5px 8px;
      width: calc(100vw - 24px);
    }

    .audio-subtitle-lines {
      gap: 0;
    }

    .audio-subtitle-line:not(.is-current) {
      display: none;
    }

    .audio-subtitle-line.is-current {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      display: -webkit-box;
      line-clamp: 2;
      max-height: 54px;
      min-height: 44px;
      overflow: hidden;
      padding: 5px 8px;
    }
'''

if new in css:
    print("Mobile audio overlay refinement already applied.")
elif old in css:
    css = css.replace(old, new, 1)
    path.write_text(css)
    print("Applied mobile audio overlay refinement.")
else:
    raise RuntimeError("Target mobile audio overlay block not found")
