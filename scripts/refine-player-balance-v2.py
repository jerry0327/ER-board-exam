from pathlib import Path

path = Path("app/site.css")
text = path.read_text(encoding="utf-8")
marker = "/* Balanced secondary control groups */"
if marker in text:
    print("Secondary control balance CSS already present.")
    raise SystemExit(0)

block = r'''

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
path.write_text(text.rstrip() + block + "\n", encoding="utf-8")
print("Applied secondary control balance CSS.")
