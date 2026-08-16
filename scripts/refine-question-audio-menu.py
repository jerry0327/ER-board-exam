from pathlib import Path

companion_path = Path('app/components/audio-section-companion.tsx')
css_path = Path('app/site.css')
contract_path = Path('tests/audio-player-section-subtitle-contract.test.mjs')
qa_path = Path('scripts/qa-original-player-skeleton.mjs')

companion = companion_path.read_text()

# Question-choice popover no longer needs the X icon.
companion = companion.replace('import {\n  ChevronDown,\n  X,\n} from "lucide-react";', 'import { ChevronDown } from "lucide-react";')

# Replace modal focus trap/body scroll lock with anchored popover lifecycle.
start = companion.find('  useEffect(() => {\n    if (!questionChoice) return;\n    const dialog = questionDialogRef.current;')
end_marker = '\n\n  useEffect(() => {\n    const closeFrame = window.requestAnimationFrame(() => setSectionOpen(false));'
end = companion.find(end_marker, start)
if start < 0 or end < 0:
    if 'question audio menu stays anchored without locking page scroll' not in companion:
        raise SystemExit('question-choice modal effect target not found')
else:
    new_effect = '''  useEffect(() => {\n    // The question audio menu stays anchored without locking page scroll.\n    if (!questionChoice) return;\n    const menu = questionDialogRef.current;\n    const trigger = questionChoiceTriggerRef.current;\n    if (!menu || !trigger) return;\n\n    const positionMenu = () => {\n      const anchor = trigger.getBoundingClientRect();\n      const menuBox = menu.getBoundingClientRect();\n      const gutter = 8;\n      const gap = 6;\n      const maxLeft = Math.max(gutter, window.innerWidth - menuBox.width - gutter);\n      const preferredLeft = anchor.left + anchor.width - menuBox.width;\n      const left = Math.min(maxLeft, Math.max(gutter, preferredLeft));\n      const roomBelow = window.innerHeight - anchor.bottom - gutter;\n      const top = roomBelow >= menuBox.height + gap\n        ? anchor.bottom + gap\n        : Math.max(gutter, anchor.top - menuBox.height - gap);\n      menu.style.left = `${Math.round(left)}px`;\n      menu.style.top = `${Math.round(top)}px`;\n    };\n\n    const focusFrame = window.requestAnimationFrame(() => {\n      positionMenu();\n      menu.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();\n    });\n    const handlePointerDown = (event: PointerEvent) => {\n      const target = event.target;\n      if (!(target instanceof Node) || menu.contains(target) || trigger.contains(target)) return;\n      setQuestionChoice(null);\n    };\n    const handleKeyDown = (event: KeyboardEvent) => {\n      if (event.key !== "Escape") return;\n      event.preventDefault();\n      setQuestionChoice(null);\n    };\n    const handleViewportChange = () => positionMenu();\n\n    document.addEventListener("pointerdown", handlePointerDown);\n    document.addEventListener("keydown", handleKeyDown);\n    window.addEventListener("resize", handleViewportChange);\n    window.addEventListener("scroll", handleViewportChange, true);\n    return () => {\n      window.cancelAnimationFrame(focusFrame);\n      document.removeEventListener("pointerdown", handlePointerDown);\n      document.removeEventListener("keydown", handleKeyDown);\n      window.removeEventListener("resize", handleViewportChange);\n      window.removeEventListener("scroll", handleViewportChange, true);\n      window.requestAnimationFrame(() => questionChoiceTriggerRef.current?.focus());\n    };\n  }, [questionChoice]);'''
    companion = companion[:start] + new_effect + companion[end:]

# Replace backdrop/modal JSX with a compact anchored menu.
start = companion.rfind('      {questionChoice && (')
end = companion.find('\n      )}\n    </>', start)
if start < 0 or end < 0:
    if 'audio-question-choice-popover' not in companion:
        raise SystemExit('question-choice JSX target not found')
else:
    end += len('\n      )}')
    new_jsx = '''      {questionChoice && (\n        <section\n          ref={questionDialogRef}\n          className="audio-question-choice audio-question-choice-popover"\n          role="menu"\n          aria-label="選擇播放方式"\n        >\n          <button\n            type="button"\n            role="menuitem"\n            className="audio-question-choice-option"\n            disabled={!choiceSource || loadingChoice}\n            onClick={() => void chooseFullQuestionSet()}\n          >\n            完整音檔\n          </button>\n          <button\n            type="button"\n            role="menuitem"\n            className="audio-question-choice-option"\n            disabled={!choiceSource || loadingChoice}\n            aria-busy={loadingChoice || undefined}\n            onClick={() => void chooseQuestionOnly()}\n          >\n            {loadingChoice ? "載入中…" : "只播放本題"}\n          </button>\n          {choiceError && <p className="audio-question-choice-error">{choiceError}</p>}\n        </section>\n      )}'''
    companion = companion[:start] + new_jsx + companion[end:]

