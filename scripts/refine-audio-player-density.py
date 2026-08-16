from pathlib import Path

provider_path = Path('app/components/audio-player-provider.tsx')
companion_path = Path('app/components/audio-section-companion.tsx')
css_path = Path('app/site.css')
qa_path = Path('scripts/qa-original-player-skeleton.mjs')

provider = provider_path.read_text()
old_time = '''                <div>\n                  <span>{formatTime(position)}</span>\n                  <span>{formatTime(duration)}</span>\n                </div>\n              </div>\n\n              <div className="audio-section-slot" />\n'''
new_time = '''                <div className="audio-player-time-row">\n                  <span className="audio-player-time-current">{formatTime(position)}</span>\n                  <div className="audio-section-inline-slot" />\n                  <span className="audio-player-time-duration">{formatTime(duration)}</span>\n                </div>\n              </div>\n'''
if old_time in provider:
    provider = provider.replace(old_time, new_time, 1)
elif 'audio-section-inline-slot' not in provider:
    raise SystemExit('provider timeline target not found')
provider_path.write_text(provider)

companion = companion_path.read_text()
companion = companion.replace('  type AudioChapterL1,\n', '  type AudioChapterL1,\n  type AudioChapterL2,\n', 1) if 'type AudioChapterL2' not in companion else companion
companion = companion.replace('  chapter: AudioChapterL1,\n)', '  chapter: AudioChapterL1 | AudioChapterL2,\n)', 1)
companion = companion.replace('  function seekChapter(chapter: AudioChapterL1) {', '  function seekChapter(chapter: AudioChapterL1 | AudioChapterL2) {', 1)
companion = companion.replace('document.querySelector<HTMLElement>(".audio-section-slot")', 'document.querySelector<HTMLElement>(".audio-section-inline-slot")')

old_current = '''  const currentChapter = activeBundle\n    ? currentAudioChapterAt(activeBundle.runtime.metadata, player.position)?.l1 ?? null\n    : null;\n  const currentIndex = currentChapter ? chapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1;\n'''
new_current = '''  const currentPositionChapter = activeBundle\n    ? currentAudioChapterAt(activeBundle.runtime.metadata, player.position)\n    : null;\n  const currentChapter = currentPositionChapter?.l1 ?? null;\n  const currentL2 = currentPositionChapter?.l2 ?? null;\n  const currentIndex = currentChapter ? chapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1;\n  const l2Count = chapters.reduce((total, chapter) => total + chapter.children.length, 0);\n'''
if old_current in companion:
    companion = companion.replace(old_current, new_current, 1)
elif 'const currentPositionChapter' not in companion:
    raise SystemExit('current chapter target not found')

start = companion.find('  const sectionPortal = activeBundle && detailsTarget')
end = companion.find('\n\n  const sectionListPortal =', start)
if start < 0 or end < 0:
    raise SystemExit('section portal target not found')
new_portal = '''  const sectionPortal = activeBundle && detailsTarget\n    ? createPortal(\n      <div className="audio-section-companion audio-section-companion-inline">\n        <button\n          ref={sectionToggleRef}\n          type="button"\n          className="audio-section-toggle audio-section-inline-control"\n          aria-expanded={sectionOpen}\n          aria-haspopup="dialog"\n          aria-controls="audio-player-section-panel"\n          aria-label={`目前段落 ${currentIndex >= 0 ? currentIndex + 1 : 1} / ${Math.max(1, chapters.length)}：${currentTitle ?? "段落"}；開啟段落選單`}\n          onClick={toggleSectionPanel}\n        >\n          <span className="audio-section-inline-index">{activeScope ? "本題" : `${currentIndex >= 0 ? currentIndex + 1 : 1}/${Math.max(1, chapters.length)}`}</span>\n          <strong className="audio-section-inline-title">{currentTitle ?? "段落"}</strong>\n          <ChevronDown aria-hidden="true" />\n        </button>\n      </div>,\n      detailsTarget,\n    )\n    : null;'''
companion = companion[:start] + new_portal + companion[end:]

