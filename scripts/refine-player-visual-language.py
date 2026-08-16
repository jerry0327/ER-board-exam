from pathlib import Path


def replace_rule(css: str, selector: str, body: str, *, start: int = 0) -> str:
    marker = selector + " {"
    idx = css.find(marker, start)
    if idx < 0:
        raise RuntimeError(f"selector not found: {selector}")
    brace = css.find("{", idx)
    depth = 0
    end = None
    for i in range(brace, len(css)):
        ch = css[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise RuntimeError(f"unterminated selector: {selector}")
    replacement = selector + " {\n" + body.rstrip() + "\n  }"
    return css[:idx] + replacement + css[end:]


def replace_group(css: str, start_marker: str, end_marker: str, replacement: str, *, start: int = 0) -> str:
    a = css.find(start_marker, start)
    if a < 0:
        raise RuntimeError(f"start marker not found: {start_marker}")
    b = css.find(end_marker, a)
    if b < 0:
        raise RuntimeError(f"end marker not found: {end_marker}")
    return css[:a] + replacement.rstrip() + "\n\n  " + css[b:]


component_path = Path("app/components/audio-section-companion.tsx")
component = component_path.read_text()
needle = '''        <span\n          className="audio-section-track-progress"\n          aria-hidden="true"\n          style={{ width: `${Math.min(100, Math.max(0, player.position / Math.max(1, player.duration) * 100))}%` }}\n        />\n        {markers.map((marker, index) => {'''
replacement = '''        <span\n          className="audio-section-track-progress"\n          aria-hidden="true"\n          style={{ width: `${Math.min(100, Math.max(0, player.position / Math.max(1, player.duration) * 100))}%` }}\n        />\n        <span\n          className="audio-section-playhead"\n          aria-hidden="true"\n          style={{ left: `${Math.min(100, Math.max(0, player.position / Math.max(1, player.duration) * 100))}%` }}\n        />\n        {markers.map((marker, index) => {'''
if needle not in component:
    raise RuntimeError("timeline insertion point not found")
component_path.write_text(component.replace(needle, replacement, 1))

css_path = Path("app/site.css")
css = css_path.read_text()
anchor = css.find("/* Audio Player consolidated Section + subtitle presentation */")
if anchor < 0:
    raise RuntimeError("audio feature anchor not found")

rules = {
    ".audio-player-dock": '''    background: color-mix(in srgb, var(--site-reader-chrome) 96%, transparent);\n    background-image: none;\n    backdrop-filter: blur(16px) saturate(1.02);\n    border: 1px solid color-mix(in srgb, var(--site-line-strong) 52%, var(--site-line));\n    border-radius: 12px;\n    box-shadow: 0 10px 34px color-mix(in srgb, var(--site-ink) 10%, transparent);\n    opacity: 1;\n    overflow: visible;''',
    ".audio-player-dock.is-expanded": '''    max-width: calc(100vw - 32px);\n    width: min(660px, calc(100vw - 32px));''',
    ".audio-player-dock.is-collapsed": '''    max-width: calc(100vw - 24px);\n    width: min(340px, calc(100vw - 24px));''',
    ".audio-player-dock.is-expanded .audio-player-mini": '''    align-items: center;\n    background: transparent;\n    border: 0;\n    border-bottom: 1px solid var(--site-line);\n    display: grid;\n    gap: 10px;\n    grid-template-columns: minmax(0, 1fr) 36px;\n    min-height: 54px;\n    padding: 12px 16px 10px;''',
    ".audio-player-dock.is-expanded .audio-player-title strong": '''    color: var(--site-ink);\n    display: block;\n    font-family: var(--site-sans);\n    font-size: 14px;\n    font-weight: 720;\n    letter-spacing: -.01em;\n    line-height: 1.35;\n    max-width: none;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    width: 100%;''',
    ".audio-player-details": '''    background: transparent;\n    display: flex;\n    flex-direction: column;\n    gap: 10px;\n    overflow: visible;\n    padding: 10px 16px 14px;\n    position: relative;''',
    ".audio-section-summary": '''    align-items: center;\n    display: grid;\n    gap: 12px;\n    grid-template-columns: minmax(0, 1fr) auto;\n    min-height: 34px;''',
    ".audio-section-current": '''    align-items: center;\n    display: grid;\n    gap: 2px;\n    min-width: 0;''',
    ".audio-section-current small": '''    color: var(--site-muted);\n    font-family: var(--site-mono);\n    font-size: 12px;\n    font-weight: 600;\n    letter-spacing: .04em;\n    line-height: 1.3;\n    margin: 0;''',
    ".audio-section-current strong": '''    color: var(--site-ink);\n    display: block;\n    font-size: 13px;\n    font-weight: 700;\n    line-height: 1.35;\n    margin: 0;\n    min-width: 0;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;''',
    ".audio-section-toggle": '''    align-items: center;\n    background: transparent;\n    border: 0;\n    border-radius: var(--site-radius);\n    color: var(--site-primary);\n    cursor: pointer;\n    display: inline-flex;\n    font-size: 13px;\n    font-weight: 700;\n    gap: 4px;\n    min-height: 34px;\n    padding: 0 6px;\n    transition: background-color 140ms var(--site-ease), color 140ms var(--site-ease);''',
    ".audio-section-toggle:hover": '''    background: color-mix(in srgb, var(--site-primary) 7%, transparent);\n    color: var(--site-primary-strong);''',
    ".audio-section-panel": '''    background: var(--site-paper);\n    border: 1px solid var(--site-line);\n    border-radius: 12px;\n    box-shadow: var(--site-shadow-low);\n    box-sizing: border-box;\n    max-height: min(460px, calc(100vh - 32px));\n    overflow: auto;\n    overscroll-behavior: contain;\n    padding: 0;''',
    ".audio-section-panel header": '''    align-items: center;\n    border-bottom: 1px solid var(--site-line);\n    color: var(--site-muted);\n    display: flex;\n    font-family: var(--site-mono);\n    font-size: 12px;\n    justify-content: space-between;\n    min-height: 40px;\n    padding: 0 12px;''',
    ".audio-section-list": '''    display: grid;\n    gap: 0;\n    list-style: none;\n    margin: 0;\n    padding: 0;''',
    ".audio-section-list button": '''    align-items: center;\n    background: transparent;\n    border: 0;\n    border-bottom: 1px solid var(--site-line);\n    border-radius: 0;\n    color: var(--site-ink);\n    cursor: pointer;\n    display: grid;\n    font-size: 13px;\n    gap: 9px;\n    grid-template-columns: 10px minmax(0, 1fr) auto;\n    min-height: 42px;\n    padding: 7px 12px;\n    text-align: left;\n    transition: background-color 140ms var(--site-ease), color 140ms var(--site-ease);\n    width: 100%;''',
    ".audio-section-list button:hover": '''    background: color-mix(in srgb, var(--site-primary) 5%, var(--site-paper));''',
    ".audio-section-list button.is-current": '''    background: color-mix(in srgb, var(--site-primary) 8%, var(--site-paper));\n    color: var(--site-ink);''',
    ".audio-section-list-dot": '''    background: transparent;\n    border: 1px solid var(--site-line-strong);\n    border-radius: 50%;\n    height: 6px;\n    width: 6px;''',
    ".audio-section-list strong": '''    font-size: 13px;\n    font-weight: 680;\n    line-height: 1.35;\n    min-width: 0;''',
    ".audio-player-dock > .audio-section-panel-floating": '''    bottom: calc(100% + 10px);\n    left: auto;\n    margin: 0;\n    position: absolute;\n    right: 0;\n    top: auto;\n    width: min(340px, calc(100vw - 32px));\n    z-index: 4;''',
    ".audio-player-timeline": '''    --audio-timeline-center: 10px;\n    height: 42px;\n    isolation: isolate;\n    overflow: visible;\n    padding: 0;\n    position: relative;''',
    '.audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]': '''    appearance: none;\n    background: transparent;\n    border: 0;\n    box-shadow: none;\n    cursor: pointer;\n    height: 20px;\n    inset: 0 0 auto 0;\n    margin: 0;\n    padding: 0;\n    position: absolute;\n    width: 100%;\n    z-index: 3;''',
    '.audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-thumb': '''    -webkit-appearance: none;\n    background: transparent;\n    border: 0;\n    box-shadow: none;\n    height: 24px;\n    margin-top: -11px;\n    opacity: 0;\n    width: 24px;''',
    '.audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-thumb': '''    background: transparent;\n    border: 0;\n    box-shadow: none;\n    height: 24px;\n    opacity: 0;\n    width: 24px;''',
    '.audio-player-timeline > input[type="range"] + div': '''    color: var(--site-muted);\n    font-family: var(--site-mono);\n    font-size: 12px;\n    inset: 26px 0 auto 0;\n    margin: 0;\n    position: absolute;\n    z-index: 1;''',
    ".audio-player-timeline > div.audio-section-node-layer": '''    height: 20px;\n    inset: 0 0 auto 0;\n    margin: 0;\n    pointer-events: none;\n    position: absolute;\n    z-index: 4;''',
    ".audio-section-track-base,\n  .audio-section-track-progress": '''    border-radius: 999px;\n    height: 2px;\n    left: 0;\n    position: absolute;\n    top: var(--audio-timeline-center);\n    transform: translateY(-50%);''',
    ".audio-section-node,\n  .audio-section-node.is-current,\n  .audio-section-node.is-past": '''    background: color-mix(in srgb, var(--site-line-strong) 72%, var(--site-paper));\n    border: 0;\n    border-radius: 999px;\n    box-shadow: none;\n    height: 8px;\n    padding: 0;\n    pointer-events: auto;\n    position: absolute;\n    top: var(--audio-timeline-center);\n    transform: translate(-50%, -50%);\n    width: 2px;''',
    ".audio-section-node.is-current": '''    background: var(--site-primary);\n    height: 10px;\n    top: var(--audio-timeline-center);''',
    ".audio-section-node:hover,\n  .audio-section-node:focus-visible": '''    background: var(--site-primary);\n    box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-primary) 9%, transparent);\n    height: 12px;\n    outline: 2px solid var(--site-info);\n    outline-offset: 3px;\n    top: var(--audio-timeline-center);\n    width: 3px;''',
    ".audio-player-controls": '''    align-items: center;\n    border-top: 1px solid var(--site-line);\n    display: flex;\n    gap: 10px;\n    padding: 10px 0 0;''',
    ".audio-player-transport": '''    align-items: center;\n    display: flex;\n    flex: 0 0 auto;\n    gap: 2px;\n    order: 1;''',
    ".audio-player-rate select": '''    background: transparent;\n    border-color: var(--site-line);\n    border-radius: var(--site-radius);\n    box-shadow: none;\n    min-height: 34px;\n    padding: 0 24px 0 8px;''',
    ".audio-player-settings-panel": '''    background: var(--site-paper);\n    border: 1px solid var(--site-line);\n    border-radius: 12px;\n    bottom: calc(100% + 10px);\n    box-shadow: var(--site-shadow-low);\n    padding: 6px;\n    position: absolute;\n    right: 0;\n    width: 280px;\n    z-index: 6;''',
    ".audio-player-settings-panel .audio-player-option": '''    align-items: center;\n    background: transparent;\n    border: 0;\n    border-radius: var(--site-radius);\n    color: var(--site-ink);\n    display: grid;\n    font-size: 13px;\n    gap: 8px;\n    grid-template-columns: 22px minmax(0, 1fr);\n    justify-content: start;\n    min-height: 40px;\n    padding: 4px 8px;\n    text-align: left;\n    width: 100%;''',
    ".audio-subtitle-float": '''    background: color-mix(in srgb, var(--site-paper) 97%, transparent);\n    border: 1px solid var(--site-line);\n    border-radius: 12px;\n    bottom: calc(100% + 10px);\n    box-shadow: var(--site-shadow-low);\n    box-sizing: border-box;\n    left: 50%;\n    max-width: calc(100vw - 24px);\n    padding: 6px 10px;\n    pointer-events: auto;\n    position: absolute;\n    transform: translateX(-50%);\n    transition: opacity 160ms var(--site-ease), transform 160ms var(--site-ease);\n    width: min(680px, calc(100vw - 24px));\n    z-index: 2;''',
    ".audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini": '''    align-items: center;\n    background: transparent;\n    display: grid;\n    gap: 4px 8px;\n    grid-template-columns: 40px minmax(0, 1fr) 36px;\n    grid-template-rows: 32px 16px;\n    min-height: 66px;\n    padding: 8px 12px;\n    position: relative;''',
}

for selector, body in rules.items():
    css = replace_rule(css, selector, body, start=anchor)
    anchor = css.find("/* Audio Player consolidated Section + subtitle presentation */")

# Keep the native range track invisible; the visible track/playhead/ticks share one authored centerline.
track_selector = '.audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-webkit-slider-runnable-track,\n  .audio-player-dock.has-audio-sections .audio-player-timeline > input[type="range"]::-moz-range-track'
css = replace_rule(css, track_selector, '''    background: transparent;\n    border: 0;\n    height: 2px;''', start=anchor)

# Add the authored playhead immediately after progress styling.
progress_selector = ".audio-section-track-progress"
idx = css.find(progress_selector + " {", anchor)
if idx < 0:
    raise RuntimeError("progress selector not found")
brace = css.find("{", idx)
depth = 0
end = None
for i in range(brace, len(css)):
    if css[i] == "{": depth += 1
    elif css[i] == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
playhead_rule = '''\n\n  .audio-section-playhead {\n    background: var(--site-primary);\n    border: 2px solid var(--site-paper);\n    border-radius: 50%;\n    box-shadow: 0 1px 5px color-mix(in srgb, var(--site-primary) 24%, transparent);\n    height: 11px;\n    pointer-events: none;\n    position: absolute;\n    top: var(--audio-timeline-center);\n    transform: translate(-50%, -50%);\n    width: 11px;\n    z-index: 5;\n  }'''
css = css[:end] + playhead_rule + css[end:]

css_path.write_text(css)
