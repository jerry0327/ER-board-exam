from pathlib import Path

path = Path("app/site.css")
text = path.read_text(encoding="utf-8")
changed = False

balance_marker = "/* Balanced secondary control groups */"
if balance_marker not in text:
    balance_block = r'''

@layer site-utilities {
  /* Balanced secondary control groups */
  .audio-player-secondary-left {
    align-items: center;
    display: inline-flex;
    gap: 0;
    justify-self: start;
    min-width: 0;
  }

  .audio-player-secondary-left .audio-player-reset {
    flex: 0 0 44px;
  }

  .audio-player-utilities {
    align-items: center;
    display: inline-flex;
    gap: 0;
    justify-self: end;
  }

  @media (max-width: 600px) {
    .audio-player-secondary-left {
      grid-area: rate;
      justify-self: start;
    }

    .audio-player-utilities {
      grid-area: utilities;
      justify-self: end;
    }
  }
}
'''
    text = text.rstrip() + balance_block + "\n"
    changed = True

polish_marker = "/* Final player balance polish: text-only speed and chromeless collapse */"
if polish_marker not in text:
    polish_block = r'''

@layer site-utilities {
  /* Final player balance polish: text-only speed and chromeless collapse */
  .audio-player-stow,
  .audio-player-expand,
  .audio-player-stow:hover,
  .audio-player-expand:hover,
  .audio-player-stow:focus-visible,
  .audio-player-expand:focus-visible {
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  .audio-player-stow:hover,
  .audio-player-expand:hover {
    color: var(--site-primary);
  }

  .audio-player-stow:focus-visible,
  .audio-player-expand:focus-visible {
    color: var(--site-primary);
    outline: 2px solid color-mix(in srgb, var(--site-primary) 32%, transparent);
    outline-offset: -4px;
  }

  .audio-player-secondary-left,
  .audio-player-utilities {
    width: 88px;
  }

  .audio-player-rate {
    flex: 0 0 44px;
    width: 44px;
  }

  .audio-player-rate select.field-control {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    background-image: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    min-width: 44px;
    padding: 0;
    text-align: center;
    text-align-last: center;
    width: 44px;
  }

  .audio-player-rate:hover select.field-control,
  .audio-player-rate:focus-within select.field-control {
    background: transparent;
    color: var(--site-primary);
    outline: 0;
  }

  .audio-player-rate select.field-control:focus-visible {
    border-radius: 6px;
    outline: 2px solid color-mix(in srgb, var(--site-primary) 32%, transparent);
    outline-offset: -4px;
  }

  @media (max-width: 600px) {
    .audio-player-secondary-left,
    .audio-player-utilities {
      width: 88px;
    }

    .audio-player-rate,
    .audio-player-rate select.field-control {
      min-width: 44px;
      width: 44px;
    }

    .audio-player-rate select.field-control {
      padding: 0;
    }
  }
}
'''
    text = text.rstrip() + polish_block + "\n"
    changed = True

if changed:
    path.write_text(text, encoding="utf-8")
    print("Applied final player balance polish.")
else:
    print("Player balance polish already present.")