old_list_start = companion.find('        <ol className="audio-section-list">')
old_list_end = companion.find('        </ol>', old_list_start)
if old_list_start < 0 or old_list_end < 0:
    raise SystemExit('section list target not found')
old_list_end += len('        </ol>')
new_list = '''        <ol className="audio-section-list">\n          {chapters.map((chapter, index) => {\n            const startSeconds = markers[index]?.playerStartSeconds ?? playerSecondsForChapter(chapter);\n            const isCurrent = chapter.id === currentChapter?.id;\n            return (\n              <li key={chapter.id} className="audio-section-l1-item">\n                <button\n                  type="button"\n                  className={`audio-section-list-l1 ${isCurrent ? "is-current" : ""}`.trim()}\n                  aria-current={isCurrent ? "true" : undefined}\n                  onClick={() => seekChapter(chapter)}\n                >\n                  <span className="audio-section-list-dot" aria-hidden="true" />\n                  <strong>{sectionLabel(activeBundle, chapter)}</strong>\n                  <time>{formatTime(startSeconds)}</time>\n                </button>\n                {chapter.children.length > 0 && (\n                  <ol className="audio-section-sublist" aria-label={`${sectionLabel(activeBundle, chapter)} 子段落`}>\n                    {chapter.children.map((child) => {\n                      const isCurrentL2 = child.id === currentL2?.id;\n                      return (\n                        <li key={child.id}>\n                          <button\n                            type="button"\n                            className={`audio-section-list-l2 ${isCurrentL2 ? "is-current-l2" : ""}`.trim()}\n                            aria-current={isCurrentL2 ? "location" : undefined}\n                            onClick={() => seekChapter(child)}\n                          >\n                            <span className="audio-section-list-branch" aria-hidden="true">↳</span>\n                            <strong>{sectionLabel(activeBundle, child)}</strong>\n                            <time>{formatTime(playerSecondsForChapter(child))}</time>\n                          </button>\n                        </li>\n                      );\n                    })}\n                  </ol>\n                )}\n              </li>\n            );\n          })}\n        </ol>'''
companion = companion[:old_list_start] + new_list + companion[old_list_end:]
companion = companion.replace('<span>{chapters.length} 段</span>', '<span>{chapters.length} 主段 · {l2Count} 子段</span>', 1)
companion_path.write_text(companion)

css = css_path.read_text()
marker = '@layer site-utilities {\n'
if marker not in css:
    raise SystemExit('site utilities layer not found')
