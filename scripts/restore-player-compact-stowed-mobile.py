from pathlib import Path

path = Path("app/site.css")
css = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global css
    if old not in css:
        raise RuntimeError(f"missing block: {label}")
    css = css.replace(old, new, 1)

replace_once(
'''  .audio-player-mark,
  .audio-player-stow {
    display: none;
  }
''',
'''  .audio-player-mark {
    display: none;
  }

  .audio-player-stow {
    display: inline-flex;
  }
''',
"stow visibility",
)

replace_once(
'''  .audio-player-dock.is-expanded .audio-player-mini {
    align-items: center;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--site-line);
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) 36px;
    min-height: 54px;
    padding: 12px 16px 10px;
  }
''',
'''  .audio-player-dock.is-expanded .audio-player-mini {
    align-items: center;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--site-line);
    display: grid;
    gap: 8px;
    grid-template-columns: 36px minmax(0, 1fr) 36px;
    min-height: 54px;
    padding: 10px 14px;
  }

  .audio-player-dock.is-expanded .audio-player-stow {
    grid-column: 1;
    height: 36px;
    min-height: 36px;
    min-width: 36px;
    width: 36px;
  }
''',
"expanded mini layout",
)

replace_once(
'''  .audio-player-dock.is-expanded .audio-player-title {
    grid-column: 1;
    justify-self: stretch;
''',
'''  .audio-player-dock.is-expanded .audio-player-title {
    grid-column: 2;
    justify-self: stretch;
''',
"expanded title column",
)

replace_once(
'''  .audio-player-dock.is-expanded .audio-player-expand {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: var(--site-muted);
    display: inline-flex;
    grid-column: 2;
''',
'''  .audio-player-dock.is-expanded .audio-player-expand {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: var(--site-muted);
    display: inline-flex;
    grid-column: 3;
''',
"expanded expand column",
)

replace_once(
'''  .audio-player-dock.is-collapsed {
    max-width: calc(100vw - 24px);
    width: min(340px, calc(100vw - 24px));
  }
''',
'''  .audio-player-dock.is-collapsed {
    max-width: calc(100vw - 24px);
    width: min(430px, calc(100vw - 24px));
  }

  .audio-player-dock.is-stowed {
    border-color: transparent;
    border-radius: 999px;
    left: max(18px, env(safe-area-inset-left));
    max-width: 52px;
    translate: 0 0;
    width: 52px;
  }
''',
"collapsed and stowed widths",
)

start = css.index('  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini {')
end = css.index('  .audio-question-choice-backdrop {', start)
replacement = '''  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini {
    align-items: center;
    background: transparent;
    display: grid;
    gap: 6px;
    grid-template-columns: 36px minmax(0, 1fr) auto 40px 36px 36px;
    grid-template-rows: 1fr;
    min-height: 54px;
    padding: 6px 8px;
    position: relative;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-stow {
    grid-column: 1;
    height: 36px;
    min-height: 36px;
    min-width: 36px;
    width: 36px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-title {
    display: block;
    grid-column: 2;
    grid-row: 1;
    max-width: none;
    min-width: 0;
    padding: 0 4px;
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
    align-items: center;
    color: var(--site-muted);
    display: flex;
    font-family: var(--site-mono);
    font-size: 12px;
    gap: 4px;
    grid-column: 3;
    grid-row: 1;
    line-height: 1;
    white-space: nowrap;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-toggle {
    grid-column: 4;
    grid-row: 1;
    height: 40px;
    min-height: 40px;
    min-width: 40px;
    width: 40px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-expand {
    grid-column: 5;
    grid-row: 1;
    height: 36px;
    min-height: 36px;
    min-width: 36px;
    padding: 0;
    width: 36px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-close {
    grid-column: 6;
    grid-row: 1;
    height: 36px;
    min-height: 36px;
    min-width: 36px;
    width: 36px;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-edge-progress {
    background: color-mix(in srgb, var(--site-line-strong) 52%, transparent);
    border-radius: 999px;
    display: block;
    height: 2px;
    inset: -1px 16px auto;
    overflow: hidden;
    position: absolute;
    z-index: 3;
  }

  .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-edge-progress > span {
    background: linear-gradient(90deg, var(--site-primary), var(--site-primary-fill-strong));
    border-radius: 999px;
    display: block;
    height: 100%;
    transform: none;
  }

'''
css = css[:start] + replacement + css[end:]

