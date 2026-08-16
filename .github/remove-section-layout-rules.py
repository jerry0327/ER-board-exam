from pathlib import Path
import re

path = Path('app/site.css')
text = path.read_text()
selector = r'\.audio-player-dock\.is-expanded:has\(\.audio-section-toggle\[aria-expanded="true"\]\)'
pattern = re.compile(r'(?ms)^[ \t]*' + selector + r'[^\{]*\{[^{}]*\}\s*')
text, count = pattern.subn('', text)
if count < 6:
    raise SystemExit(f'Expected multiple legacy Section layout rules, removed only {count}')

marker = '/* Audio Player layout-neutral Section portal */'
if marker not in text:
    text += r'''

@layer site-features {
  /* Audio Player layout-neutral Section portal */
  .audio-player-dock > .audio-section-panel-floating {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 11px;
    bottom: calc(100% + 10px);
    box-shadow: 0 18px 46px color-mix(in srgb, var(--site-ink) 18%, transparent);
    left: auto;
    margin: 0;
    max-height: min(360px, calc(100vh - 32px));
    overflow: auto;
    position: absolute;
    right: 0;
    top: auto;
    width: min(290px, calc(100vw - 32px));
    z-index: 160;
  }

  @media (min-width: 1200px) {
    .audio-player-dock > .audio-section-panel-floating {
      bottom: 0;
      left: calc(100% + 14px);
      max-height: min(360px, calc(100vh - 32px));
      right: auto;
      top: auto;
      width: 264px;
    }
  }

  @media (max-width: 700px) {
    .audio-player-dock > .audio-section-panel-floating {
      bottom: calc(100% + 10px);
      left: 0;
      max-height: min(44vh, 330px);
      right: 0;
      top: auto;
      width: 100%;
    }
  }
}
'''

path.write_text(text)
print(f'Removed {count} Section-open layout-mutating CSS rules')
