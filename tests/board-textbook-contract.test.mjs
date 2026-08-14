import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, reader, practice, questionSheet, boardView, traceItems, markdownRenderer, learningGuide, hub, tools, codec, importer, tracePanel, css] = await Promise.all([
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/practice-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/question-sheet.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/board-textbook-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/board-trace-items.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/markdown-content.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/guide-hub-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/lib/static-content-codec.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/import-board-textbook.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/components/traceability-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
]);

test("source-guide traceability is enabled only by the primary detailed Reader", () => {
  assert.match(app, /activeNav === "詳解閱讀"[\s\S]*?<ReaderView[\s\S]*?onOpenBoardTrace=\{openBoardGuide\}/u);
  assert.match(reader, /traceTargets=\{onOpenBoardTrace \? traceTargets : \[\]\}/u);
  assert.match(questionSheet, /data-board-question-trace-target=\{traceTargets\.includes\("stem"\)/u);
  assert.doesNotMatch(practice, /traceTargets|onOpenBoardTraceTarget|data-board-question-trace-target/u);
});

test("the textbook reuses shared reader chrome and one delegated trace surface", () => {
  assert.match(learningGuide, /requestedGuideModuleId === "board"[\s\S]*?<BoardTextbookView/u);
  assert.match(boardView, /<GuideReaderToolbar/u);
  assert.match(boardView, /<GuideReaderToolsPanel/u);
  assert.equal((boardView.match(/<TraceContextRail/gu) ?? []).length, 1);
  assert.equal((boardView.match(/<TraceabilityPanel/gu) ?? []).length, 1);
  assert.match(boardView, /onPointerOver=\{handleTracePointer\}/u);
  assert.match(boardView, /const coarsePointer = useMediaQueryMatch\("\(hover: none\) and \(pointer: coarse\)"\)/u);
  assert.match(boardView, /open=\{!coarsePointer && traceMode && !annotationOpen && currentTraceCount > 0\}/u);
  assert.match(boardView, /const handleTraceClick[\s\S]*?chooseTraceElement\(element\);[\s\S]*?setTracePanelOpen\(true\);/u);
  assert.match(boardView, /querySelectorAll<HTMLElement>\("\[data-board-trace-node\]"\)/u);
  assert.doesNotMatch(boardView, /\.map\([^\n]{0,120}<TraceContextRail/u);
  assert.match(traceItems, /function collectQuestionTraceGroups/u);
  assert.match(traceItems, /return hit\.canonicalQuestionId \?\? hit\.questionId/u);
  assert.match(traceItems, /export function reconcileBoardTraceHits/u);
  assert.match(traceItems, /relatedHits\.filter\(\(hit\) => !directAtoms\.has\(hit\.canonicalAtomId\)\)/u);
  assert.match(traceItems, /relatedGroups\.get\(groupKey\)/u);
  assert.doesNotMatch(traceItems, /target:\s*\{\s*kind:\s*"option"/u);
  assert.match(boardView, /reconcileBoardTraceHits\(directHits, relatedHits, questionById\)/u);
  assert.match(boardView, /countUnit="題"/u);
  assert.match(boardView, /item\.matchesQuestionStem \? onOpenReaderTrace\(questionId, "stem"\) : onOpenReader\(questionId\)/u);
  assert.match(learningGuide, /onOpenReader=\{guideProps\.onOpenReader\}/u);
  assert.match(tracePanel, /className="traceability-question-item"/u);
  assert.match(tracePanel, /className="traceability-match-rows"/u);
  assert.match(tracePanel, /label: "直接考到"/u);
  assert.match(tracePanel, /label: item\.directMatches \? "同題延伸" : "延伸位置"/u);
  assert.match(tracePanel, /className="traceability-option-target"/u);
  assert.match(tracePanel, /onSelectOption\(questionId, optionKey, item\)/u);
  assert.match(tracePanel, /\u958b\u555f \$\{questionId\} \u9078\u9805 \$\{optionKey\} \u7684\u8a73\u89e3\u8207\u4f86\u6e90\u5c0d\u7167/u);
  assert.match(reader, /ariaLabel="\u984c\u76ee\u4f86\u6e90\u5c0d\u7167"/u);
  assert.match(reader, /\u7684\u8003\u984c\u6eaf\u6e90/u);
  assert.match(reader, /directLabel="\u6700\u7cbe\u6e96\u4f4d\u7f6e" relatedLabel="\u88dc\u5145\u6bb5\u843d"/u);
  assert.match(reader, /reconcileBoardTraceLocations\(activeTraceLocations\)/u);
  assert.match(reader, /loadBoardTraceLocatorIndex\(unitCode\)/u);
  assert.match(reader, /function boardTraceSectionTitle\(unitCode: string, human\?: BoardTraceHumanLocator\)/u);
  assert.match(reader, /`\u55ae\u5143 \$\{unitCode\}\u30fb\u7b2c \$\{human\.sectionOrdinal\} \u7bc0`/u);
  assert.match(reader, /boardTraceSectionTitle\(location\.unitCode, human\)/u);
  assert.match(reader, /`\u7b2c \$\{human\.paragraphOrdinal\} \u6bb5\$\{sentence \? `\u30fb\u7cbe\u6e96\u5b9a\u4f4d\u7b2c \$\{sentence\} \u53e5` : ""\}`/u);
  assert.doesNotMatch(reader, /\u7ae0\u7bc0\s*\$\{location\.sectionId\}/u);
  assert.doesNotMatch(reader, /excerpt:\s*location\.sectionId/u);
  assert.doesNotMatch(tracePanel, /\u8a73\u89e3\u8207\u539f\u6587\u5c0d\u7167/u);
  assert.doesNotMatch(reader, /\u6559\u79d1\u66f8\u539f\u6587/u);
  assert.match(tools, /traceAction\?: ReactNode/u);
  assert.match(tools, /traceControl\?: ReactNode/u);
  assert.match(css, /\.traceability-option-targets/u);
  assert.match(css, /\.traceability-option-target/u);
  assert.match(css, /\.traceability-option-target\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*999px;/su);
});

test("reference trace rows keep their human paragraph and sentence locator visible", () => {
  assert.match(
    tracePanel,
    /\{item\.locator && \(\s*<span className="traceability-item-locator">\{item\.locator\}<\/span>/u,
  );
  assert.doesNotMatch(
    tracePanel,
    /item\.locator && item\.target\.kind !== "reference"/u,
  );
});

test("the reader loads human locators only for an open trace panel and keeps partial successes", () => {
  const effectStart = reader.indexOf("const requestVersion = ++traceLocatorRequestRef.current");
  const effectEnd = reader.indexOf("const directTraceItems", effectStart);
  assert.notEqual(effectStart, -1);
  assert.notEqual(effectEnd, -1);
  const locatorEffect = reader.slice(effectStart, effectEnd);

  assert.match(reader, /const visibleTracePanelOpen = tracePanelOpen && Boolean\(questionTrace\) && !traceLoading;/u);
  assert.match(locatorEffect, /if \(!visibleTracePanelOpen \|\| !traceQuestionId\)/u);
  assert.match(locatorEffect, /Promise\.allSettled\(unitCodes\.map/u);
  assert.match(locatorEffect, /result\.status === "fulfilled" \? \[result\.value\] : \[\]/u);
  assert.doesNotMatch(locatorEffect, /Promise\.all\(/u);
});

test("closing the trace panel or changing questions invalidates stale locator requests without a state loop", () => {
  const effectStart = reader.indexOf("const requestVersion = ++traceLocatorRequestRef.current");
  const effectEnd = reader.indexOf("const directTraceItems", effectStart);
  const locatorEffect = reader.slice(effectStart, effectEnd);

  assert.match(reader, /const traceLocatorRequestRef = useRef\(0\);/u);
  assert.match(locatorEffect, /traceLocatorRequestRef\.current !== requestVersion/u);
  assert.match(locatorEffect, /traceLocatorRequestRef\.current \+= 1;/u);
  assert.match(locatorEffect, /current\.size === 0 \? current : new Map\(\)/u);
  assert.match(locatorEffect, /\[reconciledTraceLocations, traceQuestionId, visibleTracePanelOpen\]/u);
  assert.doesNotMatch(locatorEffect, /\[[^\]]*traceLocatorIndexes/u);
});

test("the reader keeps one visible unit title without altering later headings", () => {
  assert.match(boardView, /<MarkdownContent markdown=\{markdown\} variant="board" documentTitle=\{selectedUnit\.title\} onAddToNotes=\{setPendingExcerpt\}/u);
  assert.match(boardView, /pendingExcerpt=\{pendingExcerpt\}/u);
  assert.match(markdownRenderer, /node\?\.position\?\.start\?\.offset === headingRanges\[0\]\?\.start/u);
  assert.match(markdownRenderer, /markdownHeadingMatchesTitle\(heading, documentTitle\)/u);
  assert.equal((markdownRenderer.match(/if \(isLeadingDocumentTitle\(node, heading\)\) return null/gu) ?? []).length, 4);
  assert.match(markdownRenderer, /const headingId = headingSlug\(heading\)/u);
});

test("the fourth learning-guide card and q11 singleton runtime packs are declared", () => {
  assert.match(hub, /guide-book-card board/u);
  assert.match(hub, /歷屆考題[\s\S]*對照指引/u);
  assert.match(codec, /brotliQuality = 11/u);
  assert.match(codec, /boardRuntimeSingletonPattern/u);
  assert.match(codec, /guides\\\/board\\\/units/u);
  assert.match(importer, /if \(!sentenceDirectIds\.size && !sentenceRelatedIds\.size\) continue;/u);
  assert.match(importer, /traceableSentenceCount/u);
  assert.match(importer, /forwardSupplementedReverseHits/u);
  assert.match(css, /--site-guide-board:/u);
  assert.match(css, /\.traceability-panel/u);
  assert.match(css, /\.trace-layer-enabled \.board-trace-node/u);
});
