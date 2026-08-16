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
metric_old = '''    const title = box(".audio-section-inline-title");
    const left = box(".audio-player-time-current");
    const right = box(".audio-player-time-duration");
'''
metric_new = '''    const title = box(".audio-section-inline-title");
    const index = box(".audio-section-inline-index");
    const left = box(".audio-player-time-current");
    const right = box(".audio-player-time-duration");
'''
if metric_new not in qa:
    if metric_old not in qa:
        raise SystemExit('inline metric target not found')
    qa = qa.replace(metric_old, metric_new, 1)

return_old = '''    return { row, title, left, right, bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
'''
return_new = '''    const indexStyle = document.querySelector(".audio-section-inline-index") ? getComputedStyle(document.querySelector(".audio-section-inline-index")) : null;
    return {
      row,
      title,
      index,
      indexText: document.querySelector(".audio-section-inline-index")?.textContent?.trim() ?? "",
      indexDisplay: indexStyle?.display ?? null,
      left,
      right,
      bodyWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
'''
if return_new not in qa:
    if return_old not in qa:
        raise SystemExit('inline metric return target not found')
    qa = qa.replace(return_old, return_new, 1)

assert_old = '''  if (inlineMetrics.bodyWidth > inlineMetrics.viewportWidth + 1) throw new Error(`mobile ${key}: inline Section caused horizontal overflow ${JSON.stringify(inlineMetrics)}`);
'''
assert_new = '''  if (inlineMetrics.bodyWidth > inlineMetrics.viewportWidth + 1) throw new Error(`mobile ${key}: inline Section caused horizontal overflow ${JSON.stringify(inlineMetrics)}`);
  if (!inlineMetrics.index || inlineMetrics.indexDisplay === "none" || !/^\\d+\\/\\d+$/u.test(inlineMetrics.indexText)) {
    throw new Error(`mobile ${key}: Section index is not visibly preserved ${JSON.stringify(inlineMetrics)}`);
  }
'''
if assert_new not in qa:
    if assert_old not in qa:
        raise SystemExit('inline overflow assertion target not found')
    qa = qa.replace(assert_old, assert_new, 1)

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
