import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkdown } from "../app/lib/normalize-markdown.ts";

test("deduplicates exact reference title token sets while preserving the linked citation", () => {
  const result = normalizeMarkdown(`## 參考資料

- NCBI Bookshelf / StatPearls, Urinary Tract Infections In Children
- StatPearls, NCBI Bookshelf. Urinary Tract Infections In Children https://example.com/uti
- CDC — Potassium Iodide (KI) | Radiation Emergencies. https://example.com/ki
- Radiation Emergencies, Potassium Iodide KI — CDC
- World Health Organization, Heat and Health
- World Health Organization, Heat and Health [link](https://example.com/heat)`);
  assert.equal(result.match(/Urinary Tract Infections In Children/gu)?.length, 1);
  assert.equal(result.match(/Potassium Iodide/gu)?.length, 1);
  assert.match(result, /https:\/\/example\.com\/uti/);
  assert.match(result, /https:\/\/example\.com\/ki/);
  assert.equal(result.match(/World Health Organization, Heat and Health/gu)?.length, 1);
  assert.match(result, /\[link\]\(https:\/\/example\.com\/heat\)/);
});

test("does not merge references whose audience tokens differ", () => {
  const result = normalizeMarkdown(`## 參考資料

- CDC Recommendations for STIs — Children
- CDC Recommendations for STIs — Adults https://example.com/adults
- Guideline for Adults
- Guideline for Adults and Children https://example.com/family`);
  assert.match(result, /STIs — Children/);
  assert.match(result, /STIs — Adults/);
  assert.match(result, /Guideline for Adults\n/);
  assert.match(result, /Guideline for Adults and Children/);
});
