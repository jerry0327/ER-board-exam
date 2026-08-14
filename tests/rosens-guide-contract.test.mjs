import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rosensBibliography, rosensCatalogStats, rosensChapters, rosensImportContract } from "../app/lib/rosens-catalog.ts";
import { extractMarkdownOutline } from "../app/lib/markdown-heading.ts";

const hub = await readFile(new URL("../app/views/guide-hub-view.tsx", import.meta.url), "utf8");
const reader = await readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8");
const wrapper = await readFile(new URL("../app/views/learning-guide-view.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const siteCss = await readFile(new URL("../app/site.css", import.meta.url), "utf8");
const loader = await readFile(new URL("../app/lib/rosens-guides.ts", import.meta.url), "utf8");
const audioSummaries = await readFile(new URL("../app/lib/audio-summaries.ts", import.meta.url), "utf8");
const importer = await readFile(new URL("../scripts/import-rosens-guide-pack.mjs", import.meta.url), "utf8");
const guideReaderTools = await readFile(new URL("../app/components/guide-reader-tools.tsx", import.meta.url), "utf8");
const guideProgressFilter = await readFile(new URL("../app/components/guide-progress-filter.tsx", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/guides/rosens/manifest.json", import.meta.url), "utf8"));

test("uses the latest Rosen's 10e bibliographic record and a complete corrected catalog", () => {
  assert.equal(rosensBibliography.edition, "10th Edition");
  assert.equal(rosensBibliography.bibliographicYear, 2023);
  assert.equal(rosensBibliography.isbn, "978-0-323-75789-8");
  assert.equal(rosensCatalogStats.totalEntries, 208);
  assert.equal(rosensCatalogStats.coreChapters, 192);
  assert.equal(rosensCatalogStats.supplementalChapters, 0);
  assert.equal(rosensCatalogStats.onlineChapters, 16);
  assert.equal(rosensCatalogStats.importedChapters, 208);
  assert.deepEqual(rosensCatalogStats.readingDepths, ["quick", "standard", "full"]);
  assert.equal(new Set(rosensChapters.map((chapter) => chapter.id)).size, rosensChapters.length);
  assert.equal(rosensChapters.find((chapter) => chapter.id === "102")?.title, "Arthritis");
  assert.equal(rosensChapters.some((chapter) => chapter.id.toLowerCase() === "119b"), false);
  assert.equal(rosensChapters.find((chapter) => chapter.id === "e16")?.title, "Tactical Emergency Medical Support and Urban Search and Rescue");
  assert.equal(rosensImportContract.packId, "detailed");
  assert.deepEqual(Object.keys(rosensImportContract.modes), ["quick", "standard", "full"]);
});

test("imports all 208 Rosen's sources deterministically without inserting 119B", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.textbookId, "rosens");
  assert.equal(manifest.totalEntries, 208);
  assert.equal(manifest.importedChapters, 208);
  assert.equal(manifest.chapters.length, 208);
  assert.equal(manifest.chapters.every((chapter) => chapter.available), true);
  assert.equal(manifest.chapters.some((chapter) => chapter.id === "119b"), false);
  assert.deepEqual(manifest.chapters.slice(191, 194).map(({ id, sourceSequence }) => [id, sourceSequence]), [["192", 192], ["e01", 193], ["e02", 194]]);
  assert.deepEqual(Object.keys(manifest.chapters[0].modes), ["quick", "standard", "full"]);
  for (const chapter of manifest.chapters) {
    for (const mode of ["quick", "standard", "full"]) {
      assert.match(chapter.modes[mode].contentHash, /^[a-f0-9]{16}$/u);
      assert.match(chapter.modes[mode].sourceSha256, /^[a-f0-9]{64}$/u);
      assert.match(chapter.modes[mode].markdownPath, new RegExp(`/guides/rosens/detailed/${chapter.id}/${mode}\\.md$`, "u"));
    }
  }
  assert.match(importer, /sequence <= 192[\s\S]{0,120}`e\$\{String\(sequence - 192\)\.padStart\(2, "0"\)\}`/u);
  assert.doesNotMatch(importer, /manifestChapters\.splice|119B|119b/u);
  assert.match(loader, /actualIds\.some\(\(id, index\) => id !== expectedIds\[index\]\)/u);
  assert.match(loader, /unavailable\.length !== 0/u);
});

test("presents one art-directed learning library before entering any reader", () => {
  assert.match(wrapper, /!requestedTextbookId && !requestedResourceId/);
  assert.match(wrapper, /<GuideHubView/);
  assert.match(wrapper, /requestedTextbookId === "rosens"/);
  assert.match(hub, /Tintinalli’s[\s\S]*Rosen’s[\s\S]*AILS/u);
  assert.match(hub, /選擇學習指引/);
  assert.match(hub, /rosensCatalogStats\.importedChapters/u);
  assert.match(hub, /latestRosens \? `繼續 \$\{latestRosens\.label\}` : "從 Chapter 001 開始"/u);
  assert.match(hub, /resourceProgressMap/u);
  assert.match(hub, /source\.resourceKind !== "chapter"/u);
  assert.match(hub, /onOpenTintinalli\(tintinalliResource\)/u);
  assert.match(hub, /onOpenRosens\(rosensResource\)/u);
  assert.equal((hub.match(/<GuideOverviewLink /gu) ?? []).length, 2);
  assert.match(hub, /function GuideOverviewLink[\s\S]{0,320}<BookOpenText/u);
  assert.equal((hub.match(/className="guide-book-card (?:tintinalli|rosens)"/gu) ?? []).length, 2, "the original upper book-card visuals must remain intact");
  assert.equal((hub.match(/className="guide-book-card (?:tintinalli|rosens|ails)"/gu) ?? []).length, 3);
  assert.doesNotMatch(hub, /<section className="guide-overview-links"/u);
  assert.equal((hub.match(/className="guide-book-route guide-book-route-chapter"/gu) ?? []).length, 5);
  assert.doesNotMatch(hub, /guide-book-primary/u);
  assert.match(appShell, /latestGuideResourceReading/u);
  assert.match(appShell, /openRosensGuide\(String\(resource\)\)/u);
  assert.match(hub, /\u5b78\u7fd2\u5167\u5bb9/u);
  assert.match(hub, /\u8003\u984c\u5c0d\u7167\u6307\u5f15/u);
  assert.match(hub, /\u8003\u984c\u5c0d\u7167/u);
  assert.doesNotMatch(hub, /guide-hub-note|guide-hub-source/u);
  assert.match(css, /\.guide-book-grid \{[^}]*grid-template-columns: repeat\(2/);
});

test("keeps Rosen's to one guide version and provides the complete shared reader", () => {
  assert.doesNotMatch(reader, /單一完整指引版本/);
  assert.match(reader, /id: "quick", label: "速讀"/);
  assert.match(reader, /id: "standard", label: "普通"/);
  assert.match(reader, /id: "full", label: "完整版"/);
  assert.match(reader, /return stored === "quick" \|\| stored === "standard" \|\| stored === "full" \? stored : "full"/u);
  assert.match(reader, /defaultValue: "full" as RosensReadingDepth/u);
  assert.equal((reader.match(/id: "(?:quick|standard|full)", label:/g) ?? []).length, 3);
  assert.doesNotMatch(reader, /原始稿|精要學習指引/);
  assert.match(reader, /import ReadingVariantSelector,[\s\S]{0,120}from "\.\.\/components\/reading-variant-selector"/u);
  assert.match(reader, /import ReadingNextPrev from "\.\.\/components\/reading-next-prev"/u);
  assert.match(reader, /import \{ useReadingNavigation \} from "\.\.\/hooks\/use-reading-navigation"/u);
  assert.match(reader, /<ReadingVariantSelector/u);
  assert.equal((reader.match(/<ReadingNextPrev/gu) ?? []).length, 2);
  assert.match(guideReaderTools, /<ReadingNextPrev className="guide-toolbar-step-controls reading-toolbar-steps"/u);
  assert.doesNotMatch(reader, /data-reading-placeholder="true"/u);
  assert.match(reader, /loadRosensGuideManifest/u);
  assert.match(reader, /loadRosensGuideMarkdown/u);
  assert.match(reader, /const outline = extractedOutline;/u);
  assert.doesNotMatch(reader, /outlineStartsWithTitle|repeatedLeadTitle|has-repeated-lead-title/u);
  assert.doesNotMatch(siteCss, /\.guide-article\.has-repeated-lead-title/u);
  assert.doesNotMatch(css, /\.markdown-body strong\s*\{[^}]*color:\s*#[0-9a-f]{3,8}/iu);
  assert.match(reader, /<MarkdownContent markdown=\{markdown\} variant="guide" documentTitle=\{selectedChapter\.title\} onAddToNotes=\{setPendingExcerpt\}/u);
  assert.match(reader, /<ContentAnnotationTools/u);
  assert.match(reader, /<ReadingFontControls/u);
  assert.match(reader, /onOpenResource\(annotationResourceId, selectedContentHash\)/u);
  assert.match(reader, /onMarkResource\(annotationResourceId/u);
  assert.match(reader, /onBookmarkResource\(annotationResourceId/u);
  assert.match(reader, /<GuideReaderToolsPanel/u);
  assert.match(reader, /<GuideProgressFilter/u);
  assert.match(reader, /matchesGuideProgressFilter/u);
  assert.match(reader, /useLearningAudio\(\{[\s\S]{0,240}resource: \{ kind: "textbook-chapter", textbookId: "rosens", chapterId: selectedChapter\.id \}/u);
  assert.match(reader, /const openSelectedAudio = \(\) => \{\s*openChapterAudioPlayer\(\);\s*setMobileToolsOpen\(false\);/u);
  assert.match(reader, /onPointerDown=\{prepareChapterAudio\}/u);
  assert.match(audioSummaries, /const onlineMatch = \/\^e\(\\d\{1,2\}\)\$\/u\.exec\(normalized\)/u);
  assert.match(audioSummaries, /onlineSequence < 1 \|\| onlineSequence > 16/u);
  assert.match(reader, /<strong>\{selectedAudioActionLabel\}<\/strong>/u);
  assert.match(guideReaderTools, /稍後再讀[\s\S]{0,2200}標記讀完[\s\S]{0,2200}收藏[\s\S]{0,2200}progressActions\.annotationControl/u);
  assert.match(guideProgressFilter, /return progress\?\.readState === filter/u);
  assert.match(guideProgressFilter, /<option value="later">稍後閱讀<\/option>/u);
  assert.match(reader, /data-content-annotation-root=\{annotationResourceId\}/u);
  assert.doesNotMatch(reader, /rosens-depth-selector|rosens-placeholder-levels|<small>五分鐘<\/small>|<small>標準閱讀<\/small>|<small>完整閱讀<\/small>/u);
  assert.doesNotMatch(css, /\.rosens-(?:depth-selector|placeholder-levels)/u);
  assert.doesNotMatch(reader, /待匯入|上傳後|不生成|READING SPACE RESERVED/);
  assert.match(reader, /onOpenLibrary/);
});

test("keeps Rosen's first numbered major heading visible even when it repeats the catalog title", async () => {
  const markdown = await readFile(
    new URL("../public/guides/rosens/detailed/008/full.md", import.meta.url),
    "utf8",
  );
  const outline = extractMarkdownOutline(markdown);
  assert.equal(outline[0]?.level, 2);
  assert.equal(outline[0]?.label, "1. Fever in the Adult Patient");
});
