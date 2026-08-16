from pathlib import Path

reader_path = Path("app/views/reader-view.tsx")
companion_path = Path("app/components/audio-section-companion.tsx")
contract_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")

reader = reader_path.read_text()
old = '''  function openQuestionAudio() {\n    if (!questionAudio) return;\n    openQuestionAudioPlayer();\n    setMobileToolsOpen(false);\n  }'''
new = '''  function openQuestionAudio(event: ReactMouseEvent<HTMLButtonElement>) {\n    if (!questionAudio) return;\n    openQuestionAudioPlayer(event);\n    setMobileToolsOpen(false);\n  }'''
if old in reader:
    reader = reader.replace(old, new, 1)
elif "openQuestionAudioPlayer(event);" not in reader:
    raise SystemExit("reader question audio wrapper target not found")
reader_path.write_text(reader)

# The earlier refinement helper may be re-run by Actions. Keep this import exactly once.
companion = companion_path.read_text()
type_line = "  type QuestionAudioChoiceEventDetail,\n"
while companion.count(type_line) > 1:
    first = companion.find(type_line)
    duplicate = companion.find(type_line, first + len(type_line))
    companion = companion[:duplicate] + companion[duplicate + len(type_line):]
companion_path.write_text(companion)

contract = contract_path.read_text()
if "readerView" not in contract.split("const [", 1)[1].split("]", 1)[0]:
    contract = contract.replace(
        "const [companion, provider, events, css, learningAudio] = await Promise.all([",
        "const [companion, provider, events, css, learningAudio, readerView] = await Promise.all([",
        1,
    )
    contract = contract.replace(
        '  readFile(new URL("../app/hooks/use-learning-audio.ts", import.meta.url), "utf8"),\n]);',
        '  readFile(new URL("../app/hooks/use-learning-audio.ts", import.meta.url), "utf8"),\n  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),\n]);',
        1,
    )

needle = '  assert.match(companion, /request\\.trigger instanceof HTMLElement/u);\n'
addition = '''  assert.match(companion, /request\\.trigger instanceof HTMLElement/u);\n  assert.match(readerView, /function openQuestionAudio\\(event: ReactMouseEvent<HTMLButtonElement>\\)/u);\n  assert.match(readerView, /openQuestionAudioPlayer\\(event\\)/u);\n  assert.match(readerView, /className="reading-toolbar-audio"[\\s\\S]*?onClick=\\{openQuestionAudio\\}/u);\n  assert.match(readerView, /className="guide-audio-action"[\\s\\S]*?onClick=\\{openQuestionAudio\\}/u);\n'''
if needle in contract and "openQuestionAudioPlayer\\(event\\)" not in contract:
    contract = contract.replace(needle, addition, 1)
elif "openQuestionAudioPlayer\\(event\\)" not in contract:
    raise SystemExit("question-choice contract insertion target not found")
contract_path.write_text(contract)

print("Real question-audio button now passes its click event as the popover anchor")
