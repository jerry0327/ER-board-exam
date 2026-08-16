from pathlib import Path
import json

css_path = Path('app/site.css')
qa_path = Path('scripts/qa-original-player-skeleton.mjs')

css = css_path.read_text()
needle = '''  @media (max-width: 600px) {
    .audio-player-time-row {
'''
replacement = '''  @media (max-width: 600px) {
    .audio-section-inline-control .audio-section-inline-index {
      display: inline;
    }

    .audio-player-time-row {
'''
if replacement not in css:
    if needle not in css:
        raise SystemExit('mobile density media block not found')
    css = css.replace(needle, replacement, 1)
css_path.write_text(css)

qa = qa_path.read_text()
anchor = '''  report.mobile[key].expanded = await assertCenterline(page, `mobile-${key}`);
'''
assertion = '''  report.mobile[key].expanded = await assertCenterline(page, `mobile-${key}`);
  const inlineSectionState = await page.locator(".audio-section-inline-control").evaluate((control) => {
    const index = control.querySelector(".audio-section-inline-index");
    const title = control.querySelector(".audio-section-inline-title");
    const indexRect = index?.getBoundingClientRect() ?? null;
    const titleRect = title?.getBoundingClientRect() ?? null;
    const style = index ? getComputedStyle(index) : null;
    return {
      indexText: index?.textContent?.trim() ?? "",
      indexDisplay: style?.display ?? null,
      indexWidth: indexRect?.width ?? 0,
      titleText: title?.textContent?.trim() ?? "",
      titleWidth: titleRect?.width ?? 0,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  report.mobile[key].inlineSection = inlineSectionState;
  if (inlineSectionState.indexDisplay === "none" || inlineSectionState.indexWidth <= 0 || !/^\\d+\\/\\d+$/u.test(inlineSectionState.indexText)) {
    throw new Error(`mobile ${key}: Section index is not visibly preserved ${JSON.stringify(inlineSectionState)}`);
  }
  if (inlineSectionState.documentWidth > inlineSectionState.viewportWidth + 1) {
    throw new Error(`mobile ${key}: inline Section caused horizontal overflow ${JSON.stringify(inlineSectionState)}`);
  }
'''
if assertion not in qa:
    if anchor not in qa:
        raise SystemExit('mobile QA anchor not found')
    qa = qa.replace(anchor, assertion, 1)
qa_path.write_text(qa)

# Report the longest real Traditional-Chinese L1 title from all deployed locale bundles.
bundle_dir = Path('public/subtitles-title-locales/bundles')
longest = None
for path in sorted(bundle_dir.glob('*.titles.json')):
    data = json.loads(path.read_text())
    for source, entry in data.get('entries', {}).items():
        for section_id, localized in entry.get('titles', {}).items():
            if '-l2-' in section_id or not section_id.startswith('l1-'):
                continue
            title = str(localized.get('zh-TW', '')).strip()
            if not title:
                continue
            candidate = {
                'title': title,
                'length': len(title),
                'source': source,
                'section_id': section_id,
                'bundle': path.name,
            }
            if longest is None or candidate['length'] > longest['length']:
                longest = candidate
Path('qa-longest-l1.json').write_text(json.dumps(longest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(longest, ensure_ascii=False))
