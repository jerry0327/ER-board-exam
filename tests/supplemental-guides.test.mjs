import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeStudyGuideMarkdown } from "../app/lib/study-guide-markdown.ts";
import { parseGuideMarkdown } from "../scripts/lib/study-guide-reading-modes.mjs";
import {
  loadSupplementalGuideCatalog,
  loadSupplementalGuideMarkdown,
  normalizeSupplementalGuideMarkdownTitle,
  parseSupplementalGuideManifest,
  resolveSupplementalGuideEntry,
} from "../app/lib/supplemental-guides.ts";
import { rosensSupplementalSectionId, rosensSupplementalSectionKeys } from "../app/lib/supplemental-guide-ids.ts";

const tintinalliManifest = JSON.parse(await readFile(new URL("../public/guides/tintinalli/manifest.json", import.meta.url), "utf8"));
const rosensManifest = JSON.parse(await readFile(new URL("../public/guides/rosens/supplemental-manifest.json", import.meta.url), "utf8"));

function decodedBrotliText(value) {
  return new Response(value, {
    headers: { "content-encoding": "br", "content-type": "application/octet-stream" },
  });
}

function decodedBrotliJson(value) {
  return decodedBrotliText(JSON.stringify(value));
}

function learnerOpening(markdown) {
  const { nodes } = parseGuideMarkdown(markdown);
  const selected = [];
  let majorHeadings = 0;
  let nodesAfterFirstMajorHeading = 0;
  for (const item of nodes) {
    if (item.heading?.depth === 2) {
      majorHeadings += 1;
      if (majorHeadings > 1) break;
    }
    if (majorHeadings === 1 && item.heading?.depth >= 3) break;
    if (majorHeadings === 1 && item.heading?.depth !== 2) {
      nodesAfterFirstMajorHeading += 1;
      if (nodesAfterFirstMajorHeading > 8) break;
    }
    selected.push(item.raw);
  }
  return selected.join("\n\n");
}

test("publishes typed whole-book resources with complete Tintinalli Section coverage", async () => {
  const tintinalli = parseSupplementalGuideManifest("tintinalli", tintinalliManifest);
  const rosens = parseSupplementalGuideManifest("rosens", rosensManifest);

  assert.equal(tintinalli.entries.length, 27);
  assert.equal(tintinalli.title, "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide");
  assert.equal(tintinalli.entries[0].id, "overview");
  assert.equal(tintinalli.entries[0].title, "Whole-Book Overview");
  assert.deepEqual(tintinalli.entries.slice(1).map((entry) => entry.section), Array.from({ length: 26 }, (_, index) => index + 1));
  assert.deepEqual(tintinalli.entries.slice(1).map((entry) => entry.id), Array.from({ length: 26 }, (_, index) => `section-${String(index + 1).padStart(2, "0")}`));
  assert.equal(rosens.entries.length, 28);
  assert.equal(rosens.title, "Rosen’s Emergency Medicine: Concepts and Clinical Practice");
  assert.equal(rosens.entries[0].id, "overview");
  assert.equal(rosens.entries[0].title, "Whole-Book Overview");
  assert.deepEqual(rosens.entries.slice(1).map((entry) => entry.section), rosensSupplementalSectionKeys);
  assert.deepEqual(rosens.entries.slice(1).map((entry) => entry.id), rosensSupplementalSectionKeys.map(rosensSupplementalSectionId));
  assert.equal(resolveSupplementalGuideEntry(tintinalli, "missing").id, "overview");
  assert.equal(
    normalizeSupplementalGuideMarkdownTitle(tintinalli.entries[0], "# 舊標題\n\n正文"),
    "# Tintinalli’s Emergency Medicine: A Comprehensive Study Guide — Whole-Book Overview\n\n正文",
  );

  for (const catalog of [tintinalli, rosens]) {
    for (const entry of catalog.entries) {
      const buffer = await readFile(new URL(`../public${entry.markdownPath}`, import.meta.url));
      const hash = createHash("sha256").update(buffer).digest("hex");
      assert.equal(buffer.length, entry.bytes, `${catalog.textbookId}/${entry.id} byte count changed`);
      assert.equal(hash, entry.sourceSha256, `${catalog.textbookId}/${entry.id} SHA-256 changed`);
      assert.equal(hash.slice(0, 16), entry.contentHash);
    }
  }
});

