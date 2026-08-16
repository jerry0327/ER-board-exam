from pathlib import Path
import re

path = Path('app/site.css')
text = path.read_text()


def remove_layer_containing(source: str, marker: str) -> str:
    while marker in source:
        pos = source.index(marker)
        start = source.rfind('@layer ', 0, pos)
        if start < 0:
            raise SystemExit(f'layer start not found for {marker}')
        brace = source.find('{', start, pos)
        if brace < 0:
            raise SystemExit(f'layer brace not found for {marker}')
        depth = 0
        quote = None
        escape = False
        end = None
        for i in range(brace, len(source)):
            ch = source[i]
            if quote:
                if escape:
                    escape = False
                elif ch == '\\':
                    escape = True
                elif ch == quote:
                    quote = None
                continue
            if ch in ('"', "'"):
                quote = ch
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end is None:
            raise SystemExit(f'layer end not found for {marker}')
        while end < len(source) and source[end] in '\r\n':
            end += 1
        source = source[:start] + source[end:]
    return source

for marker in (
    '/* Audio Player floating-section + timeline geometry correction */',
    '/* Portal-safe timeline selectors: never treat the Section layer as the time row. */',
    '/* Audio Player synchronized subtitle + final geometry */',
    '/* Audio Player final portal geometry correction */',
    '/* Audio Player layout-neutral Section portal */',
):
    text = remove_layer_containing(text, marker)

# No Section-open state is allowed to alter the player layout itself.
selector = r'\.audio-player-dock\.is-expanded:has\(\.audio-section-toggle\[aria-expanded="true"\]\)'
rule_pattern = re.compile(selector + r'[^\{]*\{[^{}]*\}', re.S)
text, removed_rules = rule_pattern.subn('', text)
if re.search(selector, text):
    raise SystemExit('A layout-mutating Section-open selector still remains')

text = text.rstrip() + r'''

@layer site-utilities {
  /* Audio Player final runtime presentation */

  .audio-player-dock.is-expanded,
  .audio-player-details,
  .audio-section-companion {
    overflow: visible;
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
    block-size: 18px;
    border: 0;
    box-shadow: none;
    height: 18px;
    inset: 0 0 auto 0;
    margin: 0;
    max-block-size: 18px;
    max-height: 18px;
    min-block-size: 18px;
    min-height: 18px;
    padding: 0;
    position: absolute;
    width: 100%;
    z-index: 8;
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
    inset: 22px 0 auto 0;
    margin: 0;
    position: absolute;
    z-index: 2;
  }

  .audio-player-timeline > div.audio-section-node-layer {
    height: 18px;
    inset: 0 0 auto 0;
    margin: 0;
    pointer-events: none;
    position: absolute;
    z-index: 9;
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

  /* Section boundaries are ticks. The playhead is the only circular timeline marker. */
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
    border-radius: 2px;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-primary) 9%, transparent);
    height: 12px;
    outline: 0;
    top: 3px;
    transform: translateX(-50%);
    width: 3px;
  }
  .audio-section-node-tooltip {
    bottom: 12px;
    z-index: 170;
  }

  /* Section list is a true overlay, portaled into the dock. */
  .audio-player-dock > .audio-section-panel-floating {
    background: var(--site-paper);
    border: 1px solid var(--site-line);
    border-radius: 11px;
    bottom: calc(100% + 10px);
    box-shadow: 0 18px 46px color-mix(in srgb, var(--site-ink) 18%, transparent);
    box-sizing: border-box;
    left: auto;
    margin: 0;
    max-height: min(420px, calc(100vh - 32px));
    overflow: auto;
    position: absolute;
    right: 0;
    top: auto;
    width: 290px;
    z-index: 160;
  }

  @media (min-width: 1200px) {
    .audio-player-dock > .audio-section-panel-floating {
      bottom: 0;
      left: calc(100% + 14px);
      max-height: min(420px, calc(100vh - 32px));
      right: auto;
      top: auto;
      width: 280px;
    }
  }

  /* Live subtitles use nearby context without becoming a permanent player row. */
  .audio-subtitle-float {
    background: var(--site-paper);
    border: 1px solid color-mix(in srgb, var(--site-line-strong) 60%, var(--site-paper));
    border-radius: 12px;
    bottom: calc(100% + 10px);
    box-shadow: 0 16px 42px color-mix(in srgb, var(--site-ink) 17%, transparent);
    box-sizing: border-box;
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
    color: var(--site-ink-soft);
    cursor: pointer;
    display: block;
    font-family: var(--site-sans);
    font-size: 11px;
    line-height: 1.42;
    min-height: 0;
    opacity: .7;
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

  .audio-player-settings[open] {
    z-index: 180;
  }
  .audio-player-settings-panel {
    background: var(--site-paper);
    z-index: 190;
  }

  .audio-player-dock:has(.audio-player-settings[open]) .audio-subtitle-float,
  .audio-player-dock:has(.audio-section-toggle[aria-expanded="true"]) .audio-subtitle-float {
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, 5px);
  }

  @media (max-width: 700px) {
    .audio-player-dock > .audio-section-panel-floating {
      bottom: calc(100% + 10px);
      left: 0;
      max-height: min(46vh, 360px);
      right: 0;
      top: auto;
      width: 100%;
    }
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

path.write_text(text)
print(f'Removed {removed_rules} remaining legacy Section-open rules and consolidated player CSS')
