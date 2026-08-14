"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpenText, Bookmark, CheckCircle2, ChevronRight, Clock3, Headphones, Library, ListTree, Search, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationDraft, type ContentAnnotationSource } from "../components/content-annotation-tools";
import GuideProgressFilter, { matchesGuideProgressFilter, type GuideProgressFilterValue } from "../components/guide-progress-filter";
import GuideReaderToolsPanel, { GuideReaderToolbar, GuideTextbookSwitcher } from "../components/guide-reader-tools";
import LearningReaderLoadingShell from "../components/learning-reader-loading-shell";
import MarkdownContent from "../components/markdown-content";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingFontControls from "../components/reading-font-controls";
import ReadingNextPrev from "../components/reading-next-prev";
import ReadingVariantSelector, { type ReadingVariantValue } from "../components/reading-variant-selector";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { useNamespacedReadingVariantPreference } from "../hooks/use-reading-variant-preference";
import {
  emsGuideAnnotationResourceId,
  emsGuideAnnotationScopePrefix,
  goldfrankGuideAnnotationResourceId,
  goldfrankGuideAnnotationScopePrefix,
  parseEmsGuideAnnotationScope,
  parseGoldfrankGuideAnnotationScope,
} from "../lib/annotation-source";
import { loadEmsGuideManifest, loadEmsGuideMarkdown, normalizeEmsGuideChapterId, prefetchEmsGuideChapter, resolveEmsGuideContent, type EmsGuideChapter, type EmsGuideManifest, type EmsReadingDepth } from "../lib/ems-guides";
import { loadGoldfrankGuideManifest, loadGoldfrankGuideMarkdown, normalizeGoldfrankGuideChapterId, prefetchGoldfrankGuideChapter, resolveGoldfrankGuideContent } from "../lib/goldfrank-guides";
import { LEARNING_SOURCE_REGISTRY } from "../lib/learning-source-registry";
import { extractMarkdownOutline } from "../lib/markdown-heading";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import type { AnnotationExcerptRequest, GuideReadState, GuideResourceProgressRecord, StudyAnnotation } from "../lib/types";

type Props = {
  sourceId?: ChapterGuideSourceId;
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
  onUpsert: (draft: ContentAnnotationDraft) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onOpenLibrary: () => void;
};

type ContentState = {
  key: string;
  markdown: string;
  loading: boolean;
  error: string;
};

const progressLabels: Record<GuideReadState, string> = {
  unread: "未開始",
  reading: "閱讀中",
  done: "已完成",
  later: "稍後閱讀",
};

export type ChapterGuideSourceId = "ems" | "goldfrank";

type ChapterGuideAnnotationScope = {
  chapterId: string;
  mode: EmsReadingDepth;
};

type ChapterGuideSourceConfig = {
  id: ChapterGuideSourceId;
  chapterCount: number;
  namespace: ChapterGuideSourceId;
  audioTextbookId: ChapterGuideSourceId;
  shortTitle: string;
  currentTextbook: string;
  kicker: string;
  libraryTitle: string;
  editionLabel: string;
  editionDetail: string;
  loadingDescription: string;
  loadManifest: () => Promise<EmsGuideManifest>;
  loadMarkdown: (chapter: EmsGuideChapter, mode: EmsReadingDepth) => Promise<string>;
  prefetchChapter: (chapter: EmsGuideChapter, mode: EmsReadingDepth) => Promise<void | string>;
  resolveContent: typeof resolveEmsGuideContent;
  normalizeChapterId: (value: string | number | null | undefined) => string;
  annotationResourceId: (chapter: string | number) => string | null;
  annotationScopePrefix: (resourceId: string, scope?: string) => string | null;
  parseAnnotationScope: (value?: string | null) => ChapterGuideAnnotationScope | null;
  chapterLabel: (chapter: EmsGuideChapter) => string;
};