test("rejects incomplete or mismatched supplemental manifests", () => {
  const missingSection = structuredClone(tintinalliManifest);
  missingSection.sections.pop();
  assert.throws(() => parseSupplementalGuideManifest("tintinalli", missingSection), /Tintinalli Section 指南不完整/u);
  const missingRosensSection = structuredClone(rosensManifest);
  missingRosensSection.sections.pop();
  assert.throws(() => parseSupplementalGuideManifest("rosens", missingRosensSection), /Rosen’s Section 指南不完整/u);
  assert.throws(() => parseSupplementalGuideManifest("rosens", tintinalliManifest), /目錄版本不正確/u);
});

test("learner-facing supplemental guides remove source-production language", async () => {
  const tintinalli = parseSupplementalGuideManifest("tintinalli", tintinalliManifest);
  const rosens = parseSupplementalGuideManifest("rosens", rosensManifest);
  const forbidden = /上傳(?:檔案|版本|之|\s*Section)|已建立索引|逐像素|已抽查|完整審閱範圍|原始\s*PDF|PDF\s*未內含|未逐篇驗證|不在本次審閱範圍|未能可靠存取或審閱/iu;

  for (const entry of [...tintinalli.entries, ...rosens.entries]) {
    const markdown = await readFile(new URL(`../public${entry.markdownPath}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      learnerOpening(sanitizeStudyGuideMarkdown(markdown)),
      forbidden,
      `${entry.textbookId}/${entry.id} exposed production language at the opening`,
    );
  }
});

test("deduplicates manifest and Markdown requests while retrying failed catalogs", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  let failRosensOnce = true;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, cache: init?.cache });
    if (url === "/guides/tintinalli/manifest.json") return decodedBrotliJson(tintinalliManifest);
    if (url === "/guides/rosens/supplemental-manifest.json") {
      if (failRosensOnce) {
        failRosensOnce = false;
        return new Response("temporarily unavailable", { status: 503 });
      }
      return decodedBrotliJson(rosensManifest);
    }
    if (url.startsWith("/guides/tintinalli/whole-book.md?v=")) return decodedBrotliText("# 測試指南\n\n正文");
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const [first, second] = await Promise.all([
      loadSupplementalGuideCatalog("tintinalli"),
      loadSupplementalGuideCatalog("tintinalli"),
    ]);
    assert.strictEqual(first, second);
    assert.equal(calls.filter((call) => call.url === "/guides/tintinalli/manifest.json").length, 1);
    assert.equal(calls.find((call) => call.url === "/guides/tintinalli/manifest.json")?.cache, "no-cache");

    const overview = resolveSupplementalGuideEntry(first, "overview");
    const [markdownA, markdownB] = await Promise.all([
      loadSupplementalGuideMarkdown(overview),
      loadSupplementalGuideMarkdown(overview),
    ]);
    assert.equal(markdownA, markdownB);
    assert.match(markdownA, /^# Tintinalli’s Emergency Medicine: A Comprehensive Study Guide — Whole-Book Overview$/mu);
    const markdownCalls = calls.filter((call) => call.url.startsWith("/guides/tintinalli/whole-book.md?v="));
    assert.equal(markdownCalls.length, 1);
    assert.equal(markdownCalls[0].cache, "force-cache");
    assert.match(markdownCalls[0].url, new RegExp(`\\?v=${overview.contentHash}$`, "u"));

    const retried = await loadSupplementalGuideCatalog("rosens");
    assert.equal(retried.entries.length, 28);
    assert.strictEqual(await loadSupplementalGuideCatalog("rosens"), retried);
    assert.equal(calls.filter((call) => call.url === "/guides/rosens/supplemental-manifest.json").length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the supplemental reader reuses the shared paper workspace and focus lifecycle", async () => {
  const [view, css] = await Promise.all([
    readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(view, /onSelectResource: \(resourceId: string\) => void/u);
  assert.match(view, /onOpenChapterLibrary: \(\) => void/u);
  assert.match(view, /onOpenChapter: \(chapter: number \| string\) => void/u);
  assert.match(view, /onOpenLibrary: \(\) => void/u);
  assert.match(view, /requestedAnnotationId\?: string \| null/u);
  assert.match(view, /annotations: StudyAnnotation\[\]/u);
  assert.match(view, /onAnnotationOpenChange: \(open: boolean\) => void/u);
  assert.match(view, /onUpsert: \(draft: ContentAnnotationDraft\)/u);
  assert.match(view, /activeCatalog\.entries\.map/u);
  assert.match(view, /loadSupplementalGuideCatalog\(textbookId\)/u);
  assert.match(view, /loadSupplementalGuideMarkdown\(selectedEntry\)/u);
  assert.match(view, /sanitizeStudyGuideMarkdown\(visibleContent\.markdown\)/u);
  assert.match(view, /<MarkdownContent markdown=\{markdown\} variant="guide" documentTitle=\{supplementalGuideDocumentTitle\(selectedEntry\)\} onAddToNotes=\{setPendingExcerpt\}/u);
  assert.match(view, /<ContentAnnotationTools/u);
  assert.match(view, /guide-\$\{textbookId\}-\$\{selectedEntry\.id\}/u);
  assert.match(view, /guideSupplementalAnnotationScopePrefix\(annotationResourceId, "full"\)/u);
  assert.match(view, /data-content-annotation-root=\{annotationResourceId\}/u);
  assert.match(view, /extractMarkdownOutline\(markdown\)/u);
  assert.match(view, /<ReadingFontControls/u);
  assert.match(view, /<ReadingNextPrev/u);
  assert.match(view, /progressMap: Map<string, GuideResourceProgressRecord>/u);
  assert.match(view, /onOpenResource\(annotationResourceId, selectedEntry\.contentHash\)/u);
  assert.match(view, /onMarkResource\(annotationResourceId/u);
  assert.match(view, /onBookmarkResource\(annotationResourceId/u);
  assert.match(view, /className="guide-page supplemental-guide-page"/u);
  assert.match(view, /className="supplemental-guide-chapter-entry"[\s\S]{0,420}onClick=\{onOpenChapterLibrary\}/u);
  assert.match(view, /className="guide-rail-current supplemental-guide-chapter-rail"[\s\S]{0,260}onClick=\{onOpenChapterLibrary\}/u);
  assert.match(view, /supplementalGuideStartingChapter\(selectedEntry\)/u);
  assert.doesNotMatch(view, /supplemental-guide-chapter-link|chapterActionLabel/u);
  assert.match(css, /\.supplemental-guide-chapter-entry\s*>\s*\.primary-button\s*\{[^}]*min-height:\s*68px;[^}]*width:\s*100%;/su);
  assert.equal((view.match(/useOverlayFocusManagement\(\{/gu) ?? []).length, 3);
  assert.match(view, /aria-hidden=\{narrow && !libraryOpen\}/u);
  assert.match(view, /inert=\{narrow && !libraryOpen \? true : undefined\}/u);
  assert.match(view, /open=\{compactTools && mobileToolsOpen\}/u);
  assert.match(view, /hidden=\{compactTools && !mobileToolsOpen\}/u);
  assert.match(view, /initialFocusSelector: "\[data-overlay-close\]"/u);
  assert.doesNotMatch(view, /textbookGuideHash/u);

  const supplementalCss = css.match(/\.supplemental-guide-library[\s\S]*?\.guide-drawer-backdrop/u)?.[0] ?? "";
  assert.doesNotMatch(supplementalCss, /#[a-f\d]{3,8}/iu);
  assert.doesNotMatch(supplementalCss, /(?:background|border|box-shadow|color)\s*:/u);
});
