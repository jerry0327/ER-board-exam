"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpenText, Bookmark, CheckCircle2, ChevronRight, Clock3, Headphones, Library, ListTree, Search, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationDraft, type ContentAnnotationSource } from "../components/content-annotation-tools";
import GuideProgressFilter, { matchesGuideProgressFilter, type GuideProgressFilterValue } from "../components/guide-progress-filter";
import GuideReaderToolsPanel, { GuideReaderToolbar, GuideTextbookSwitcher } from "../components/guide-reader-tools";
import LearningReaderLoadingShell from "../components/learning-reader-loading-shell";
import MarkdownContent, { AnnotationBlockAction } from "../components/markdown-content";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingFontControls from "../components/reading-font-controls";
import ReadingNextPrev from "../components/reading-next-prev";
import ReadingVariantSelector, { type ReadingVariantValue } from "../components/reading-variant-selector";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { useVisibleContentPrefetch } from "../hooks/use-visible-content-prefetch";
import { useNamespacedReadingVariantPreference } from "../hooks/use-reading-variant-preference";
import { annotationBlockKey, firstMarkdownH1Excerpt } from "../lib/annotation-block-anchor";
import { parseRosensGuideAnnotationScope, rosensGuideAnnotationResourceId, rosensGuideAnnotationScopePrefix } from "../lib/annotation-source";
import { LEARNING_SOURCE_REGISTRY } from "../lib/learning-source-registry";
import { extractMarkdownOutline } from "../lib/markdown-heading";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import { rosensBibliography, rosensCatalogStats, rosensChapters, rosensSections, type RosensReadingDepth } from "../lib/rosens-catalog";
import { loadRosensGuideManifest, loadRosensGuideMarkdown, resolveRosensGuideContent, type RosensGuideManifest } from "../lib/rosens-guides";
import { normalizeStudyGuideDocumentTitle, sanitizeStudyGuideMarkdown } from "../lib/study-guide-markdown";
import type { AnnotationExcerptRequest, GuideReadState, GuideResourceProgressRecord, StudyAnnotation } from "../lib/types";

type Props = {
  requestedChapter: string | null;
  requestedAnnotationId?: string | null;
  progressMap: Map<string, GuideResourceProgressRecord>;
  progressStatus: "loading" | "synced" | "offline";
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  onSelectChapter: (chapter: string) => void;
  onOpenResource: (resourceId: string, contentHash: string | null) => Promise<unknown>;
  onMarkResource: (resourceId: string, value: GuideReadState, contentHash: string | null) => Promise<unknown>;
  onBookmarkResource: (resourceId: string, value: boolean) => Promise<unknown>;
  onAnnotationOpenChange: (open: boolean) => void;
  onUpsertAnnotation: (draft: ContentAnnotationDraft) => Promise<unknown>;
  onRemoveAnnotation: (id: string) => Promise<unknown>;
  onOpenLibrary: () => void;
};

type DisplayedGuide = {
  chapterId: string;
  mode: RosensReadingDepth;
  markdown: string;
};

const depthOptions: { id: RosensReadingDepth; label: string; detail: string }[] = [
  { id: "quick", label: "速讀", detail: "約五分鐘掌握高產重點" },
  { id: "standard", label: "普通", detail: "保留臨床脈絡與必要細節" },
  { id: "full", label: "完整版", detail: "逐段閱讀完整章節指引" },
];

const progressLabels: Record<GuideReadState, string> = {
  unread: "未開始",
  reading: "閱讀中",
  done: "已完成",
  later: "稍後閱讀",
};

function deserializeRosensReadingPreference(stored: string | null): RosensReadingDepth {
  return stored === "quick" || stored === "standard" || stored === "full" ? stored : "full";
}

function serializeRosensReadingPreference(value: RosensReadingDepth) {
  return value;
}

function normalizeChapterId(value: string | null) {
  if (!value) return "001";
  const normalized = value.toLocaleLowerCase("en");
  if (/^\d{1,3}$/u.test(normalized)) return String(Number(normalized)).padStart(3, "0");
  if (/^e\d{1,2}$/u.test(normalized)) return `e${String(Number(normalized.slice(1))).padStart(2, "0")}`;
  return "001";
}

