from pathlib import Path

path = Path("app/components/audio-player-provider.tsx")
text = path.read_text(encoding="utf-8")
if 'className="audio-player-secondary-left"' in text:
    print("Secondary controls already rebalanced.")
    raise SystemExit(0)

start = '''                <label className="audio-player-rate">\n                  <span>速度</span>'''
replacement = '''                <div className="audio-player-secondary-left">\n                  <label className="audio-player-rate">\n                    <span>速度</span>'''
if start not in text:
    raise SystemExit("Could not locate audio-player-rate start")
text = text.replace(start, replacement, 1)

rate_end = '''                  </select>\n                </label>\n\n                <div className="audio-player-transport" role="group" aria-label="播放控制">'''
rate_replacement = '''                    </select>\n                  </label>\n                  <button\n                    type="button"\n                    className="audio-player-utility audio-player-reset"\n                    aria-label="回到開頭"\n                    disabled={phase === "loading"}\n                    onClick={() => seekTo(0)}\n                  >\n                    <RotateCcw aria-hidden="true" />\n                  </button>\n                </div>\n\n                <div className="audio-player-transport" role="group" aria-label="播放控制">'''
if rate_end not in text:
    raise SystemExit("Could not locate audio-player-rate end")
text = text.replace(rate_end, rate_replacement, 1)

old_reset = '''                <div className="audio-player-utilities">\n                  <button\n                    type="button"\n                    className="audio-player-utility"\n                    aria-label="回到開頭"\n                    disabled={phase === "loading"}\n                    onClick={() => seekTo(0)}\n                  >\n                    <RotateCcw aria-hidden="true" />\n                  </button>\n                  <details'''
new_reset = '''                <div className="audio-player-utilities">\n                  <details'''
if old_reset not in text:
    raise SystemExit("Could not locate utility reset block")
text = text.replace(old_reset, new_reset, 1)

path.write_text(text, encoding="utf-8")
print("Rebalanced secondary controls.")
