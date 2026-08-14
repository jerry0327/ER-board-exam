import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [guide, reader, annotationDrawer, annotationTools, markdown, notebook, route, annotationSource, css] = await Promise.all([
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/annotation-drawer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/notebook-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/annotation-source.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("guide and detailed reader use one complete annotation pipeline and right-side drawer", () => {
  for (const view of [guide, reader]) {
    assert.match(view, /import ContentAnnotationTools(?:, \{ type ContentAnnotationSource \})? from "\.\.\/components\/content-annotation-tools"/u);
    assert.match(view, /<ContentAnnotationTools/u);
  }
  assert.match(annotationTools, /import AnnotationDrawer from "\.\/annotation-drawer"/u);
  assert.match(annotationTools, /import MarkdownContent from "\.\/markdown-content"/u);
  assert.match(annotationTools, /<AnnotationDrawer[\s\S]*?open=\{panelOpen\}/u);
  assert.doesNotMatch(guide, /import AnnotationDrawer/u);
  assert.doesNotMatch(guide, /<AnnotationDrawer/u);
  assert.match(annotationDrawer, /createPortal\(/u);
  assert.match(annotationDrawer, /document\.body/u);
  assert.match(annotationDrawer, /className="annotation-panel-backdrop"/u);
  assert.match(annotationDrawer, /className="annotation-panel drawer-panel"/u);
  assert.match(annotationDrawer, /useDialogFocus\(open, panelRef, onClose\)/u);
  assert.match(annotationDrawer, /role="dialog"/u);
  assert.match(annotationDrawer, /aria-modal="true"/u);
});

test("guide never inserts a separate note card or bespoke note editor into article flow", () => {
  assert.doesNotMatch(guide, /guide-note-panel/u);
  assert.doesNotMatch(guide, /notePanelRef/u);
  assert.doesNotMatch(guide, /appendChapterNote/u);
  assert.doesNotMatch(guide, /addGuideExcerptToNotes/u);
  assert.doesNotMatch(guide, /onSaveChapterNote/u);
  assert.doesNotMatch(guide, /maxLength=\{12000\}/u);
  assert.doesNotMatch(css, /\.guide-note-panel\b/u);
});

test("guide tables and every supported heading level enter the shared pending-excerpt editor", () => {
  assert.match(markdown, /markdownHeadingSection\(normalized, start, end, level, headingRanges\)/u);
  assert.match(markdown, /markdown\.slice\(start, end\)\.trim\(\)/u);
  assert.match(markdown, /label="表格"/u);
  for (const label of ["主標題", "標題", "次標題", "次次標題"]) assert.match(markdown, new RegExp(`"${label}"`, "u"));
  assert.match(guide, /<MarkdownContent markdown=\{markdown\} variant="guide" documentTitle=\{selectedChapter\.title\} onAddToNotes=\{setPendingExcerpt\}/u);
  assert.match(guide, /pendingExcerpt=\{pendingExcerpt\}/u);
  assert.match(guide, /onExcerptHandled=\{\(\) => setPendingExcerpt\(null\)\}/u);
  assert.match(guide, /contentKey=\{`\$\{annotationResourceId\}:\$\{effectivePackId\}:\$\{annotationMode\}:\$\{visibleGuide \? \(selectedContentHash \?\? "ready"\) : "loading"\}`\}/u);
  assert.match(annotationTools, /kind: "excerpt"/u);
  assert.match(annotationTools, /quote: pendingExcerpt\.markdown/u);
  assert.match(annotationTools, /<MarkdownContent markdown=\{editing\.quote\} variant="annotation"/u);
  assert.match(annotationTools, /source\.kind === "guide" && editing\.kind === "question_note"[\s\S]{0,220}<MarkdownContent markdown=\{editing\.body\} variant="annotation"/u);
  assert.match(notebook, /<MarkdownContent markdown=\{annotation\.quote\} variant="annotation"/u);
  assert.match(notebook, /guideSource[\s\S]{0,180}<MarkdownContent markdown=\{annotation\.body\} variant="annotation"/u);
});

test("the visible Guide chapter H1 reuses the shared block action and returns to that visible title", () => {
  assert.match(markdown, /export function AnnotationBlockAction/u);
  assert.match(guide, /import MarkdownContent, \{ AnnotationBlockAction \} from "\.\.\/components\/markdown-content"/u);
  assert.match(guide, /firstMarkdownH1Excerpt\(markdown, selectedChapter\?\.title \?\? ""\)/u);
  assert.match(guide, /data-content-annotation-companion=\{chapterTitleExcerpt \? annotationResourceId : undefined\}/u);
  assert.match(guide, /data-annotation-anchor=\{chapterTitleExcerpt\?\.sourceAnchor\}/u);
  assert.match(guide, /data-annotation-block-key=\{chapterTitleExcerpt \? annotationBlockKey\(chapterTitleExcerpt\.block, chapterTitleExcerpt\.markdown\) : undefined\}/u);
  assert.match(guide, /<AnnotationBlockAction label="主標題" excerpt=\{chapterTitleExcerpt\} onAddToNotes=\{setPendingExcerpt\} \/>/u);
  assert.match(annotationTools, /companionElements\(resourceId\)\.find[\s\S]{0,160}\?\? elementWithData\(root, attribute, value\)/u);
  assert.match(css, /:is\(\.markdown-body, \.guide-chapter-header\) :is\(h1, h2, h3, h4\)\.has-annotation-action:hover > \.annotation-block-action/u);
  assert.match(css, /\.guide-article \.markdown-body > h1:first-child \{ display: none; \}/u);
});

test("guide delegates selection capture to the shared annotation implementation", () => {
  for (const forbidden of [
    /guideSelection/u,
    /data-guide-selection-root/u,
    /articleRef/u,
    /addGuideSelectionToNotes/u,
    /document\.addEventListener\("selectionchange"/u,
    /document\.addEventListener\("pointerup"/u,
    /document\.addEventListener\("keyup"/u,
    /createPortal\(/u,
  ]) assert.doesNotMatch(guide, forbidden);

  assert.match(guide, /data-content-annotation-root=\{annotationResourceId\}/u);
  assert.match(annotationTools, /\[data-content-annotation-root\], \[data-question-annotation-root\]/u);
  assert.match(annotationTools, /\.full-explanation \.guide-raw-source/u);
  assert.match(annotationTools, /container\.matches\("\.guide-raw-source"\)/u);
  assert.match(annotationTools, /root\.contains\(range\.startContainer\)/u);
  assert.match(annotationTools, /root\.contains\(range\.endContainer\)/u);
  assert.match(annotationTools, /closest\("\.katex, script, style, \[data-annotation-action\]"\)/u);
  assert.match(annotationTools, /quote\.length > 1200/u);
  assert.match(annotationTools, /document\.addEventListener\("selectionchange", capture\)/u);
  assert.match(annotationTools, /document\.addEventListener\("pointerup", capture\)/u);
  assert.match(annotationTools, /document\.addEventListener\("keyup", capture\)/u);
  assert.equal((annotationTools.match(/document\.addEventListener\("keyup", capture\)/gu) ?? []).length, 1, "shared selection capture must register keyup exactly once");
  assert.equal((annotationTools.match(/document\.removeEventListener\("keyup", capture\)/gu) ?? []).length, 1, "shared selection capture must clean up the one keyup listener");
  assert.match(annotationTools, /aria-label="將選取文字加入筆記"/u);
});

test("legacy guide notes use an app-level bulk pass, while all current guide notes use the annotation API", async () => {
  const [app, migrationHook] = await Promise.all([
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-guide-note-migration.ts", import.meta.url), "utf8"),
  ]);
  assert.match(annotationSource, /return `guide-tintinalli-\$\{String\(normalized\)\.padStart\(3, "0"\)\}`/u);
  assert.match(annotationSource, /return `h_gt\$\{source\.chapterId\}_\$\{normalizedScope\}_`/u);
  assert.match(annotationSource, /`q_\$\{resourceId\}`/u);
  assert.match(app, /useGuideNoteMigration\(\{/u);
  assert.match(migrationHook, /legacyGuideNoteMigrationPlan\(progress, annotations\)/u);
  assert.match(migrationHook, /executeLegacyGuideNoteMigration\([\s\S]{0,700}onClearLegacyNote\(chapterId, ""\)/u);
  assert.match(migrationHook, /guideNoteMigrationScopesAligned/u);
  assert.doesNotMatch(guide, /mergedBody|appendChapterNote/u);
  assert.doesNotMatch(guide, /onClearLegacyChapterNote|migratedLegacyNotesRef/u);
  assert.match(route, /\^guide-tintinalli-\(\?:00\[1-9\]\|0\[1-9\]\\d\|\[12\]\\d\{2\}\|30\[0-3\]\)\$/u);
  assert.match(route, /annotationBodyLimit\(value\.questionId, value\.kind\)/u);
  assert.match(route, /value\.kind === "excerpt" \? ANNOTATION_EXCERPT_QUOTE_LIMIT : 1200/u);
  assert.match(annotationTools, /editing\?\.kind === "question_note" && source\.kind === "guide" \? 12_000 : 4_000/u);
  assert.match(notebook, /guideSource && annotation\.kind === "question_note" \? 12_000 : 4_000/u);
});