const CHAPTER_GUIDE_SOURCES: Record<ChapterGuideSourceId, ChapterGuideSourceConfig> = {
  ems: {
    id: "ems",
    chapterCount: 24,
    namespace: "ems",
    audioTextbookId: "ems",
    shortTitle: "EMS",
    currentTextbook: LEARNING_SOURCE_REGISTRY.ems.title,
    kicker: "EMS · PREHOSPITAL CARE",
    libraryTitle: LEARNING_SOURCE_REGISTRY.ems.title,
    editionLabel: "EMS 教科書",
    editionDetail: "緊急醫療救護學習指引",
    loadingDescription: "24 章學習指引、章節目錄與共用閱讀工具。",
    loadManifest: loadEmsGuideManifest,
    loadMarkdown: loadEmsGuideMarkdown,
    prefetchChapter: prefetchEmsGuideChapter,
    resolveContent: resolveEmsGuideContent,
    normalizeChapterId: normalizeEmsGuideChapterId,
    annotationResourceId: emsGuideAnnotationResourceId,
    annotationScopePrefix: emsGuideAnnotationScopePrefix,
    parseAnnotationScope: parseEmsGuideAnnotationScope,
    chapterLabel: (chapter) => `第 ${chapter.number} 章`,
  },
  goldfrank: {
    id: "goldfrank",
    chapterCount: 140,
    namespace: "goldfrank",
    audioTextbookId: "goldfrank",
    shortTitle: "Goldfrank",
    currentTextbook: LEARNING_SOURCE_REGISTRY.goldfrank.title,
    kicker: "GOLDFRANK’S · 11TH EDITION",
    libraryTitle: LEARNING_SOURCE_REGISTRY.goldfrank.title,
    editionLabel: "Goldfrank 11e",
    editionDetail: "Toxicologic Emergencies 學習指引",
    loadingDescription: "140 章學習指引、章節目錄與共用閱讀工具。",
    loadManifest: loadGoldfrankGuideManifest,
    loadMarkdown: loadGoldfrankGuideMarkdown,
    prefetchChapter: prefetchGoldfrankGuideChapter,
    resolveContent: resolveGoldfrankGuideContent,
    normalizeChapterId: normalizeGoldfrankGuideChapterId,
    annotationResourceId: goldfrankGuideAnnotationResourceId,
    annotationScopePrefix: goldfrankGuideAnnotationScopePrefix,
    parseAnnotationScope: parseGoldfrankGuideAnnotationScope,
    chapterLabel: (chapter) => `Chapter ${chapter.id}`,
  },
};

const depthOptions: { id: EmsReadingDepth; label: string; detail: string }[] = [
  { id: "quick", label: "速讀", detail: "快速掌握本章核心架構" },
  { id: "standard", label: "普通", detail: "保留脈絡與必要細節" },
  { id: "full", label: "完整版", detail: "閱讀完整章節與深入延伸" },
];

function deserializeEmsReadingPreference(stored: string | null): EmsReadingDepth {
  return stored === "quick" || stored === "standard" || stored === "full" ? stored : "full";
}

function serializeEmsReadingPreference(value: EmsReadingDepth) {
  return value;
}

function depthLabel(depth: EmsReadingDepth) {
  return depthOptions.find((option) => option.id === depth)?.label ?? "完整版";
}

function selectedChapterFrom(manifest: EmsGuideManifest, requestedChapter: string | null, source: ChapterGuideSourceConfig) {
  const id = source.normalizeChapterId(requestedChapter);
  return manifest.chapters.find((chapter) => chapter.id === id) ?? manifest.chapters[0];
}

