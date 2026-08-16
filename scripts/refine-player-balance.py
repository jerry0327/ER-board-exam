from pathlib import Path

path = Path("app/site.css")
text = path.read_text(encoding="utf-8")
marker = "/* Audio player balance refinement: quiet chrome */"
if marker in text:
    print("Player balance refinement already present.")
    raise SystemExit(0)

block = r'''

@layer site-utilities {
  /* Audio player balance refinement: quiet chrome */
  .audio-player-stow,
  .audio-player-expand {
    background: transparent;
    border: 0;
    border-radius: var(--site-radius);
    box-shadow: none;
    color: var(--site-ink-soft);
  }

  .audio-player-stow:hover,
  .audio-player-stow:focus-visible,
  .audio-player-expand:hover,
  .audio-player-expand:focus-visible {
    background: var(--site-surface-hover);
    border: 0;
    color: var(--site-primary);
  }

  .audio-player-rate {
    align-items: center;
    display: inline-flex;
    justify-self: start;
    min-height: 44px;
    min-width: 0;
  }

  .audio-player-rate > span {
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }

  .audio-player-rate select.field-control {
    background-color: transparent;
    border: 0;
    border-radius: var(--site-radius);
    box-shadow: none;
    color: var(--site-ink-soft);
    cursor: pointer;
    font-family: var(--site-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 760;
    min-height: 44px;
    min-width: 58px;
    outline: 0;
    padding-block: 0;
    padding-inline: 8px 20px;
  }

  .audio-player-rate:hover select.field-control,
  .audio-player-rate:focus-within select.field-control {
    background-color: var(--site-surface-hover);
    color: var(--site-primary);
  }

  .audio-player-rate:focus-within select.field-control {
    outline: 2px solid color-mix(in srgb, var(--site-primary) 26%, transparent);
    outline-offset: 1px;
  }

  .audio-player-controls {
    column-gap: 10px;
    grid-template-columns: minmax(112px, 1fr) auto minmax(112px, 1fr);
    margin-top: 7px;
  }

  .audio-player-transport {
    justify-self: center;
  }

  .audio-player-utilities {
    gap: 0;
    justify-self: end;
  }

  .audio-player-utility {
    border-radius: var(--site-radius);
  }

  @media (max-width: 600px) {
    .audio-player-controls {
      column-gap: 4px;
      grid-template-areas:
        "transport transport"
        "rate utilities";
      grid-template-columns: minmax(0, 1fr) auto;
      margin-top: 6px;
      row-gap: 4px;
    }

    .audio-player-rate select.field-control {
      min-width: 54px;
      padding-inline: 6px 18px;
    }

    .audio-player-utilities {
      gap: 0;
    }
  }
}
'''

path.write_text(text.rstrip() + block + "\n", encoding="utf-8")
print("Applied player balance refinement.")
