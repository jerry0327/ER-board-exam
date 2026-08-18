import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings and both reading surfaces share independent explanation edition and depth preferences", async () => {
  const [mode, hook, app, dialog, sheet, reader, practice] = await Promise.all([
    readFile(new URL("../app/lib/explanation-mode.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-explanation-preferences.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/learning-data-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/question-sheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/practice-view.impl.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(hook, /em-board-explanation-pack-v2/);
  assert.match(hook, /return "original"/);
  assert.match(hook, /em-board-explanation-mode-v2/);
  assert.match(hook, /value === "raw"/);
  assert.match(hook, /let memoryPack: ExplanationPackId = "original"/u);
  assert.match(hook, /let memoryMode: ExplanationMode = "full"/u);
  assert.match(hook, /\(\) => "original:full"/u);
  assert.match(hook, /value === "quick" \|\| value === "full" \|\| value === "standard" \|\| value === "raw" \? value : "full"/u);
  assert.match(hook, /modeValue === "quick" \|\| modeValue === "standard" \|\| modeValue === "raw" \? modeValue : "full"/u);
  assert.match(mode, /if \(mode === "raw"\) return markdown/);
  assert.match(hook, /const setSelection = useCallback/);
  assert.match(hook, /localStorage\.setItem\(PACK_KEY, nextPackId\)[\s\S]*localStorage\.setItem\(MODE_KEY, nextMode\)/);
  assert.match(app, /useExplanationPreferences\(\)/);
  assert.match(app, /rawDraftMode=\{rawDraftEnabled\}/);
  assert.match(app, /explanationPreferences\.mode !== "raw"/);
  assert.match(app, /explanationMode === "raw"\) setExplanationMode\("full"\)/u);
  assert.match(app, /activeExplanationMode[\s\S]{0,180}: "full"/u);
  assert.match(dialog, /<legend>詳解版本<\/legend>/);
  assert.match(dialog, /explanationPacks/);
  assert.match(dialog, /rawDraftEnabled \? \[\.\.\.explanationModes, rawExplanationMode\] : explanationModes/);
  assert.match(dialog, /在詳解與學習指引的閱讀程度中加入「進階內容」/);
  assert.doesNotMatch(dialog, /Markdown 原稿|使用原始稿模式/);
  assert.match(reader, /onExplanationSelectionChange/);
  assert.match(reader, /<ReadingVariantSelector/);
  assert.match(dialog, /dialogRef/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /previousFocusRef/);
  assert.match(reader, /resolveExplanation\(item, effectiveExplanationPack\)/);
  assert.match(reader, /requestedPackId: "original", resolvedPackId: "original", mode: "full"/u);
  assert.match(practice, /resolveExplanation\(question, explanationPack\)/);
  assert.match(practice, /explanationForMode\(currentExplanation\.markdown, explanationMode\)/);
  assert.match(practice, /explanationRaw=\{explanationMode === "raw"\}/);
  assert.match(sheet, /<pre className="guide-raw-source"><code>\{activeExplanation\}<\/code><\/pre>/);

  const editions = reader.match(/const explanationEditionOptions[\s\S]*?\n\];/)?.[0] ?? "";
  assert.match(editions, /label: "精要詳解"/);
  assert.match(editions, /label: "詳細詳解"/);
  assert.doesNotMatch(editions, /學習指引/);
  assert.equal((editions.match(/label: "(?:精要|詳細)詳解"/g) ?? []).length, 2);

  const selectorUse = reader.match(/<ReadingVariantSelector[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(selectorUse, /editionOptions=\{explanationEditionOptions\}/);
  assert.match(selectorUse, /depthOptions=\{explanationDepthOptions\}/);
  assert.match(selectorUse, /ariaLabel="詳解版本與閱讀程度選擇器"/);
  assert.match(reader, /rawDraftMode \? \[\.\.\.defaultReadingDepthOptions, rawExplanationDepthOption\] : defaultReadingDepthOptions/);
  assert.match(reader, /if \(next\.depth === "raw" && !rawDraftMode\) return/);
  assert.match(reader, /explanationRaw=\{displayedRaw\}/);
});
