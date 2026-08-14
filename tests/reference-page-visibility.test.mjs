import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkdown } from "../app/lib/normalize-markdown.ts";

const markdown = `## 9. 參考資料

- Tintinalli’s Emergency Medicine, 9e, Section 7, CH.49 Acute Coronary Syndromes, print p.351, Table 49-4, Figure 49-13
- Tintinalli’s Emergency Medicine, 9e, Chapter 113 pages 710–714, Table 113-1
- Tintinalli’s Emergency Medicine, 9e, CH.224. Relevant print pages: pp.1426, 1429, 1432–1433.
- Section 17, CH.229 Hyperthyroidism and Thyroid Storm, print page starts at 1450; Figure 229-1
- Tintinalli’s Emergency Medicine, 9e, CH.216, print page range beginning around p.1376
- CH.233 Acquired Bleeding Disorders, print p1469–1470, Table 233-1
- 教材限制：已保守使用確認章節、print page 與段落內容。
- CH.29A Tracheal Intubation, p.187；succinylcholine 與 rocuronium。
- AHA/ASA guideline, page 19. https://example.com/page/19
`;

test("hides textbook page locators while preserving useful citation structure", () => {
  const result = normalizeMarkdown(markdown);
  assert.match(result, /Tintinalli’s Emergency Medicine/);
  assert.match(result, /Section 7/);
  assert.match(result, /CH\.49 Acute Coronary Syndromes/);
  assert.match(result, /Chapter 113/);
  assert.match(result, /Table 49-4/);
  assert.match(result, /Figure 49-13/);
  assert.match(result, /Figure 229-1/);
  assert.doesNotMatch(result, /print\s+(?:p|page)|pp?\.?\s*\d|pages?\s+710|1426|1432|1376|1450|1469/iu);
});

test("preserves non-textbook page citations and URLs", () => {
  const result = normalizeMarkdown(markdown);
  assert.match(result, /AHA\/ASA guideline, page 19/);
  assert.match(result, /https:\/\/example\.com\/page\/19/);
});

test("reference page hiding is idempotent", () => {
  const once = normalizeMarkdown(markdown);
  assert.equal(normalizeMarkdown(once), once);
});
