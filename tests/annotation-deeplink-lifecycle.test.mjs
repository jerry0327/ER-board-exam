import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [tools, reader, guide, app] = await Promise.all([
  readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
]);

test("the shared annotation drawer can reopen the same deep link without a remount", () => {
  assert.match(tools, /const requestKey = requestedAnnotationId \? `\$\{source\.resourceId\}:\$\{requestedAnnotationId\}` : null/u);
  assert.match(tools, /if \(!requestKey\) \{[\s\S]{0,240}handledRequestedAnnotationRef\.current = null;[\s\S]{0,80}return;/u);
  assert.match(tools, /handledRequestedAnnotationRef\.current === requestKey/u);
  assert.match(tools, /handledRequestedAnnotationRef\.current = requestKey/u);
  assert.match(tools, /\[requestedAnnotationId, showPanel, source\.resourceId, sourceAnnotations\]/u);
});

test("closing either deep-linked drawer returns the parent route to its annotation-free hash", () => {
  assert.match(tools, /onOpenChange\?\.\(panelOpen\)/u);
  assert.match(reader, /onAnnotationOpenChange: \(open: boolean\) => void/u);
  assert.match(reader, /const handleAnnotationPanelOpenChange = useCallback\(\(open: boolean\) => \{[\s\S]{0,120}onAnnotationOpenChange\(open\)/u);
  assert.match(reader, /<ContentAnnotationTools[\s\S]{0,600}onOpenChange=\{handleAnnotationPanelOpenChange\}/u);
  assert.match(guide, /onAnnotationOpenChange: \(open: boolean\) => void/u);
  assert.match(guide, /<ContentAnnotationTools[\s\S]{0,600}onOpenChange=\{onAnnotationOpenChange\}/u);
  assert.match(app, /const handleAnnotationOpenChange = useCallback\(\(open: boolean\) => \{[\s\S]{0,180}if \(open \|\| !requestedAnnotationId \|\| !requestedQuestionId\) return;[\s\S]{0,120}setRequestedAnnotationId\(null\)/u);
  assert.match(app, /requestedTextbookId === "tintinalli"[\s\S]{0,180}\? guideHash\(Number\(requestedQuestionId\)\)[\s\S]{0,100}: textbookGuideHash\(requestedTextbookId, requestedQuestionId\)/u);
  assert.match(app, /window\.history\.replaceState\(null, "", href\)/u);
  assert.match(app, /window\.history\.replaceState\(null, "", readerHash\(requestedQuestionId\)\)/u);
  assert.equal((app.match(/onAnnotationOpenChange=\{handleAnnotationOpenChange\}/gu) ?? []).length, 2);
});

test("missing or deleted deep links wait for annotation loading, then return to the base route", () => {
  assert.match(tools, /if \(!requestKey \|\| annotationStatus === "loading"\) return/u);
  assert.match(tools, /sourceAnnotations\.some\(\(item\) => item\.id === requestedAnnotationId\)/u);
  assert.match(tools, /window\.setTimeout\(\(\) => \{[\s\S]{0,160}onOpenChange\?\.\(false\);[\s\S]{0,40}\}, 700\)/u);
  assert.match(reader, /annotationStatus=\{annotationStatus\}/u);
  assert.match(guide, /annotationStatus=\{progressStatus === "loading" \|\| Boolean\(selectedProgress\?\.note\.trim\(\)\) \? "loading" : annotationStatus\}/u);
});

test("guide annotation source restoration is temporary and never writes saved pack or depth", () => {
  assert.match(guide, /const requestedGuideScope = parseGuideAnnotationScope\(requestedAnnotationId\)/u);
  assert.match(guide, /const effectivePackId = deepLinkScope\?\.packId \?\? packId/u);
  assert.match(guide, /const effectiveReadingMode: GuideReadingMode = deepLinkScope/u);
  assert.match(guide, /loadStudyGuideMarkdown\(selectedChapter, effectivePackId, loadedReadingMode\)/u);
  assert.match(guide, /value=\{guideVariant\(effectivePackId, effectiveReadingMode, rawActive\)\}/u);
  assert.doesNotMatch(guide, /requestedAnnotationId\?\.match/u);
  assert.doesNotMatch(guide, /if \(nextPack !== packId\) setPackId/u);
});

test("reader and guide unlock their shared reading selectors after the deep-link drawer closes", () => {
  for (const view of [reader, guide]) {
    assert.match(view, /const annotationReadingLocked = Boolean\(requestedAnnotationId\)/u);
    assert.match(view, /<ReadingVariantSelector[\s\S]{0,500}locked=\{annotationReadingLocked\}/u);
    assert.match(view, /annotationReadingLocked && <p className="reader-preference-lock"/u);
  }
});
