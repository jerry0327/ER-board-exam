import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentToolsUrl = new URL("../app/components/content-annotation-tools.tsx", import.meta.url);

test("reader delegates annotations to the shared source-aware implementation", async () => {
  const [tools, reader] = await Promise.all([
    readFile(contentToolsUrl, "utf8"),
    readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(reader, /import ContentAnnotationTools, \{ type ContentAnnotationSource \} from "\.\.\/components\/content-annotation-tools"/u);
  assert.doesNotMatch(reader, /ReaderAnnotationTools|reader-annotation-tools/u);
  assert.match(tools, /export type ContentAnnotationSource/u);
  assert.match(tools, /kind: "question" \| "guide"/u);
  assert.match(tools, /contentKey: string/u);
  assert.match(tools, /explanationPack\?: ExplanationPackId/u);
  assert.match(tools, /function scopedIdMatches\(source: ContentAnnotationSource, id: string\)/u);
  assert.match(tools, /annotationExplanationPack\(id\) === source\.explanationPack/u);
  assert.match(tools, /if \(readerScope\) return id\.startsWith\(source\.annotationPrefix\)/u);
  assert.match(tools, /\[contentKey, requestedAnnotationId, source\.resourceId, sourceAnnotations\]/u);
  assert.match(reader, /annotationPrefix: readerAnnotationScopePrefix\(resolvedPackId, displayedExplanationMode\)/u);
  assert.match(reader, /explanationPack: resolvedPackId/u);
  assert.match(reader, /contentKey=\{`\$\{question\.id\}:\$\{resolvedPackId\}:\$\{displayedExplanationMode\}`\}/u);
  assert.match(reader, /data-content-annotation-root=\{question\.id\}/u);
  assert.match(reader, /reading-content-swap/u);
});

test("shared annotation overlays escape sticky reading rails and keep every action visible", async () => {
  const [tools, css] = await Promise.all([
    readFile(contentToolsUrl, "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(tools, /createPortal\(overlays, document\.body\)/u);
  assert.match(tools, /selection-action-buttons/u);
  assert.match(tools, /aria-label="將選取文字加入筆記"/u);
  assert.match(tools, /document\.addEventListener\("selectionchange", capture\)/u);
  assert.match(tools, /document\.addEventListener\("pointerup", capture\)/u);
  assert.match(tools, /document\.addEventListener\("keyup", capture\)/u);
  assert.match(tools, /\[data-content-annotation-root\], \[data-question-annotation-root\]/u);
  assert.match(tools, /\.full-explanation \.guide-raw-source/u);
  assert.match(tools, /container\.matches\("\.guide-raw-source"\)/u);
  assert.match(css, /\.selection-action-buttons\s*\{[^}]*display:\s*flex;/su);
});

test("saved highlights use a visible half-height marker in every reading theme", async () => {
  const [tools, siteCss] = await Promise.all([
    readFile(contentToolsUrl, "utf8"),
    readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  ]);

  assert.equal((siteCss.match(/--site-study-highlight-wash:/gu) ?? []).length, 3);
  assert.equal((siteCss.match(/--site-study-highlight-stroke:/gu) ?? []).length, 3);
  assert.match(siteCss, /:root\s*\{[\s\S]*?--site-study-highlight-wash:[^;]+;[\s\S]*?--site-study-highlight-stroke:[^;]+;/u);
  assert.match(siteCss, /html\[data-theme="dark"\]\s*\{[\s\S]*?--site-study-highlight-wash:[^;]+;[\s\S]*?--site-study-highlight-stroke:[^;]+;/u);
  assert.match(siteCss, /html\[data-theme-mode="black"\]\s*\{[\s\S]*?--site-study-highlight-wash:[^;]+;[\s\S]*?--site-study-highlight-stroke:[^;]+;/u);

  const highlightRule = /::highlight\(study-highlights\)\{([^}]+)\}/u.exec(tools)?.[1] ?? "";
  assert.match(highlightRule, /background-color:var\(--site-study-highlight-wash\)/u);
  assert.match(highlightRule, /color:inherit/u);
  assert.match(highlightRule, /text-decoration-color:var\(--site-study-highlight-stroke\)/u);
  assert.match(highlightRule, /text-decoration-line:underline/u);
  assert.match(highlightRule, /text-decoration-skip-ink:none/u);
  assert.doesNotMatch(highlightRule, /--warning-bg/u);

  const thickness = Number.parseFloat(/text-decoration-thickness:([\d.]+)em/u.exec(highlightRule)?.[1] ?? "NaN");
  const offset = Number.parseFloat(/text-underline-offset:([\d.-]+)em/u.exec(highlightRule)?.[1] ?? "NaN");
  assert.ok(thickness >= 0.45 && thickness <= 0.58, "saved marker should cover about half the glyph height");
  assert.ok(offset <= -0.2 && offset >= -0.38, "saved marker should sit behind the lower half of the glyphs");

  assert.match(
    tools,
    /@media \(forced-colors:active\)\{::highlight\(study-highlights\)\{background-color:Highlight;color:HighlightText;text-decoration:none\}\}/u,
  );
});

test("tables and heading levels are saved and rendered as backward-compatible markdown excerpts", async () => {
  const [types, tools, markdown, question, reader, guide, notebook, hook, route, css] = await Promise.all([
    readFile(new URL("../app/lib/types.ts", import.meta.url), "utf8"),
    readFile(contentToolsUrl, "utf8"),
    readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/question-sheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/notebook-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-annotations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(types, /AnnotationKind = "question_note" \| "highlight" \| "excerpt"/u);
  assert.match(markdown, /markdownHeadingSection\(normalized, start, end, level, headingRanges\)/u);
  assert.match(markdown, /markdown\.slice\(start, end\)\.trim\(\)/u);
  assert.match(markdown, /label="表格"/u);
  for (const label of ["主標題", "標題", "次標題", "次次標題"]) assert.match(markdown, new RegExp(`"${label}"`, "u"));
  assert.match(markdown, /data-annotation-action/u);
  assert.match(markdown, /<span className="sr-only">加入筆記<\/span>/u);
  assert.match(tools, /closest\("\.katex, script, style, \[data-annotation-action\]"\)/u);
  assert.match(tools, /kind: "excerpt"/u);
  assert.match(tools, /quote: pendingExcerpt\.markdown/u);
  assert.match(tools, /<MarkdownContent markdown=\{editing\.quote\} variant="annotation"/u);
  assert.match(question, /onAddExplanationToNotes/u);
  assert.match(reader, /pendingExcerpt=\{pendingExcerpt\}/u);
  assert.match(reader, /onAddExplanationToNotes=\{annotationsEnabled \? setPendingExcerpt : undefined\}/u);
  assert.match(guide, /onAddToNotes=\{setPendingExcerpt\}/u);
  assert.match(notebook, /<MarkdownContent markdown=\{annotation\.quote\} variant="annotation"/u);
  assert.match(notebook, /guideSource[\s\S]{0,180}<MarkdownContent markdown=\{annotation\.body\} variant="annotation"/u);
  assert.match(hook, /value\.kind === "excerpt" \? "excerpt"/u);
  assert.match(route, /value\.kind === "excerpt" \? ANNOTATION_EXCERPT_QUOTE_LIMIT : 1200/u);
  assert.match(css, /\.annotation-block-action/u);
  assert.match(css, /not\(\.annotation-block-action\):active/u);
  assert.match(css, /\.has-annotation-action:hover\s*>\s*\.annotation-block-action/u);
  assert.match(css, /\.option-analysis-heading\.has-annotation-action\s*>\s*\.annotation-block-action/u);
  assert.match(css, /\.notebook-excerpt-preview/u);
  assert.match(css, /\.notebook-excerpt-preview \{ max-height: min\(420px, 55dvh\); \}/u);
});

test("anonymous visitors keep shared reader and guide notes in their own browser", async () => {
  const hook = await readFile(new URL("../app/hooks/use-annotations.ts", import.meta.url), "utf8");
  assert.match(hook, /LOCAL_ACCOUNT_KEY = "anonymous-device"/u);
  assert.match(hook, /identityResponse\.status === 401\) \{ await activateLocalState\(\); return; \}/u);
  assert.match(hook, /accountKey === LOCAL_ACCOUNT_KEY/u);
});