# Replace the mobile section inside the consolidated audio feature block only.
audio_anchor = css.index('  /* Audio Player consolidated Section + subtitle presentation */')
mobile_start = css.index('  @media (max-width: 600px) {', audio_anchor)
pointer_start = css.index('  @media (pointer: coarse) {', mobile_start)
mobile_block = css[mobile_start:pointer_start]

if '    .audio-player-dock.is-expanded {' not in mobile_block:
    raise RuntimeError('mobile audio block not found')

# Inject compact/mobile state rules before the question-choice mobile rules.
insert_at = mobile_block.index('    .audio-question-choice-backdrop {')
compact_mobile = '''    .audio-player-dock.is-collapsed:not(.is-stowed) {
      bottom: calc(var(--site-bottom-nav-height) + 10px);
      max-width: calc(100vw - 28px);
      width: calc(100vw - 28px);
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini {
      gap: 6px;
      grid-template-columns: 44px minmax(0, 1fr) 44px 44px;
      min-height: 56px;
      padding: 6px 7px;
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-stow {
      grid-column: 1;
      height: 44px;
      min-height: 44px;
      min-width: 44px;
      width: 44px;
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-title {
      grid-column: 2;
      padding-inline: 2px;
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-time,
    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-expand {
      display: none;
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-toggle {
      grid-column: 3;
      height: 44px;
      min-height: 44px;
      min-width: 44px;
      width: 44px;
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-mini-close {
      grid-column: 4;
      height: 44px;
      min-height: 44px;
      min-width: 44px;
      width: 44px;
    }

    .audio-player-dock.is-collapsed:not(.is-stowed) .audio-player-edge-progress {
      inset: -1px 14px auto;
    }

    .audio-player-dock.is-stowed {
      bottom: calc(var(--site-bottom-nav-height) + 10px);
      left: max(12px, env(safe-area-inset-left));
      max-width: 52px;
      width: 52px;
    }

'''
mobile_block = mobile_block[:insert_at] + compact_mobile + mobile_block[insert_at:]

# Expanded mobile keeps the stow control at left and expand control at right.
mobile_block = mobile_block.replace(
'''    .audio-player-dock.is-expanded .audio-player-mini {
      grid-template-columns: minmax(0, 1fr) 36px;
      min-height: 48px;
      padding: 8px 12px 4px;
    }
''',
'''    .audio-player-dock.is-expanded .audio-player-mini {
      grid-template-columns: 44px minmax(0, 1fr) 44px;
      min-height: 52px;
      padding: 6px 8px;
    }

    .audio-player-dock.is-expanded .audio-player-stow {
      grid-column: 1;
      height: 44px;
      min-height: 44px;
      min-width: 44px;
      width: 44px;
    }

    .audio-player-dock.is-expanded .audio-player-title {
      grid-column: 2;
    }

    .audio-player-dock.is-expanded .audio-player-expand {
      grid-column: 3;
      height: 44px;
      min-height: 44px;
      min-width: 44px;
      width: 44px;
    }
''',
1,
)
css = css[:mobile_start] + mobile_block + css[pointer_start:]

# Coarse pointers use the same authored centerline instead of separate hard-coded offsets.
pointer_start = css.index('  @media (pointer: coarse) {', audio_anchor)
pointer_end = css.index('\n  }\n}', pointer_start) + len('\n  }')
pointer_block = css[pointer_start:pointer_end]
pointer_block = pointer_block.replace(
'''    .audio-player-timeline {
      height: 64px;
    }
''',
'''    .audio-player-timeline {
      --audio-timeline-center: 22px;
      height: 64px;
    }
''',
1,
)
pointer_block = pointer_block.replace(
'''    .audio-section-track-base,
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
''',
'''    .audio-section-track-base,
    .audio-section-track-progress,
    .audio-section-playhead,
    .audio-section-node,
    .audio-section-node.is-current,
    .audio-section-node.is-past {
      top: var(--audio-timeline-center);
    }

    .audio-section-node,
    .audio-section-node.is-current,
    .audio-section-node.is-past {
      pointer-events: auto;
    }

    .audio-section-node::before {
      inset: -18px -21px;
    }
''',
1,
)
css = css[:pointer_start] + pointer_block + css[pointer_end:]

path.write_text(css)