block = r'''  /* Audio player density: timeline owns Section context; controls keep touch targets without ornamental frames. */
  .audio-player-timeline > input[type="range"] {
    background: transparent;
    border: 0;
    box-shadow: none;
    margin: 0;
    min-height: 18px;
    padding: 0;
  }

  .audio-player-timeline > input[type="range"]:focus-visible {
    outline: 0;
  }

  .audio-player-time-row {
    align-items: center;
    display: grid;
    gap: 7px;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    margin-top: 1px;
    min-height: 30px;
    padding: 0;
  }

  .audio-player-time-row > :is(.audio-player-time-current, .audio-player-time-duration) {
    color: var(--site-muted);
    font-family: var(--site-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .audio-section-inline-slot,
  .audio-section-companion-inline {
    min-width: 0;
    width: 100%;
  }

  .audio-section-inline-control {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--site-radius);
    color: var(--site-ink);
    display: grid;
    gap: 5px;
    grid-template-columns: max-content minmax(0, 1fr) 14px;
    min-height: 28px;
    padding: 2px 5px;
    text-align: center;
    width: 100%;
  }

  .audio-section-inline-control:hover,
  .audio-section-inline-control:focus-visible,
  .audio-section-inline-control[aria-expanded="true"] {
    background: var(--site-surface-hover);
  }

  .audio-section-inline-index {
    color: var(--site-primary);
    font-family: var(--site-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 760;
    white-space: nowrap;
  }

  .audio-section-inline-title {
    color: var(--site-ink-soft);
    font-size: 12px;
    font-weight: 690;
    line-height: 1.22;
    min-width: 0;
    overflow-wrap: anywhere;
    text-wrap: balance;
    white-space: normal;
  }

  .audio-section-inline-control > svg {
    color: var(--site-primary);
    height: 13px;
    width: 13px;
  }

  .audio-player-utility {
    background: transparent;
    border: 0;
    border-radius: var(--site-radius);
    box-shadow: none;
    color: var(--site-ink-soft);
  }

  .audio-player-utility:hover:not(:disabled),
  .audio-player-utility:focus-visible,
  .audio-player-settings[open] > .audio-player-utility {
    background: var(--site-surface-hover);
    border: 0;
    color: var(--site-primary);
  }

  .audio-section-l1-item + .audio-section-l1-item {
    border-top: 1px solid var(--site-line);
  }

  .audio-section-list > .audio-section-l1-item > .audio-section-list-l1 {
    border-bottom: 0;
  }

  .audio-section-sublist {
    list-style: none;
    margin: 0;
    padding: 0 0 5px;
  }

  .audio-section-sublist .audio-section-list-l2 {
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--site-ink-soft);
    display: grid;
    gap: 7px;
    grid-template-columns: 18px minmax(0, 1fr) max-content;
    min-height: 38px;
    padding: 5px 12px 5px 27px;
    text-align: left;
    width: 100%;
  }

  .audio-section-sublist .audio-section-list-l2:hover,
  .audio-section-sublist .audio-section-list-l2:focus-visible,
  .audio-section-sublist .audio-section-list-l2.is-current-l2 {
    background: var(--site-surface-hover);
    color: var(--site-ink);
  }

  .audio-section-list-branch {
    color: var(--site-line-strong);
    font-family: var(--site-mono);
    font-size: 12px;
    text-align: center;
  }

  .audio-section-sublist strong {
    font-size: 12px;
    font-weight: 620;
    line-height: 1.35;
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .audio-section-sublist time {
    color: var(--site-muted);
    font-family: var(--site-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .audio-player-time-row {
      gap: 5px;
      min-height: 30px;
    }

    .audio-section-inline-control {
      gap: 4px;
      padding-inline: 3px;
    }

    .audio-section-inline-title {
      font-size: 12px;
      line-height: 1.18;
    }

    .audio-section-sublist .audio-section-list-l2 {
      padding-left: 22px;
    }
  }

'''
if '/* Audio player density: timeline owns Section context;' not in css:
    css = css.replace(marker, marker + block, 1)
css_path.write_text(css)

qa = qa_path.read_text()
old_assert = '''  const slotIndex = await page.locator(".audio-player-details").evaluate((details) => [...details.children].map((el) => el.className).indexOf("audio-section-slot"));\n  const timelineIndex = await page.locator(".audio-player-details").evaluate((details) => [...details.children].map((el) => el.className).indexOf("audio-player-timeline"));\n  const controlsIndex = await page.locator(".audio-player-details").evaluate((details) => [...details.children].map((el) => el.className).indexOf("audio-player-controls"));\n  if (!(timelineIndex >= 0 && slotIndex === timelineIndex + 1 && controlsIndex > slotIndex)) {\n    throw new Error(`${label}: Section slot is not between timeline and controls`);\n  }\n'''
new_assert = '''  const inlineSlot = page.locator(".audio-player-time-row .audio-section-inline-slot");\n  if (await inlineSlot.count() !== 1) throw new Error(`${label}: inline Section slot missing from timeline time row`);\n  if (await page.locator(".audio-player-details > .audio-section-slot").count()) throw new Error(`${label}: obsolete standalone Section row remains`);\n  const timeRow = await page.locator(".audio-player-time-row").evaluate((row) => {\n    const children = [...row.children];\n    return children.map((el) => el.className);\n  });\n  if (!String(timeRow[0]).includes("audio-player-time-current") || !String(timeRow[1]).includes("audio-section-inline-slot") || !String(timeRow[2]).includes("audio-player-time-duration")) {\n    throw new Error(`${label}: timeline time/Section/time order is wrong: ${JSON.stringify(timeRow)}`);\n  }\n'''
if old_assert in qa:
    qa = qa.replace(old_assert, new_assert, 1)