companion_path.write_text(companion)

css = css_path.read_text()
marker = '@layer site-utilities {\n'
if marker not in css:
    raise SystemExit('site utilities layer not found')
block = r'''  /* Question-bank playback choice reuses the site's anchored reader-panel language. */
  .audio-question-choice-popover {
    background: var(--site-reader-chrome);
    border: 1px solid color-mix(in srgb, var(--site-line-strong) 66%, transparent);
    border-radius: var(--site-panel-radius);
    box-shadow: var(--site-shadow-low);
    box-sizing: border-box;
    display: grid;
    gap: 2px;
    max-width: calc(100vw - 16px);
    padding: 6px;
    position: fixed;
    width: min(240px, calc(100vw - 16px));
    z-index: var(--site-z-overlay-panel);
  }

  .audio-question-choice-popover .audio-question-choice-option {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--site-radius);
    color: var(--site-ink);
    display: flex;
    font-family: var(--site-sans);
    font-size: 13px;
    font-weight: 680;
    justify-content: flex-start;
    min-height: 42px;
    padding: 7px 10px;
    text-align: left;
    width: 100%;
  }

  .audio-question-choice-popover .audio-question-choice-option:hover:not(:disabled),
  .audio-question-choice-popover .audio-question-choice-option:focus-visible {
    background: var(--site-surface-hover);
    color: var(--site-primary);
  }

  .audio-question-choice-popover .audio-question-choice-option:disabled {
    opacity: .5;
  }

  .audio-question-choice-popover .audio-question-choice-error {
    color: var(--site-danger);
    font-size: 12px;
    line-height: 1.4;
    margin: 4px 7px 3px;
  }

'''
if '/* Question-bank playback choice reuses the site' not in css:
    css = css.replace(marker, marker + block, 1)
css_path.write_text(css)

# Replace stale static contracts with semantic hierarchy + anchored-menu contracts.
contract = contract_path.read_text()
contract = contract.replace(
    '  assert.match(companion, /\\{currentTitle && <strong title=\\{currentTitle\\}>\\{currentTitle\\}<\\/strong>\\}/u);',
    '  assert.match(companion, /audio-section-inline-title/u);\n  assert.match(companion, /currentTitle \\?\\? "段落"/u);',
)
contract = contract.replace(
    '  assert.match(provider, /<div className="audio-player-timeline">[\\s\\S]*?<div className="audio-section-slot" \\/>[\\s\\S]*?<div className="audio-player-controls">/u);\n  assert.match(companion, /document\\.querySelector<HTMLElement>\\("\\.audio-section-slot"\\)/u);',
    '  assert.match(provider, /audio-player-time-current[\\s\\S]*?audio-section-inline-slot[\\s\\S]*?audio-player-time-duration/u);\n  assert.match(companion, /document\\.querySelector<HTMLElement>\\("\\.audio-section-inline-slot"\\)/u);\n  assert.doesNotMatch(provider, /className="audio-section-slot"/u);',
)
old_keyboard = '''test("Settings and question-choice overlays support keyboard dismissal and focus lifecycle", () => {\n  assert.match(provider, /settingsDetailsRef/u);\n  assert.match(provider, /details\\.open = false/u);\n  assert.match(provider, /event\\.key !== "Escape"/u);\n  assert.match(provider, /document\\.addEventListener\\("pointerdown", handlePointerDown\\)/u);\n  assert.match(companion, /document\\.body\\.style\\.overflow = "hidden"/u);\n  assert.match(companion, /event\\.key !== "Tab"/u);\n  assert.match(companion, /questionChoiceTriggerRef\\.current\\?\\.focus\\(\\)/u);\n  assert.match(companion, /ref=\\{questionDialogRef\\}/u);\n});'''
new_keyboard = '''test("Settings and anchored question-choice menu support dismissal and focus lifecycle", () => {\n  assert.match(provider, /settingsDetailsRef/u);\n  assert.match(provider, /details\\.open = false/u);\n  assert.match(provider, /event\\.key !== "Escape"/u);\n  assert.match(provider, /document\\.addEventListener\\("pointerdown", handlePointerDown\\)/u);\n  assert.doesNotMatch(companion, /document\\.body\\.style\\.overflow = "hidden"/u);\n  assert.doesNotMatch(companion, /event\\.key !== "Tab"/u);\n  assert.doesNotMatch(companion, /audio-question-choice-backdrop/u);\n  assert.match(companion, /audio-question-choice-popover/u);\n  assert.match(companion, /role="menu"/u);\n  assert.match(companion, /window\\.addEventListener\\("scroll", handleViewportChange, true\\)/u);\n  assert.match(companion, /questionChoiceTriggerRef\\.current\\?\\.focus\\(\\)/u);\n  assert.match(companion, /ref=\\{questionDialogRef\\}/u);\n});'''
if old_keyboard in contract:
    contract = contract.replace(old_keyboard, new_keyboard)
