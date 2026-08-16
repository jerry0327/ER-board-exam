from pathlib import Path
import re

provider_path = Path("app/components/audio-player-provider.tsx")
text = provider_path.read_text()

for old in [
    "  Maximize2,\n",
    "  Volume2,\n",
    "  const [volume, setVolumeState] = useState(1);\n",
    "  const volumeRef = useRef(1);\n",
    "  const gainNodeRef = useRef<GainNode | null>(null);\n",
    "    gainNodeRef.current?.disconnect();\n    gainNodeRef.current = null;\n",
]:
    if old not in text:
        raise SystemExit(f"Expected provider pattern not found: {old!r}")
    text = text.replace(old, "", 1)

volume_block = '''  function updateVolume(value: number) {\n    const next = Math.max(0, Math.min(1, value));\n    volumeRef.current = next;\n    setVolumeState(next);\n    const context = audioContextRef.current;\n    const gain = gainNodeRef.current;\n    if (context && gain) gain.gain.setTargetAtTime(next, context.currentTime, 0.015);\n  }\n\n  function connectWorkletToOutput(worklet: AudioWorkletNode, context: AudioContext) {\n    let gain = gainNodeRef.current;\n    if (!gain || gain.context !== context) {\n      gain?.disconnect();\n      gain = context.createGain();\n      gain.gain.value = volumeRef.current;\n      gain.connect(context.destination);\n      gainNodeRef.current = gain;\n    }\n    worklet.disconnect();\n    worklet.connect(gain);\n  }\n\n'''
if volume_block not in text:
    raise SystemExit("Expected GainNode helper block not found")
text = text.replace(volume_block, "", 1)

call_count = text.count("connectWorkletToOutput(worklet, context);")
if call_count < 1:
    raise SystemExit("Expected GainNode output call not found")
text = text.replace("connectWorkletToOutput(worklet, context);", "worklet.connect(context.destination);")

volume_markup = '''                  <label className="audio-player-volume">\n                    <Volume2 aria-hidden="true" />\n                    <input type="range" min="0" max="1" step="0.05" value={volume} aria-label="音量" onChange={(event) => updateVolume(Number(event.target.value))} />\n                  </label>\n'''
if volume_markup not in text:
    raise SystemExit("Expected volume markup not found")
text = text.replace(volume_markup, "", 1)

fullscreen_markup = '''                  <button type="button" className="audio-player-utility audio-player-fullscreen" aria-label="切換播放器全螢幕" onClick={() => { const dock = playerDockRef.current; if (!dock) return; if (document.fullscreenElement) void document.exitFullscreen(); else if (dock.requestFullscreen) void dock.requestFullscreen(); }}>\n                    <Maximize2 aria-hidden="true" />\n                  </button>\n'''
if fullscreen_markup not in text:
    raise SystemExit("Expected fullscreen markup not found")
text = text.replace(fullscreen_markup, "", 1)

old_forward = 'aria-label="快進 15 秒" disabled={phase === "loading"} onClick={() => jumpBy(15)}'
if old_forward not in text:
    raise SystemExit("Expected +15 forward control not found")
text = text.replace(old_forward, 'aria-label="快進 30 秒" disabled={phase === "loading"} onClick={() => jumpBy(30)}', 1)
old_forward_label = '<span>15</span><RotateCw aria-hidden="true" />'
if old_forward_label not in text:
    raise SystemExit("Expected +15 forward label not found")
text = text.replace(old_forward_label, '<span>30</span><RotateCw aria-hidden="true" />', 1)

for forbidden in ["volumeRef", "gainNodeRef", "updateVolume", "connectWorkletToOutput", "<Volume2", "<Maximize2", "const [volume,"]:
    if forbidden in text:
        raise SystemExit(f"Provider cleanup incomplete: {forbidden}")
if 'aria-label="快進 30 秒"' not in text or 'jumpBy(30)' not in text:
    raise SystemExit("Forward-skip contract was not restored")
if text.count("worklet.connect(context.destination);") < 2:
    raise SystemExit("Direct AudioWorklet output/recovery contract was not restored")
provider_path.write_text(text)

css_path = Path("app/site.css")
css = css_path.read_text()
# Dead rules for reverted volume/fullscreen controls are safe to remove only when they are standalone blocks.
css = re.sub(r"(?ms)^\s*\.audio-player-fullscreen\s*\{.*?^\s*\}\n?", "", css)
css = re.sub(r"(?ms)^\s*\.audio-player-volume\s*\{.*?^\s*\}\n?", "", css)
css_path.write_text(css)

print(f"Restored baseline audio transport/output contract; rewired {call_count} output calls")