elif 'inline Section slot missing' not in qa:
    raise SystemExit('QA original slot assertion target not found')

insert_after = '  await shot(page, "03-desktop-sections.png");\n'
extra = '''  const l2Buttons = page.locator(".audio-section-list-l2");\n  report.desktop.l2Count = await l2Buttons.count();\n  if (report.desktop.l2Count < 1) throw new Error("desktop: hierarchical Section menu has no L2 entries");\n  const longestL1 = await page.locator(".audio-section-list-l1 strong").evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? "").sort((a, b) => b.length - a.length)[0] ?? "");\n  const l1Buttons = page.locator(".audio-section-list-l1");\n  const l1Count = await l1Buttons.count();\n  let longestIndex = 0;\n  let longestLength = -1;\n  for (let i = 0; i < l1Count; i += 1) {\n    const text = (await l1Buttons.nth(i).locator("strong").textContent())?.trim() ?? "";\n    if (text.length > longestLength) { longestLength = text.length; longestIndex = i; }\n  }\n  await l1Buttons.nth(longestIndex).click();\n  await page.waitForTimeout(140);\n  const inlineTitle = page.locator(".audio-section-inline-title");\n  const inlineText = (await inlineTitle.textContent())?.trim() ?? "";\n  if (inlineText !== longestL1) throw new Error(`desktop: inline L1 is not complete; expected ${longestL1}, got ${inlineText}`);\n  const inlineFit = await inlineTitle.evaluate((el) => ({\n    clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,\n    overflow: getComputedStyle(el).overflow, textOverflow: getComputedStyle(el).textOverflow, whiteSpace: getComputedStyle(el).whiteSpace,\n  }));\n  report.desktop.longestL1 = { text: inlineText, ...inlineFit };\n  if (inlineFit.scrollWidth > inlineFit.clientWidth + 1 || inlineFit.scrollHeight > inlineFit.clientHeight + 1 || inlineFit.textOverflow === "ellipsis") {\n    throw new Error(`desktop: complete L1 does not fit safely ${JSON.stringify(report.desktop.longestL1)}`);\n  }\n  await shot(page, "03c-desktop-longest-l1-inline.png");\n'''
if extra.strip() not in qa:
    qa = qa.replace(insert_after, insert_after + extra, 1)

mobile_anchor = '  report.mobile[key].expanded = await assertCenterline(page, `mobile-${key}`);\n'
mobile_extra = '''  const inlineLayout = await page.locator(".audio-player-time-row").evaluate((row) => {\n    const r = row.getBoundingClientRect();\n    const title = row.querySelector(".audio-section-inline-title");\n    const left = row.querySelector(".audio-player-time-current");\n    const right = row.querySelector(".audio-player-time-duration");\n    const rb = (el) => { const b = el?.getBoundingClientRect(); return b ? { left: b.left, right: b.right, width: b.width, height: b.height } : null; };\n    return { row: { left: r.left, right: r.right, width: r.width, height: r.height }, title: rb(title), left: rb(left), right: rb(right), bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };\n  });\n  report.mobile[key].inlineSection = inlineLayout;\n  if (inlineLayout.bodyWidth > inlineLayout.viewportWidth + 1 || !inlineLayout.title || !inlineLayout.left || !inlineLayout.right || inlineLayout.left.right > inlineLayout.title.left + 1 || inlineLayout.title.right > inlineLayout.right.left + 1) {\n    throw new Error(`mobile ${key}: inline Section/time layout overflow ${JSON.stringify(inlineLayout)}`);\n  }\n'''
if mobile_extra.strip() not in qa:
    qa = qa.replace(mobile_anchor, mobile_anchor + mobile_extra, 1)
qa_path.write_text(qa)