elif 'anchored question-choice menu' not in contract:
    raise SystemExit('question-choice contract block not found')

# Add hierarchy assertions and remove brittle old flat-row literal if present.
contract = contract.replace('assert.match(companion, /className=\\{isCurrent \\? "is-current" : undefined\\}/u);', 'assert.match(companion, /audio-section-list-l1/u);')
anchor = 'test("Section popover has explicit ownership, dismissal, focus return, and Settings exclusion", () => {'
hierarchy_test = '''test("Section menu renders canonical L1 and nested L2 navigation", () => {\n  assert.match(companion, /chapter\\.children\\.map\\(\\(child\\) =>/u);\n  assert.match(companion, /audio-section-list-l1/u);\n  assert.match(companion, /audio-section-list-l2/u);\n  assert.match(companion, /audio-section-sublist/u);\n  assert.match(companion, /seekChapter\\(child\\)/u);\n  assert.match(companion, /playerSecondsForChapter\\(child\\)/u);\n  assert.match(companion, /currentPositionChapter\\?\\.l2/u);\n});\n\n'''
if hierarchy_test.strip() not in contract:
    contract = contract.replace(anchor, hierarchy_test + anchor, 1)
contract_path.write_text(contract)

# Add runtime QA for anchored question menu using a real visible button as the anchor and a real catalog question source.
qa = qa_path.read_text()
anchor = 'async function desktopQa() {\n'
helper = r'''async function openQuestionChoiceMenu(page, label) {
  const question = await page.evaluate(async () => {
    const response = await fetch("/audio/snac/catalog.json", { cache: "no-cache" });
    const catalog = await response.json();
    const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
    const source = entries.find((entry) => entry.kind === "question-set" && Number.isInteger(entry.questionStart));
    if (!source) return null;
    const questionId = `${String(source.questionStart).padStart(3, "0")}`;
    return { sourceId: source.id, questionId: `${source.chapterLabel ?? ""}-Q${questionId}`.replace(/^\s*-/, "") };
  });
  if (!question?.sourceId) throw new Error(`${label}: no question-set source for menu QA`);
  const anchor = page.locator(".audio-player-title");
  await anchor.focus();
  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent("em-board-question-audio-choice", { detail }));
  }, question);
  const menu = page.locator(".audio-question-choice-popover");
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  const labels = await menu.locator("button").allTextContents();
  const bodyOverflow = await page.locator("body").evaluate((el) => getComputedStyle(el).overflow);
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) {
    throw new Error(`${label}: anchored question menu outside viewport ${JSON.stringify({ box, viewport })}`);
  }
  if (labels.map((value) => value.trim()).join("|") !== "完整音檔|只播放本題") {
    throw new Error(`${label}: question menu labels wrong ${JSON.stringify(labels)}`);
  }
  if (bodyOverflow === "hidden") throw new Error(`${label}: anchored menu must not lock body scroll`);
  if (await page.locator(".audio-question-choice-backdrop").count()) throw new Error(`${label}: legacy full-screen question backdrop still rendered`);
  return { box, labels, bodyOverflow };
}

'''
if helper.strip() not in qa:
    qa = qa.replace(anchor, helper + anchor, 1)

# Screenshot menu on desktop before compacting.
desktop_anchor = '  await shot(page, "03c-desktop-longest-l1-inline.png");\n'
desktop_extra = '''  report.desktop.questionMenu = await openQuestionChoiceMenu(page, "desktop");\n  await shot(page, "03d-desktop-question-audio-menu.png");\n  await page.keyboard.press("Escape");\n'''
if desktop_extra.strip() not in qa:
    qa = qa.replace(desktop_anchor, desktop_anchor + desktop_extra, 1)

# Screenshot menu on each mobile viewport while expanded.
mobile_anchor = '  await shot(page, `08-mobile-${key}-expanded.png`);\n'
mobile_extra = '''  report.mobile[key].questionMenu = await openQuestionChoiceMenu(page, `mobile-${key}`);\n  await shot(page, `08c-mobile-${key}-question-audio-menu.png`);\n  await page.keyboard.press("Escape");\n'''
if mobile_extra.strip() not in qa:
    qa = qa.replace(mobile_anchor, mobile_anchor + mobile_extra, 1)
qa_path.write_text(qa)