function depthLabel(depth: RosensReadingDepth) {
  return depthOptions.find((option) => option.id === depth)?.label ?? "完整版";
}

export default function RosensGuideView({
  requestedChapter,
  requestedAnnotationId,
  progressMap,
  progressStatus,
  annotations,
  annotationStatus,
  onSelectChapter,
  onOpenResource,
  onMarkResource,
  onBookmarkResource,
  onAnnotationOpenChange,
  onUpsertAnnotation,
  onRemoveAnnotation,
  onOpenLibrary,
}: Props) {
  const [manifest, setManifest] = useState<RosensGuideManifest | null>(null);
  const [displayedGuide, setDisplayedGuide] = useState<DisplayedGuide | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [contentError, setContentError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [contentAttempt, setContentAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [sectionId, setSectionId] = useState("all");
  const [progressFilter, setProgressFilter] = useState<GuideProgressFilterValue>("all");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [pendingExcerpt, setPendingExcerpt] = useState<AnnotationExcerptRequest | null>(null);
  const { level: fontSize, setLevel: setFontSize } = useReadingFontPreference();
  const { value: preferredDepth, setValue: setPreferredDepth } = useNamespacedReadingVariantPreference({
    namespace: "rosens",
    defaultValue: "full" as RosensReadingDepth,
    deserialize: deserializeRosensReadingPreference,
    serialize: serializeRosensReadingPreference,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const outlinePanelRef = useRef<HTMLElement>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const openedResourceRef = useRef<string | null>(null);
  const chapterListRef = useRef<HTMLDivElement>(null);
  const narrow = useMediaQueryMatch("(max-width: 1140px)");
  const compactTools = useMediaQueryMatch("(max-width: 1440px)");
  const librarySwipe = useHorizontalSwipeDismiss<HTMLElement>({
    direction: "left",
    enabled: narrow && libraryOpen,
    onDismiss: () => setLibraryOpen(false),
  });

  useOverlayFocusManagement({
    open: narrow && libraryOpen,
    panelRef: libraryRef,
    triggerRef: libraryTriggerRef,
    onClose: () => setLibraryOpen(false),
    dismissWhenMediaQueryStopsMatching: "(max-width: 1140px)",
  });

  useEffect(() => {
    if (requestedChapter !== null || !narrow || !manifest) return;
    void Promise.resolve().then(() => setLibraryOpen(true));
  }, [manifest, narrow, requestedChapter]);

  useOverlayFocusManagement({
    open: compactTools && mobileToolsOpen,
    panelRef: mobileToolsRef,
    triggerRef: mobileToolsTriggerRef,
    onClose: () => setMobileToolsOpen(false),
    dismissWhenMediaQueryStopsMatching: "(max-width: 1440px)",
  });
  useOverlayFocusManagement({
    open: outlineOpen,
    panelRef: outlinePanelRef,
    triggerRef: outlineTriggerRef,
    onClose: () => setOutlineOpen(false),
    dismissWhenMediaQueryStopsMatching: "(max-width: 1440px)",
    initialFocusSelector: "[data-overlay-close]",
  });

  useEffect(() => {
    let active = true;
    void loadRosensGuideManifest()
      .then((nextManifest) => { if (active) setManifest(nextManifest); })
      .catch(() => { if (active) setCatalogError("Rosen’s 學習指引目錄暫時無法載入。"); });
    return () => { active = false; };
  }, [catalogAttempt]);

  const selectedId = normalizeChapterId(requestedChapter);
  const selectedIndex = Math.max(0, rosensChapters.findIndex((chapter) => chapter.id === selectedId));
  const selectedChapter = rosensChapters[selectedIndex] ?? rosensChapters[0];
  const selectedManifestChapter = manifest?.chapters.find((chapter) => chapter.id === selectedChapter.id) ?? null;
  const requestedScope = parseRosensGuideAnnotationScope(requestedAnnotationId);
  const deepLinkScope = requestedScope?.chapterId === selectedChapter.id ? requestedScope : null;
  const effectiveDepth = deepLinkScope?.mode ?? preferredDepth;
  const selectedContent = selectedManifestChapter ? resolveRosensGuideContent(selectedManifestChapter, effectiveDepth) : null;
  const selectedAvailable = Boolean(selectedManifestChapter?.available && selectedContent);
  const selectedContentHash = selectedManifestChapter?.modes?.full.contentHash ?? null;
  const annotationResourceId = rosensGuideAnnotationResourceId(selectedChapter.id)!;
  const selectedProgress = progressMap.get(annotationResourceId);
  useEffect(() => {
    if (!selectedManifestChapter) return;
    let active = true;
    const next = manifest?.chapters[selectedIndex + 1];
    Promise.resolve().then(() => {
      if (!active) return;
      setContentError("");
      if (!selectedAvailable) {
        setLoadingChapter(false);
        return;
      }
      setLoadingChapter(true);
      void loadRosensGuideMarkdown(selectedManifestChapter, effectiveDepth)
        .then((markdown) => {
          if (!active) return;
          setDisplayedGuide({ chapterId: selectedManifestChapter.id, mode: effectiveDepth, markdown });
          if (next?.available) void loadRosensGuideMarkdown(next, effectiveDepth).catch(() => undefined);
        })
        .catch(() => { if (active) setContentError("本章正文暫時無法載入，請再試一次。"); })
        .finally(() => { if (active) setLoadingChapter(false); });
    });
    return () => { active = false; };
  }, [contentAttempt, effectiveDepth, manifest?.chapters, selectedAvailable, selectedIndex, selectedManifestChapter, selectedContent?.contentHash]);

  useEffect(() => {
    if (requestedChapter === null || !selectedAvailable || !selectedManifestChapter || progressStatus === "loading") return;
    const openedKey = `${annotationResourceId}:${selectedContentHash ?? "ready"}`;
    if (openedResourceRef.current === openedKey) return;
    openedResourceRef.current = openedKey;
    const initialize = async () => {
      await onOpenResource(annotationResourceId, selectedContentHash);
      if (!selectedProgress) await onMarkResource(annotationResourceId, "reading", selectedContentHash);
    };
    void initialize().catch(() => {
      if (openedResourceRef.current === openedKey) openedResourceRef.current = null;
    });
  }, [annotationResourceId, onMarkResource, onOpenResource, progressStatus, requestedChapter, selectedAvailable, selectedContentHash, selectedManifestChapter, selectedProgress]);

  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  const filteredChapters = useMemo(() => rosensChapters.filter((chapter) => {
    if (sectionId !== "all" && chapter.sectionId !== sectionId) return false;
    const progress = progressMap.get(rosensGuideAnnotationResourceId(chapter.id)!);
    if (!matchesGuideProgressFilter(progress, progressFilter)) return false;
    if (!normalizedQuery) return true;
    return `${chapter.displayId} ${chapter.title} ${chapter.sectionTitle}`.toLocaleLowerCase("en").includes(normalizedQuery);
  }), [normalizedQuery, progressFilter, progressMap, sectionId]);
  const warmChapter = useCallback((chapterId: string) => {
    const chapter = manifest?.chapters.find((candidate) => candidate.id === chapterId);
    if (chapter?.available) void loadRosensGuideMarkdown(chapter, effectiveDepth).catch(() => undefined);
  }, [effectiveDepth, manifest?.chapters]);
  const prefetchWatchKey = filteredChapters.map((chapter) => {
    const manifestChapter = manifest?.chapters.find((candidate) => candidate.id === chapter.id);
    return `${chapter.id}:${manifestChapter?.modes?.[effectiveDepth]?.contentHash ?? "missing"}`;
  }).join("|");
  useVisibleContentPrefetch(chapterListRef, warmChapter, prefetchWatchKey, Boolean(manifest));

  const visibleGuide = displayedGuide?.chapterId === selectedChapter.id ? displayedGuide : null;
  const markdown = useMemo(() => visibleGuide?.markdown
    ? normalizeStudyGuideDocumentTitle(
      sanitizeStudyGuideMarkdown(visibleGuide.markdown),
      selectedChapter.title,
    )
    : "", [selectedChapter.title, visibleGuide]);
  const {
    actionLabel: selectedAudioActionLabel,
    accessibleLabel: selectedAudioAccessibleLabel,
    open: openChapterAudioPlayer,
    prepare: prepareChapterAudio,
    source: selectedAudio,
  } = useLearningAudio({
    contentReady: Boolean(markdown),
    noun: "章",
    resource: { kind: "textbook-chapter", textbookId: "rosens", chapterId: selectedChapter.id },
  });
  const openSelectedAudio = () => {
    openChapterAudioPlayer();
    setMobileToolsOpen(false);
  };
  const extractedOutline = useMemo(() => extractMarkdownOutline(markdown), [markdown]);
  const outline = extractedOutline;
  const chapterTitleExcerpt = useMemo(
    () => markdown ? firstMarkdownH1Excerpt(markdown, selectedChapter.title) : null,
    [markdown, selectedChapter.title],
  );
  const annotationMode = deepLinkScope?.mode ?? visibleGuide?.mode ?? effectiveDepth;
  const annotationPrefix = rosensGuideAnnotationScopePrefix(annotationResourceId, `detailed-${annotationMode}`)!;
  const annotationSource = useMemo<ContentAnnotationSource>(() => ({
    resourceId: annotationResourceId,
    eyebrow: `Rosen’s Chapter ${selectedChapter.displayId}`,
    panelLabel: "本章筆記",
    rootNoteTitle: "章節筆記",
    rootNoteDescription: "整理本章重點與待查事項",
    rootNotePlaceholder: "整理本章重點、容易混淆處或待查問題…",
    emptyHint: "可反白正文，或直接將表格與各層標題加入筆記。",
    kind: "guide",
    annotationPrefix,
    contentScope: annotationMode,
  }), [annotationMode, annotationPrefix, annotationResourceId, selectedChapter.displayId]);
  const completedImported = (manifest?.chapters ?? []).filter((chapter) => (
    chapter.available && progressMap.get(rosensGuideAnnotationResourceId(chapter.id)!)?.readState === "done"
  )).length;

  const commitReadingVariant = (next: ReadingVariantValue) => {
    if (next.depth === "raw") return;
    setPreferredDepth(next.depth);
    setMobileToolsOpen(false);
  };

  const selectChapter = useCallback((chapter: string) => {
    setLibraryOpen(false);
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    onSelectChapter(chapter);
    scrollPageToTop();
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [onSelectChapter]);

  const selectByOffset = (offset: number) => {
    const next = rosensChapters[selectedIndex + offset];
    if (next) selectChapter(next.id);
  };

  const openChapterLibrary = () => {
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    setLibraryOpen(true);
  };

  const readingNavigation = useReadingNavigation({
    onPrevious: () => selectByOffset(-1),
    onNext: () => selectByOffset(1),
    canPrevious: selectedIndex > 0,
    canNext: selectedIndex < rosensChapters.length - 1,
    enabled: selectedAvailable,
  });

  if (catalogError && !manifest) {
    return <main className="workspace-page"><div className="empty-state" role="alert"><BookOpenText /><h2>Rosen’s 學習指引載入失敗</h2><p>{catalogError}</p><button className="outline-button" onClick={() => { setCatalogError(""); setCatalogAttempt((attempt) => attempt + 1); }}>重新載入</button></div></main>;
  }
  if (!manifest) return <LearningReaderLoadingShell sourceId="rosens" description="208 篇章節指引、章節目錄與共用閱讀工具。" />;

  const previousChapter = rosensChapters[selectedIndex - 1];
  const nextChapter = rosensChapters[selectedIndex + 1];

  return (
    <main className="guide-page rosens-guide-page">
      <ReadingCatalogLayer portal={narrow}>
        <aside
        id="rosens-guide-library"
        ref={libraryRef}
        className={`guide-library swipe-dismiss-panel ${libraryOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-label="Rosen’s 第 10 版章節目錄"
        aria-hidden={narrow && !libraryOpen}
        inert={narrow && !libraryOpen ? true : undefined}
        onPointerDown={librarySwipe.onPointerDown}
        onPointerMove={librarySwipe.onPointerMove}
        onPointerUp={librarySwipe.onPointerUp}
        onPointerCancel={librarySwipe.onPointerCancel}
        onLostPointerCapture={librarySwipe.onLostPointerCapture}
        onClickCapture={librarySwipe.onClickCapture}
      >
        <header>
          <div><p>ROSEN’S · 10TH EDITION</p><h1>{LEARNING_SOURCE_REGISTRY.rosens.title}</h1></div>
          <button className="guide-list-close" aria-label="關閉章節目錄" onClick={() => setLibraryOpen(false)}><X /></button>
          <GuideTextbookSwitcher currentTextbook={LEARNING_SOURCE_REGISTRY.rosens.title} onOpenLibrary={onOpenLibrary} />
          <span>已完成 <strong>{completedImported}</strong> / {manifest.importedChapters} 章 · 詳細版</span>
        </header>
        <label className="guide-search" data-swipe-dismiss-ignore=""><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋章號或英文章名" aria-label="搜尋 Rosen’s 章節" /></label>
        <div className="guide-filters rosens-guide-filters" data-swipe-dismiss-ignore="">
          <select value={sectionId} onChange={(event) => setSectionId(event.target.value)} aria-label="依 Rosen’s Section 篩選章節"><option value="all">全部 {rosensSections.length} Sections</option>{rosensSections.map((section) => <option key={section.id} value={section.id}>Vol. {section.volume}・{section.title}</option>)}</select>
          <GuideProgressFilter value={progressFilter} onChange={setProgressFilter} ariaLabel="依個人進度篩選 Rosen’s 章節" />
        </div>
        <div ref={chapterListRef} className="guide-chapter-list">
          {filteredChapters.map((chapter, index) => {
            const resourceId = rosensGuideAnnotationResourceId(chapter.id)!;
            const progress = progressMap.get(resourceId);
            return (
              <Fragment key={chapter.id}>
                {(index === 0 || filteredChapters[index - 1]?.sectionId !== chapter.sectionId) && <div className="guide-section-label rosens-section-label"><span>{chapter.sectionLabel}</span><strong>{chapter.sectionTitle}</strong></div>}
                <button
                  data-content-prefetch={chapter.id}
                  aria-current={selectedChapter.id === chapter.id ? "true" : undefined}
                  className={selectedChapter.id === chapter.id ? "active" : ""}
                  onPointerEnter={() => warmChapter(chapter.id)}
                  onPointerDown={() => warmChapter(chapter.id)}
                  onFocus={() => warmChapter(chapter.id)}
                  onClick={() => selectChapter(chapter.id)}
                >
                  <span>{chapter.displayId}</span>
                  <div><strong>{chapter.title}</strong><small>{progressLabels[progress?.readState ?? "unread"]}・Volume {chapter.volume}</small></div>
                  {progress?.bookmarked === 1 ? <Bookmark size={14} fill="currentColor" /> : progress?.readState === "done" ? <CheckCircle2 size={14} /> : <ChevronRight size={14} />}
                </button>
              </Fragment>
            );
          })}
          {!filteredChapters.length && <p className="guide-list-empty">沒有符合目前條件的章節。</p>}
        </div>
        </aside>

        {libraryOpen && <button className="guide-drawer-backdrop" aria-label="關閉章節目錄" onClick={() => setLibraryOpen(false)} />}
      </ReadingCatalogLayer>

      <section className={`guide-workspace reader-size-${fontSize}`} style={{ "--guide-font-size": `${[14, 16, 18][fontSize]}px` } as CSSProperties}>
        <GuideReaderToolbar
          ariaLabel="Rosen’s 學習指引閱讀工具"
          libraryTriggerRef={libraryTriggerRef}
          libraryAriaLabel="開啟 Rosen’s 章節目錄"
          libraryControlsId="rosens-guide-library"
          libraryOpen={libraryOpen}
          showLibraryTrigger={narrow}
          onOpenLibrary={openChapterLibrary}
          positionCurrent={selectedChapter.displayId}
          positionTotal={rosensCatalogStats.totalEntries}
          navigation={{ noun: "章", ariaLabel: "切換 Rosen’s 章節", canPrevious: selectedIndex > 0, canNext: selectedIndex < rosensChapters.length - 1, onPrevious: () => selectByOffset(-1), onNext: () => selectByOffset(1) }}
          outlineTriggerRef={outlineTriggerRef}
          outlineAvailable={outline.length > 0}
          outlineControlsId="rosens-guide-toc"
          outlineOpen={outlineOpen}
          outlineLabel="章節"
          onOpenOutline={() => setOutlineOpen(true)}
          audioAction={selectedAudio ? (
            <button
              type="button"
              className="reading-toolbar-audio"
              aria-label={selectedAudioAccessibleLabel}
              onPointerDown={prepareChapterAudio}
              onClick={openSelectedAudio}
            >
              <Headphones aria-hidden="true" />
              <span>音檔</span>
            </button>
          ) : undefined}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="學習指引文字"
          mobileToolsTriggerRef={mobileToolsTriggerRef}
          mobileToolsControlsId="rosens-mobile-tools"
          mobileToolsOpen={mobileToolsOpen}
          showMobileToolsTrigger={compactTools}
          onOpenMobileTools={() => setMobileToolsOpen(true)}
        />

        {outlineOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setOutlineOpen(false)}><section ref={outlinePanelRef} id="rosens-guide-toc" tabIndex={-1} className="reader-toc-sheet guide-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="本章文章目錄" onClick={(event) => event.stopPropagation()}><header><strong>本章目錄</strong><button data-overlay-close aria-label="關閉文章目錄" onClick={() => setOutlineOpen(false)}><X /></button></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => { scrollElementIntoView(document.getElementById(item.id), { block: "start" }); setOutlineOpen(false); }}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        <GuideReaderToolsPanel
          panelRef={mobileToolsRef}
          id="rosens-mobile-tools"
          open={compactTools && mobileToolsOpen}
          hidden={compactTools && !mobileToolsOpen}
          ariaLabel="Rosen’s 學習指引閱讀工具"
          summary={`Rosen’s 10e・${depthLabel(effectiveDepth)}`}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="學習指引文字"
          onClose={() => setMobileToolsOpen(false)}
          currentTextbook={LEARNING_SOURCE_REGISTRY.rosens.title}
          onOpenLibrary={onOpenLibrary}
          navigation={(
            <div className="guide-rail-navigation">
              <button className="guide-rail-current" aria-label="開啟 Rosen’s 章節目錄" aria-controls="rosens-guide-library" aria-expanded={libraryOpen} onClick={openChapterLibrary}><Library size={17} /><span><small>VOLUME {selectedChapter.volume}</small><strong>{selectedChapter.displayId} <em>/ {rosensCatalogStats.totalEntries}</em></strong></span></button>
              <ReadingNextPrev className="guide-rail-step-controls" noun="章" canPrevious={selectedIndex > 0} canNext={selectedIndex < rosensChapters.length - 1} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} />
              <div className="reader-rail-secondary"><ReadingFontControls className="reader-rail-font" level={fontSize} onChange={setFontSize} noun="學習指引文字" /></div>
            </div>
          )}
          audioAction={selectedAudio ? (
            <button
              type="button"
              className="guide-audio-action"
              aria-label={selectedAudioAccessibleLabel}
              onPointerDown={prepareChapterAudio}
              onClick={openSelectedAudio}
            >
              <span className="guide-audio-action-icon">
                <Headphones aria-hidden="true" />
              </span>
              <span>
                <small>學習音檔</small>
                <strong>{selectedAudioActionLabel}</strong>
              </span>
              <Headphones aria-hidden="true" />
            </button>
          ) : undefined}
          progressActions={{
            available: selectedAvailable,
            readState: selectedProgress?.readState ?? "unread",
            bookmarked: selectedProgress?.bookmarked === 1,
            onToggleLater: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "later" ? "reading" : "later", selectedContentHash),
            onToggleDone: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "done" ? "reading" : "done", selectedContentHash),
            onToggleBookmark: () => void onBookmarkResource(annotationResourceId, selectedProgress?.bookmarked !== 1),
            annotationControl: <ContentAnnotationTools source={annotationSource} contentKey={`${annotationResourceId}:${annotationMode}:${visibleGuide ? (selectedContentHash ?? "ready") : "loading"}`} annotations={annotations} annotationStatus={annotationStatus} requestedAnnotationId={requestedAnnotationId} pendingExcerpt={pendingExcerpt} onExcerptHandled={() => setPendingExcerpt(null)} onOpenChange={onAnnotationOpenChange} onUpsert={onUpsertAnnotation} onRemove={onRemoveAnnotation} />,
          }}
          onActionCapture={() => setMobileToolsOpen(false)}
          variantSelector={(
            <section className="guide-reading-variant" aria-label="Rosen’s 學習指引閱讀程度">
              <ReadingVariantSelector
                value={{ edition: "detailed", depth: effectiveDepth }}
                editionOptions={[{ id: "detailed", label: "Rosen’s 10e", detail: "詳細學習指引" }]}
                depthOptions={depthOptions}
                busy={loadingChapter}
                locked={Boolean(requestedAnnotationId)}
                lockedReason="正顯示筆記建立時的學習指引；關閉筆記後可切換。"
                ariaLabel="Rosen’s 內容版本與閱讀程度選擇器"
                onCommit={commitReadingVariant}
              />
              {requestedAnnotationId && <p className="reader-preference-lock" role="status">正顯示筆記建立時的學習指引；關閉筆記後可切換。</p>}
            </section>
          )}
          outlineItems={outline}
          outlineAriaLabel="本章文章目錄"
          onSelectOutline={(id) => scrollElementIntoView(document.getElementById(id), { block: "start" })}
        />

        <div className="guide-reading-column">
          <header className="guide-chapter-header rosens-chapter-header">
            <p>VOLUME {selectedChapter.volume}・{selectedChapter.part}・{selectedChapter.sectionLabel}</p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className={chapterTitleExcerpt ? "has-annotation-action" : undefined}
              data-content-annotation-companion={chapterTitleExcerpt ? annotationResourceId : undefined}
              data-annotation-anchor={chapterTitleExcerpt?.sourceAnchor}
              data-annotation-block-key={chapterTitleExcerpt ? annotationBlockKey(chapterTitleExcerpt.block, chapterTitleExcerpt.markdown) : undefined}
            >
              <span>{selectedChapter.kind === "echapter" ? "Online Chapter" : "Chapter"} {selectedChapter.displayId}</span>{selectedChapter.title}
              {chapterTitleExcerpt && <AnnotationBlockAction label="主標題" excerpt={chapterTitleExcerpt} onAddToNotes={setPendingExcerpt} />}
            </h1>
            <div>
              <span><BookOpenText size={15} />{rosensBibliography.edition}</span>
              <span className="ready">詳細學習指引・{depthLabel(effectiveDepth)}</span>
              <label className="guide-read-state">我的進度<select value={selectedProgress?.readState ?? "unread"} onChange={(event) => void onMarkResource(annotationResourceId, event.target.value as GuideReadState, selectedContentHash)}><option value="unread">未開始</option><option value="reading" disabled={!selectedAvailable}>閱讀中</option><option value="done" disabled={!selectedAvailable}>已完成</option><option value="later">稍後閱讀</option></select></label>
            </div>
          </header>

          {outline.length > 0 && <nav className="guide-outline guide-outline-inline" aria-label="本章正文目錄"><header><ListTree size={17} /><span>本章目錄・{outline.length}</span></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollElementIntoView(document.getElementById(item.id), { block: "start" })}>{item.label}</button>)}</nav>}

          {loadingChapter && !markdown && <div className="guide-body-state" role="status"><Clock3 /><span>正在載入本章正文…</span></div>}
          {selectedAvailable && markdown && <article data-content-annotation-root={annotationResourceId} className={`guide-article paper-card reading-paper-surface reading-content-swap ${loadingChapter ? "is-refreshing" : ""}`} aria-busy={loadingChapter} aria-label={`Rosen’s Chapter ${selectedChapter.displayId} ${depthLabel(visibleGuide?.mode ?? effectiveDepth)}學習指引正文`} {...readingNavigation}><MarkdownContent markdown={markdown} variant="guide" documentTitle={selectedChapter.title} onAddToNotes={setPendingExcerpt} /></article>}
          {contentError && <article className="guide-import-placeholder paper-card" role="alert"><BookOpenText /><p>Rosen’s 10e</p><h2>本章正文暫時無法開啟</h2><p>{contentError}</p><button className="outline-button" onClick={() => setContentAttempt((attempt) => attempt + 1)}>重新載入正文</button></article>}

          <ReadingNextPrev className="guide-next-prev" variant="titles" noun="章" ariaLabel="Rosen’s 前後章節" canPrevious={selectedIndex > 0} canNext={selectedIndex < rosensChapters.length - 1} previousTitle={previousChapter?.title ?? ""} nextTitle={nextChapter?.title ?? ""} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} />
        </div>
      </section>
    </main>
  );
}