export default function EmsGuideView({
  sourceId = "ems",
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
  onUpsert,
  onRemove,
  onOpenLibrary,
}: Props) {
  const source = CHAPTER_GUIDE_SOURCES[sourceId];
  const resourceIdFor = useCallback((chapter: EmsGuideChapter) => source.annotationResourceId(chapter.id)!, [source]);
  const [manifest, setManifest] = useState<EmsGuideManifest | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [contentAttempt, setContentAttempt] = useState(0);
  const [contentState, setContentState] = useState<ContentState>({ key: "", markdown: "", loading: false, error: "" });
  const [query, setQuery] = useState("");
  const [progressFilter, setProgressFilter] = useState<GuideProgressFilterValue>("all");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [pendingExcerpt, setPendingExcerpt] = useState<AnnotationExcerptRequest | null>(null);
  const { level: fontSize, setLevel: setFontSize } = useReadingFontPreference();
  const { value: preferredDepth, setValue: setPreferredDepth } = useNamespacedReadingVariantPreference({
    namespace: source.namespace,
    defaultValue: "full" as EmsReadingDepth,
    deserialize: deserializeEmsReadingPreference,
    serialize: serializeEmsReadingPreference,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const outlinePanelRef = useRef<HTMLElement>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const openedResourceRef = useRef<string | null>(null);
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
    void source.loadManifest()
      .then((nextManifest) => {
        if (active) {
          setManifest(nextManifest);
          setCatalogError("");
        }
      })
      .catch(() => { if (active) setCatalogError(`${source.currentTextbook}目錄暫時無法載入。`); });
    return () => { active = false; };
  }, [catalogAttempt, source]);

  const selectedChapter = manifest ? selectedChapterFrom(manifest, requestedChapter, source) : null;
  const selectedIndex = selectedChapter && manifest
    ? manifest.chapters.findIndex((chapter) => chapter.id === selectedChapter.id)
    : -1;
  const requestedScope = source.parseAnnotationScope(requestedAnnotationId);
  const deepLinkScope = requestedScope?.chapterId === selectedChapter?.id ? requestedScope : null;
  const effectiveDepth = deepLinkScope?.mode ?? preferredDepth;
  const selectedModeContent = selectedChapter ? source.resolveContent(selectedChapter, effectiveDepth) : null;
  const selectedContentHash = selectedChapter?.modes.full.contentHash ?? null;
  const contentKey = selectedChapter && selectedModeContent
    ? `${selectedChapter.id}:${effectiveDepth}:${selectedModeContent.contentHash}`
    : "";

  useEffect(() => {
    if (!selectedChapter || !selectedModeContent || !manifest) return;
    let active = true;
    const key = `${selectedChapter.id}:${effectiveDepth}:${selectedModeContent.contentHash}`;
    void Promise.resolve().then(() => {
      if (active) setContentState({ key, markdown: "", loading: true, error: "" });
    });
    void source.loadMarkdown(selectedChapter, effectiveDepth)
      .then((markdown) => {
        if (!active) return;
        setContentState({ key, markdown, loading: false, error: "" });
        const next = manifest.chapters[selectedIndex + 1];
        if (next) void source.prefetchChapter(next, effectiveDepth);
      })
      .catch(() => {
        if (active) setContentState({ key, markdown: "", loading: false, error: "本章暫時無法開啟。" });
      });
    return () => { active = false; };
  }, [contentAttempt, effectiveDepth, manifest, selectedChapter, selectedIndex, selectedModeContent, source]);

  const visibleContent = contentState.key === contentKey
    ? contentState
    : { key: contentKey, markdown: "", loading: Boolean(selectedChapter), error: "" };
  const markdown = visibleContent.markdown;
  const {
    actionLabel: selectedAudioActionLabel,
    accessibleLabel: selectedAudioAccessibleLabel,
    open: openChapterAudioPlayer,
    prepare: prepareChapterAudio,
    source: selectedAudio,
  } = useLearningAudio({
    contentReady: Boolean(markdown),
    noun: "章",
    resource: selectedChapter
      ? { kind: "textbook-chapter", textbookId: source.audioTextbookId, chapterId: selectedChapter.id }
      : null,
  });
  const outline = useMemo(() => extractMarkdownOutline(markdown), [markdown]);
  const annotationResourceId = selectedChapter ? resourceIdFor(selectedChapter) : "";
  const selectedProgress = progressMap.get(annotationResourceId);
  const openSelectedAudio = () => {
    openChapterAudioPlayer();
    setMobileToolsOpen(false);
  };
  const annotationPrefix = selectedChapter
    ? source.annotationScopePrefix(annotationResourceId, effectiveDepth)!
    : "";
  const annotationSource = useMemo<ContentAnnotationSource | null>(() => selectedChapter ? ({
    resourceId: annotationResourceId,
    eyebrow: `${source.shortTitle} ${source.chapterLabel(selectedChapter)}`,
    panelLabel: "本章筆記",
    rootNoteTitle: "章節筆記",
    rootNoteDescription: "整理本章重點、流程與待查事項",
    rootNotePlaceholder: "整理本章重要流程、臨床提醒或待查問題…",
    emptyHint: "可反白正文，或直接將表格與各層標題加入筆記。",
    kind: "guide",
    annotationPrefix,
    contentScope: effectiveDepth,
  }) : null, [annotationPrefix, annotationResourceId, effectiveDepth, selectedChapter, source]);

  useEffect(() => {
    if (!selectedChapter || !annotationResourceId || progressStatus === "loading") return;
    const openedKey = `${annotationResourceId}:${selectedContentHash}`;
    if (openedResourceRef.current === openedKey) return;
    openedResourceRef.current = openedKey;
    const initialize = async () => {
      await onOpenResource(annotationResourceId, selectedContentHash);
      if (!selectedProgress) await onMarkResource(annotationResourceId, "reading", selectedContentHash);
    };
    void initialize().catch(() => {
      if (openedResourceRef.current === openedKey) openedResourceRef.current = null;
    });
  }, [annotationResourceId, onMarkResource, onOpenResource, progressStatus, selectedChapter, selectedContentHash, selectedProgress]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const filteredChapters = useMemo(() => (manifest?.chapters ?? []).filter((chapter) => {
    const progress = progressMap.get(resourceIdFor(chapter));
    if (!matchesGuideProgressFilter(progress, progressFilter)) return false;
    return !normalizedQuery || `${chapter.number} ${chapter.title}`.toLocaleLowerCase("zh-TW").includes(normalizedQuery);
  }), [manifest?.chapters, normalizedQuery, progressFilter, progressMap, resourceIdFor]);
  const completedCount = (manifest?.chapters ?? []).filter((chapter) => progressMap.get(resourceIdFor(chapter))?.readState === "done").length;

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
    const next = manifest?.chapters[selectedIndex + offset];
    if (next) selectChapter(next.id);
  };
  const canPrevious = selectedIndex > 0;
  const canNext = Boolean(manifest && selectedIndex >= 0 && selectedIndex < manifest.chapters.length - 1);
  const readingNavigation = useReadingNavigation({
    onPrevious: () => selectByOffset(-1),
    onNext: () => selectByOffset(1),
    canPrevious,
    canNext,
    enabled: Boolean(markdown),
  });
  const scrollToOutline = (id: string, close = false) => {
    scrollElementIntoView(document.getElementById(id), { block: "start" });
    if (close) setOutlineOpen(false);
  };

  if (catalogError && !manifest) {
    return <main className="workspace-page"><div className="empty-state" role="alert"><BookOpenText /><h2>{source.currentTextbook}載入失敗</h2><p>{catalogError}</p><button className="outline-button" onClick={() => setCatalogAttempt((value) => value + 1)}>重新載入</button></div></main>;
  }
  if (!manifest || !selectedChapter) {
    return <LearningReaderLoadingShell sourceId={source.id} description={source.loadingDescription} />;
  }

  const previousChapter = manifest.chapters[selectedIndex - 1];
  const nextChapter = manifest.chapters[selectedIndex + 1];
  const libraryId = `${source.id}-guide-library`;
  const outlineId = `${source.id}-guide-outline`;
  const toolsId = `${source.id}-guide-tools`;

  return (
    <main className={`guide-page rosens-guide-page ems-guide-page ${source.id}-guide-page`}>
      <ReadingCatalogLayer portal={narrow}>
        <aside
        id={libraryId}
        ref={libraryRef}
        className={`guide-library swipe-dismiss-panel ${libraryOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-label={`${source.currentTextbook}章節目錄`}
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
          <div><p>{source.kicker}</p><h1>{source.libraryTitle}</h1></div>
          <button className="guide-list-close" aria-label="關閉章節目錄" onClick={() => setLibraryOpen(false)}><X /></button>
          <GuideTextbookSwitcher currentTextbook={source.currentTextbook} onOpenLibrary={onOpenLibrary} />
          <span>已完成 <strong>{completedCount}</strong> / {manifest.chapterCount} 章</span>
        </header>
        <label className="guide-search" data-swipe-dismiss-ignore=""><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋章號或主題" aria-label={`搜尋 ${source.shortTitle} 章節`} /></label>
        <div className="guide-filters rosens-guide-filters" data-swipe-dismiss-ignore=""><GuideProgressFilter value={progressFilter} onChange={setProgressFilter} ariaLabel={`依個人進度篩選 ${source.shortTitle} 章節`} /></div>
        <div className="guide-chapter-list">
          {filteredChapters.map((chapter) => {
            const progress = progressMap.get(resourceIdFor(chapter));
            const state = progress?.readState ?? "unread";
            return <button key={chapter.id} aria-current={selectedChapter.id === chapter.id ? "true" : undefined} className={selectedChapter.id === chapter.id ? "active" : ""} onPointerEnter={() => void source.prefetchChapter(chapter, effectiveDepth)} onPointerDown={() => void source.prefetchChapter(chapter, effectiveDepth)} onFocus={() => void source.prefetchChapter(chapter, effectiveDepth)} onClick={() => selectChapter(chapter.id)}><span>{chapter.number}</span><div><strong>{chapter.title}</strong><small>{progressLabels[state]}</small></div>{state === "done" ? <CheckCircle2 size={14} /> : progress?.bookmarked === 1 ? <Bookmark size={14} /> : <ChevronRight size={14} />}</button>;
          })}
        </div>
        </aside>

        {libraryOpen && <button className="guide-drawer-backdrop" aria-label="關閉章節目錄" onClick={() => setLibraryOpen(false)} />}
      </ReadingCatalogLayer>

      <section className={`guide-workspace reader-size-${fontSize}`} style={{ "--guide-font-size": `${[14, 16, 18][fontSize]}px` } as CSSProperties}>
        <GuideReaderToolbar
          ariaLabel={`${source.currentTextbook}閱讀工具`}
          libraryTriggerRef={libraryTriggerRef}
          libraryAriaLabel={`開啟 ${source.shortTitle} 章節目錄`}
          libraryControlsId={libraryId}
          libraryOpen={libraryOpen}
          showLibraryTrigger={narrow}
          onOpenLibrary={() => { setOutlineOpen(false); setMobileToolsOpen(false); setLibraryOpen(true); }}
          positionCurrent={String(selectedChapter.number)}
          positionTotal={manifest.chapterCount}
          navigation={{ noun: "章", ariaLabel: `切換 ${source.shortTitle} 章節`, canPrevious, canNext, onPrevious: () => selectByOffset(-1), onNext: () => selectByOffset(1) }}
          outlineTriggerRef={outlineTriggerRef}
          outlineAvailable={outline.length > 0}
          outlineControlsId={outlineId}
          outlineOpen={outlineOpen}
          outlineLabel="章節"
          onOpenOutline={() => setOutlineOpen(true)}
          audioAction={selectedAudio ? (
            <button type="button" className="reading-toolbar-audio" aria-label={selectedAudioAccessibleLabel} onPointerDown={prepareChapterAudio} onClick={openSelectedAudio}>
              <Headphones aria-hidden="true" />
              <span>音檔</span>
            </button>
          ) : undefined}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="學習指引文字"
          mobileToolsTriggerRef={mobileToolsTriggerRef}
          mobileToolsControlsId={toolsId}
          mobileToolsOpen={mobileToolsOpen}
          showMobileToolsTrigger={compactTools}
          onOpenMobileTools={() => setMobileToolsOpen(true)}
        />

        {outlineOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setOutlineOpen(false)}><section ref={outlinePanelRef} id={outlineId} tabIndex={-1} className="reader-toc-sheet guide-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="本章目錄" onClick={(event) => event.stopPropagation()}><header><strong>本章目錄</strong><button data-overlay-close aria-label="關閉文章目錄" onClick={() => setOutlineOpen(false)}><X /></button></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollToOutline(item.id, true)}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        <GuideReaderToolsPanel
          panelRef={mobileToolsRef}
          id={toolsId}
          open={compactTools && mobileToolsOpen}
          hidden={compactTools && !mobileToolsOpen}
          ariaLabel={`${source.currentTextbook}閱讀工具`}
          summary={`${source.chapterLabel(selectedChapter)}・${depthLabel(effectiveDepth)}`}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="學習指引文字"
          onClose={() => setMobileToolsOpen(false)}
          currentTextbook={source.currentTextbook}
          onOpenLibrary={onOpenLibrary}
          navigation={<div className="guide-rail-navigation"><button className="guide-rail-current" onClick={() => setLibraryOpen(true)}><Library size={17} /><span><small>目前章節</small><strong>{selectedChapter.number} <em>/ {manifest.chapterCount}</em></strong></span><ChevronRight size={14} /></button><ReadingNextPrev className="guide-rail-step-controls" noun="章" canPrevious={canPrevious} canNext={canNext} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} /><div className="reader-rail-secondary"><ReadingFontControls className="reader-rail-font" level={fontSize} onChange={setFontSize} noun="學習指引文字" /></div></div>}
          audioAction={selectedAudio ? (
            <button type="button" className="guide-audio-action" aria-label={selectedAudioAccessibleLabel} onPointerDown={prepareChapterAudio} onClick={openSelectedAudio}>
              <span className="guide-audio-action-icon"><Headphones aria-hidden="true" /></span>
              <span><small>學習音檔</small><strong>{selectedAudioActionLabel}</strong></span>
              <Headphones aria-hidden="true" />
            </button>
          ) : undefined}
          progressActions={annotationSource ? {
            available: true,
            readState: selectedProgress?.readState ?? "unread",
            bookmarked: selectedProgress?.bookmarked === 1,
            bookmarkNoun: "本章",
            onToggleLater: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "later" ? "reading" : "later", selectedContentHash),
            onToggleDone: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "done" ? "reading" : "done", selectedContentHash),
            onToggleBookmark: () => void onBookmarkResource(annotationResourceId, selectedProgress?.bookmarked !== 1),
            annotationControl: <ContentAnnotationTools source={annotationSource} contentKey={`${annotationResourceId}:${effectiveDepth}:${selectedModeContent?.contentHash ?? "loading"}`} annotations={annotations} annotationStatus={annotationStatus} requestedAnnotationId={requestedAnnotationId} pendingExcerpt={pendingExcerpt} onExcerptHandled={() => setPendingExcerpt(null)} onOpenChange={(open) => onAnnotationOpenChange(open)} onUpsert={onUpsert} onRemove={onRemove} />,
          } : null}
          onActionCapture={() => setMobileToolsOpen(false)}
          variantSelector={(
            <section className="guide-reading-variant" aria-label={`${source.currentTextbook}閱讀程度`}>
              <ReadingVariantSelector
                value={{ edition: "detailed", depth: effectiveDepth }}
                editionOptions={[{ id: "detailed", label: source.editionLabel, detail: source.editionDetail }]}
                depthOptions={depthOptions}
                busy={visibleContent.loading}
                locked={Boolean(requestedAnnotationId)}
                lockedReason="正顯示筆記建立時的學習指引；關閉筆記後可切換。"
                ariaLabel={`${source.shortTitle} 內容版本與閱讀程度選擇器`}
                onCommit={commitReadingVariant}
              />
              {requestedAnnotationId && <p className="reader-preference-lock" role="status">正顯示筆記建立時的學習指引；關閉筆記後可切換。</p>}
            </section>
          )}
          outlineItems={outline}
          outlineAriaLabel="本章文章目錄"
          onSelectOutline={(id) => scrollToOutline(id)}
        />

        <div className="guide-reading-column">
          <header className={`guide-chapter-header ems-guide-header ${source.id}-guide-header`}>
            <p>{source.kicker} · CHAPTER {selectedChapter.id}</p>
            <h1 ref={headingRef} tabIndex={-1}><span>{source.chapterLabel(selectedChapter)}</span>{selectedChapter.title}</h1>
            <div><span><BookOpenText size={15} />{source.currentTextbook}</span><span className="ready">{depthLabel(effectiveDepth)}</span><label className="guide-read-state">我的進度<select value={selectedProgress?.readState ?? "unread"} onChange={(event) => void onMarkResource(annotationResourceId, event.target.value as GuideReadState, selectedContentHash)}><option value="unread">未開始</option><option value="reading">閱讀中</option><option value="done">已完成</option><option value="later">稍後閱讀</option></select></label></div>
          </header>

          {outline.length > 0 && <nav className="guide-outline guide-outline-inline" aria-label="本章正文目錄"><header><ListTree size={17} /><span>本章目錄・{outline.length}</span></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollToOutline(item.id)}>{item.label}</button>)}</nav>}
          {visibleContent.loading && !markdown && <div className="guide-body-state" role="status"><Clock3 /><span>正在載入本章…</span></div>}
          {visibleContent.error && !markdown && <article className="guide-import-placeholder paper-card" role="alert"><BookOpenText /><p>{source.currentTextbook}</p><h2>本章暫時無法開啟</h2><p>{visibleContent.error}</p><button className="outline-button" onClick={() => setContentAttempt((value) => value + 1)}>重新載入本章</button></article>}
          {markdown && <article data-content-annotation-root={annotationResourceId} className={`guide-article paper-card reading-paper-surface reading-content-swap ${visibleContent.loading ? "is-refreshing" : ""}`} aria-busy={visibleContent.loading} aria-label={`${source.shortTitle} ${source.chapterLabel(selectedChapter)} ${depthLabel(effectiveDepth)}正文`} {...readingNavigation}><MarkdownContent markdown={markdown} variant="guide" documentTitle={selectedModeContent?.headingTitle ?? selectedChapter.title} onAddToNotes={setPendingExcerpt} /></article>}
          <ReadingNextPrev className="guide-next-prev" variant="titles" noun="章" ariaLabel={`${source.currentTextbook}前後章節`} canPrevious={canPrevious} canNext={canNext} previousTitle={previousChapter?.title ?? ""} nextTitle={nextChapter?.title ?? ""} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} />
        </div>
      </section>
    </main>
  );
}
