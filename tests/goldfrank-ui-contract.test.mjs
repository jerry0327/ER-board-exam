import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { annotationBodyLimit } from "../app/lib/annotation-body-limit.ts";
import {
  goldfrankGuideAnnotationResourceId,
  goldfrankGuideAnnotationScopePrefix,
  parseAnyGuideAnnotationResourceId,
  parseGoldfrankGuideAnnotationScope,
} from "../app/lib/annotation-source.ts";

test("Goldfrank annotations and progress use stable chapter identities", () => {
  assert.equal(goldfrankGuideAnnotationResourceId(1), "guide-goldfrank-001");
  assert.equal(goldfrankGuideAnnotationResourceId("140"), "guide-goldfrank-140");
  assert.equal(goldfrankGuideAnnotationResourceId(141), null);
  assert.deepEqual(parseAnyGuideAnnotationResourceId("guide-goldfrank-007"), {
    kind: "guide",
    textbook: "goldfrank",
    resourceKind: "chapter",
    chapter: 7,
    chapterId: "007",
    resourceId: "guide-goldfrank-007",
  });
  assert.equal(goldfrankGuideAnnotationScopePrefix("guide-goldfrank-007", "standard"), "h_gg007_standard_");
  assert.deepEqual(parseGoldfrankGuideAnnotationScope("h_gg007_standard_note-1"), {
    kind: "guide",
    textbook: "goldfrank",
    chapterId: "007",
    mode: "standard",
  });
  assert.equal(annotationBodyLimit("guide-goldfrank-007", "question_note"), 12_000);
  assert.equal(annotationBodyLimit("guide-goldfrank-007", "highlight"), 4_000);
  assert.equal(annotationBodyLimit("115B-Q001", "question_note"), 4_000);
});

test("Goldfrank reuses the chapter reader and is reachable across the guide workspace", async () => {
  const [reader, wrapper, learningGuide, hub, app, registry, preference, css] = await Promise.all([
    readFile(new URL("../app/views/ems-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/goldfrank-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/guide-hub-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/learning-source-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-reading-variant-preference.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  ]);

  assert.match(wrapper, /<EmsGuideView \{\.\.\.props\} sourceId="goldfrank" \/>/u);
  assert.match(reader, /goldfrank:[\s\S]*?audioTextbookId: "goldfrank"/u);
  assert.match(reader, /resource: selectedChapter[\s\S]*?textbookId: source\.audioTextbookId/u);
  assert.match(reader, /goldfrankGuideAnnotationResourceId/u);
  assert.match(reader, /goldfrankGuideAnnotationScopePrefix/u);
  assert.match(reader, /parseGoldfrankGuideAnnotationScope/u);
  assert.match(learningGuide, /requestedGuideModuleId === "goldfrank"/u);
  assert.match(learningGuide, /<GoldfrankGuideView/u);
  assert.match(hub, /guide-book-card goldfrank/u);
  assert.match(hub, /140 章 · 臨床與醫學毒理學/u);
  assert.match(app, /onOpenGoldfrank=\{openGoldfrankGuide\}/u);
  assert.match(app, /onSelectGoldfrankChapter=\{selectGoldfrankChapter\}/u);
  assert.match(registry, /goldfrank:[\s\S]*?title: "Goldfrank’s Toxicologic Emergencies"[\s\S]*?shortTitle: "Goldfrank 11e"/u);
  assert.match(registry, /goldfrank: "goldfrank"/u);
  assert.match(preference, /goldfrank: "em-board-goldfrank-guide-preferences-v1"/u);
  assert.match(css, /--site-guide-goldfrank: #c6a86c/u);
  assert.match(css, /\.audio-collection-goldfrank/u);
  const goldfrankRules = (css.match(/\.guide-book-card\.goldfrank[^{}]*\{[^}]*\}/gu) ?? []).join("\n");
  assert.match(goldfrankRules, /var\(--site-ink\)/u);
  assert.doesNotMatch(goldfrankRules, /\bblack\b/u);
});
