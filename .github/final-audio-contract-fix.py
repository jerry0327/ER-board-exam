from pathlib import Path

provider_path = Path("app/components/audio-player-provider.tsx")
text = provider_path.read_text()

replacements = [
    ("  Maximize2,\n", ""),
    ("  Volume2,\n", ""),
    ("  const [volume, setVolumeState] = useState(1);\n", ""),
    ("  const volumeRef = useRef(1);\n", ""),
    ("  const gainNodeRef = useRef<GainNode | null>(null);\n", ""),
    ("    gainNodeRef.current?.disconnect();\n    gainNodeRef.current = null;\n", ""),
    ('''  function updateVolume(value: number) {\n    const next = Math.max(0, Math.min(1, value));\n    volumeRef.current = next;\n    setVolumeState(next);\n    const context = audioContextRef.current;\n    const gain = gainNodeRef.current;\n    if (context && gain) gain.gain.setTargetAtTime(next, context.currentTime, 0.015);\n  }\n\n  function connectWorkletToOutput(worklet: AudioWorkletNode, context: AudioContext) {\n    let gain = gainNodeRef.current;\n    if (!gain || gain.context !== context) {\n      gain?.disconnect();\n      gain = context.createGain();\n      gain.gain.value = volumeRef.current;\n      gain.connect(context.destination);\n      gainNodeRef.current = gain;\n    }\n    worklet.disconnect();\n    worklet.connect(gain);\n  }\n\n''', ""),
    ("    connectWorkletToOutput(worklet, context);\n", "    worklet.connect(context.destination);\n"),
    ("              worklet.disconnect();\n              connectWorkletToOutput(worklet, context);\n", "              worklet.disconnect();\n              worklet.connect(context.destination);\n"),
    ('''                  <label className="audio-player-volume">\n                    <Volume2 aria-hidden="true" />\n                    <input type="range" min="0" max="1" step="0.05" value={volume} aria-label="音量" onChange={(event) => updateVolume(Number(event.target.value))} />\n                  </label>\n''', ""),
    ('''                  <button type="button" className="audio-player-fullscreen" aria-label="切換播放器全螢幕" onClick={() => { const dock = playerDockRef.current; if (!dock) return; if (document.fullscreenElement) void document.exitFullscreen(); else if (dock.requestFullscreen) void dock.requestFullscreen(); }}>\n                    <Maximize2 aria-hidden="true" />\n                  </button>\n''', ""),
    ('''                  <button type="button" className="audio-player-utility audio-player-fullscreen" aria-label="切換播放器全螢幕" onClick={() => { const dock = playerDockRef.current; if (!dock) return; if (document.fullscreenElement) void document.exitFullscreen(); else if (dock.requestFullscreen) void dock.requestFullscreen(); }}>\n                    <Maximize2 aria-hidden="true" />\n                  </button>\n''', ""),
    ('aria-label="快進 15 秒" disabled={phase === "loading"} onClick={() => jumpBy(15)}', 'aria-label="快進 30 秒" disabled={phase === "loading"} onClick={() => jumpBy(30)}'),
    ('<span>15</span><RotateCw aria-hidden="true" />', '<span>30</span><RotateCw aria-hidden="true" />'),
]

for old, new in replacements:
    if old not in text:
        if old.startswith('''                  <button type="button" className="audio-player-fullscreen"'''):
            continue
        raise SystemExit(f"Expected provider pattern not found: {old[:100]!r}")
    text = text.replace(old, new, 1)

for forbidden in ["volumeRef", "gainNodeRef", "updateVolume", "connectWorkletToOutput", "<Volume2", "<Maximize2", "const [volume,"]:
    if forbidden in text:
        raise SystemExit(f"Provider cleanup incomplete: {forbidden}")
if 'aria-label="快進 30 秒"' not in text or 'jumpBy(30)' not in text:
    raise SystemExit("Forward-skip contract was not restored")
if "worklet.connect(context.destination);" not in text:
    raise SystemExit("Direct AudioWorklet output contract was not restored")
provider_path.write_text(text)

css_path = Path("app/site.css")
css = css_path.read_text()
# Remove isolated dead rules for controls intentionally reverted to the pre-feature player contract.
import re
for selector in [r"\.audio-player-volume(?:[^\{]*)", r"\.audio-player-fullscreen(?:[^\{]*)"]:
    css = re.sub(rf"(?ms)^\s*{selector}\s*\{{.*?^\s*\}}\n?", "", css)
css_path.write_text(css)

print("Restored baseline audio transport/output contract and removed unrelated controls")
