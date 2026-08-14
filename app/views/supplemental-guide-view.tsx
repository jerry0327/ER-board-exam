"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpenText, ChevronRight, Clock3, Headphones, ListTree, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationDraft, type ContentAnnotationSource } from "../components/content-annotation-tools";
import GuideReaderToolsPanel, { GuideReaderToolbar, GuideTextbookSwitcher } from "../components/guide-reader-tools";
import LearningReaderLoadingShell from "../components/learning-reader-loading-shell";
import MarkdownContent, { AnnotationBlockAction } from "../components/markdown-content";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingFontControls from "../components/reading-font-controls";
import ReadingNextPrev from "../components/reading-next-prev";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { useVisibleContentPrefetch } from "../hooks/use-visible-content-prefetch";
import { annotationBlockKey, firstMarkdownH1Excerpt } from "../lib/annotation-block-anchor";
import { guideSupplementalAnnotationScopePrefix } from "../lib/annotation-source";
import { LEARNING_SOURCE_REGISTRY } from "../lib/learning-source-registry";
import { extractMarkdownOutline } from "../lib/markdown-heading";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import { sanitizeStudyGuideMarkdown } from "../lib/study-guide-markdown";
import { supplementalGuideStartingChapter } from "../lib/supplemental-guide-navigation";
import { normalizeTextbookAudioSectionId } from "../lib/textbook-audio-sections";
import {
  loadSupplementalGuideCatalog,
  loadSupplementalGuideMarkdown,
  normalizeSupplementalGuideMarkdownTitle,
  resolveSupplementalGuideEntry,
  supplementalGuideDocumentTitle,
  type SupplementalGuideCatalog,
  type SupplementalGuideEntry,
  type SupplementalGuideTextbookId,
} from "../lib/supplemental-guides";
import type { AnnotationExcerptRequest, GuideReadState, GuideResourceProgressRecord, StudyAnnotation } from "../lib/types";

type Props = {
  textbookId: SupplementalGuideTextbookId;
  requestedResourceId: string | null;
  requestedAnnotationId?: string | null;
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  progressMap: Map<string, GuideResourceProgressRecord>;
  progressStatus: "loading" | "synced" | "offline";
  onSelectResource: (resourceId: string) => void;
  onOpenChapterLibrary: () => void;
  onOpenChapter: (chapter: number | string) => void;
  onOpenResource: (resourceId: string, contentHash: string | null) => Promise<unknown>;
  onMarkResource: (resourceId: string, value: GuideReadState, contentHash: string | null) => Promise<unknown>;
  onBookmarkResource: (resourceId: string, value: boolean) => Promise<unknown>;
  onOpenLibrary: () => void;
  onAnnotationOpenChange: (open: boolean) => void;
  onUpsert: (draft: ContentAnnotationDraft) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
};

type ContentState = {
  key: string;
  markdown: string;
  loading: boolean;
  error: string;
};

const supplementalLibraryTitle = "Section Overviews / Whole-Book Overview";

function textbookTitle(textbookId: SupplementalGuideTextbookId) {
  return LEARNING_SOURCE_REGISTRY[textbookId].title;
}

function resourceMarker(entry: SupplementalGuideEntry) {
  return entry.kind === "overview" ? "BOOK" : String(entry.section).padStart(2, "0");
}

function resourceEyebrow(entry: SupplementalGuideEntry) {
  return entry.kind === "overview" ? "Whole-Book Overview" : `Section ${entry.section} Overview`;
}

function chapterCatalogLabel(entry: SupplementalGuideEntry) {
  return entry.textbookId === "rosens" ? "瀏覽全部 208 章" : "瀏覽全部 303 章";
}

function sectionQuickStartLabel(entry: SupplementalGuideEntry) {
  if (entry.kind === "overview") return null;
  if (entry.textbookId === "rosens") {
    const target = String(supplementalGuideStartingChapter(entry));
    const displayTarget = target.startsWith("e") ? `e${Number(target.slice(1))}` : target;
    return `從 Section ${entry.section} 的 Chapter ${displayTarget} 開始`;
  }
  const target = Number(supplementalGuideStartingChapter(entry));
  return `從本 Section 的 Chapter ${String(target).padStart(3, "0")} 開始`;
}

export default function SupplementalGuideView({
  textbookId,
  requestedResourceId,
  requestedAnnotationId,
  annotations,
  annotationStatus,
  progressMap,
  progressStatus,
  onSelectResource,
  onOpenChapterLibrary,
  onOpenChapter,
  onOpenResource,
  onMarkResource,
  onBookmarkResource,
  onOpenLibrary,
  onAnnotationOpenChange,
  onUpsert,
  onRemove,
}: Props) {
  const [catalog, setCatalog] = useState<SupplementalGuideCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [contentAttempt, setContentAttempt] = useState(0);
  const [contentState, setContentState] = useState<ContentState>({ key: "", markdown: "", loading: false, error: "" });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [pendingExcerpt, setPendingExcerpt] = useState<AnnotationExcerptRequest | null>(null);
  const { level: fontSize, setLevel: setFontSize } = useReadingFontPreference();
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
    void Promise.resolve().then(() => {
      if (active) setCatalogError("");
    });
    void loadSupplementalGuideCatalog(textbookId)
      .then((nextCatalog) => {
        if (active) setCatalog(nextCatalog);
      })
      .catch(() => {
        if (active) setCatalogError("讀書指南暫時無法開啟，請稍後再試。");
      });
    return () => { active = false; };
  }, [catalogAttempt, textbookId]);

  const activeCatalog = catalog?.textbookId === textbookId ? catalog : null;
  const selectedEntry = activeCatalog ? resolveSupplementalGuideEntry(activeCatalog, requestedResourceId) : null;
  const selectedIndex = selectedEntry && activeCatalog ? activeCatalog.entries.findIndex((entry) => entry.id === selectedEntry.id) : -1;
  const contentKey = selectedEntry ? `${textbookId}:${selectedEntry.id}:${selectedEntry.contentHash}` : "";
  const warmResource = useCallback((resourceId: string) => {
    const entry = activeCatalog?.entries.find((candidate) => candidate.id === resourceId);
    if (entry) void loadSupplementalGuideMarkdown(entry).catch(() => undefined);
  }, [activeCatalog]);
  const prefetchWatchKey = activeCatalog?.entries.map((entry) => `${entry.id}:${entry.contentHash}`).join("|") ?? "";
  useVisibleContentPrefetch(chapterListRef, warmResource, prefetchWatchKey, Boolean(activeCatalog));

  useEffect(() => {
    if (!selectedEntry) return;
    let active = true;
    const key = `${textbookId}:${selectedEntry.id}:${selectedEntry.contentHash}`;
    void Promise.resolve().then(() => {
      if (active) setContentState({ key, markdown: "", loading: true, error: "" });
    });
    void loadSupplementalGuideMarkdown(selectedEntry)
      .then((markdown) => {
        if (active) setContentState({ key, markdown, loading: false, error: "" });
      })
      .catch(() => {
        if (active) setContentState({ key, markdown: "", loading: false, error: "這篇讀書指南暫時無法開啟。" });
      });
    return () => { active = false; };
  }, [contentAttempt, selectedEntry, textbookId]);

  const visibleContent = contentState.key === contentKey
    ? contentState
    : { key: contentKey, markdown: "", loading: true, error: "" };
  const markdown = useMemo(
    () => visibleContent.markdown && selectedEntry
      ? normalizeSupplementalGuideMarkdownTitle(selectedEntry, sanitizeStudyGuideMarkdown(visibleContent.markdown))
      : "",
    [selectedEntry, visibleContent.markdown],
  );
  const {
    actionLabel: selectedAudioActionLabel,
    accessibleLabel: selectedAudioAccessibleLabel,
    open: openSectionAudioPlayer,
    prepare: prepareSectionAudio,
    source: selectedAudio,
  } = useLearningAudio({
    contentReady: Boolean(markdown),
    noun: "節",
    resource: selectedEntry
      ? {
          kind: "textbook-section",
          textbookId,
          sectionId: selectedEntry.kind === "overview"
            ? "overview"
            : normalizeTextbookAudioSectionId(textbookId, String(selectedEntry.section)),
        }
      : null,
  });
  const outline = useMemo(() => extractMarkdownOutline(markdown), [markdown]);
  const titleExcerpt = useMemo(
    () => markdown ? firstMarkdownH1Excerpt(markdown, selectedEntry?.title ?? "") : null,
    [markdown, selectedEntry?.title],
  );
  const annotationResourceId = selectedEntry ? `guide-${textbookId}-${selectedEntry.id}` : "";
  const selectedProgress = progressMap.get(annotationResourceId);
  const annotationPrefix = annotationResourceId
    ? guideSupplementalAnnotationScopePrefix(annotationResourceId, "full")
    : null;
  const annotationSource = useMemo<ContentAnnotationSource | null>(() => {
    if (!selectedEntry || !annotationPrefix) return null;
    const isOverview = selectedEntry.kind === "overview";
    return {
      resourceId: annotationResourceId,
      eyebrow: resourceEyebrow(selectedEntry),
      panelLabel: isOverview ? "全書筆記" : `Section ${selectedEntry.section} 筆記`,
      rootNoteTitle: isOverview ? "全書讀書筆記" : `Section ${selectedEntry.section} 讀書筆記`,
      rootNoteDescription: isOverview ? "整理全書架構、複習策略與待查事項" : "整理本 Section 重點與待查事項",
      rootNotePlaceholder: "整理重點、容易混淆處或待查問題…",
      emptyHint: "可反白正文，或直接將表格與各層標題加入筆記。",
      kind: "guide",
      annotationPrefix,
      contentScope: "full",
    };
  }, [annotationPrefix, annotationResourceId, selectedEntry]);
  const libraryId = `supplemental-${textbookId}-library`;
  const outlineId = `supplemental-${textbookId}-outline`;
  const toolsId = `supplemental-${textbookId}-tools`;
  const openSelectedAudio = () => {
    openSectionAudioPlayer();
    setMobileToolsOpen(false);
  };

  useEffect(() => {
    if (!selectedEntry || !markdown || progressStatus === "loading") return;
    const openedKey = `${annotationResourceId}:${selectedEntry.contentHash}`;
    if (openedResourceRef.current === openedKey) return;
    openedResourceRef.current = openedKey;
    const initialize = async () => {
      await onOpenResource(annotationResourceId, selectedEntry.contentHash);
      if (!selectedProgress) await onMarkResource(annotationResourceId, "reading", selectedEntry.contentHash);
    };
    void initialize().catch(() => {
      if (openedResourceRef.current === openedKey) openedResourceRef.current = null;
    });
  }, [annotationResourceId, markdown, onMarkResource, onOpenResource, progressStatus, selectedEntry, selectedProgress]);

  const selectResource = useCallback((resourceId: string) => {
    setLibraryOpen(false);
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    onSelectResource(resourceId);
    scrollPageToTop();
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [onSelectResource]);

  const selectByOffset = useCallback((offset: number) => {
    if (!activeCatalog || selectedIndex < 0) return;
    const next = activeCatalog.entries[selectedIndex + offset];
    if (next) selectResource(next.id);
  }, [activeCatalog, selectResource, selectedIndex]);

  const canPrevious = selectedIndex > 0;
  const canNext = Boolean(activeCatalog && selectedIndex >= 0 && selectedIndex < activeCatalog.entries.length - 1);
  const readingNavigation = useReadingNavigation({
    onPrevious: () => selectByOffset(-1),
    onNext: () => selectByOffset(1),
    canPrevious,
    canNext,
    enabled: Boolean(markdown),
  });

  const openResourceLibrary = () => {
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    setLibraryOpen(true);
  };

  const scrollToOutlineItem = (id: string, close = false) => {
    scrollElementIntoView(document.getElementById(id), { block: "start" });
    if (close) setOutlineOpen(false);
  };

  if (catalogError && !activeCatalog) {
    return (
      <main className="workspace-page">
        <div className="empty-state" role="alert">
          <BookOpenText />
          <h2>讀書指南暫時無法開啟</h2>
          <p>{catalogError}</p>
          <button className="outline-button" onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>重新載入</button>
        </div>
      </main>
    );
  }

  if (!activeCatalog || !selectedEntry) {
    return <LearningReaderLoadingShell sourceId={textbookId} title={supplementalLibraryTitle} description="全書脈絡、Section 重點與章節導讀。" />;
  }

  const selectedTarget = supplementalGuideStartingChapter(selectedEntry);
  const quickStartLabel = sectionQuickStartLabel(selectedEntry);
  const previousEntry = activeCatalog.entries[selectedIndex - 1];
  const nextEntry = activeCatalog.entries[selectedIndex + 1];

  return (
    <main className="guide-page supplemental-guide-page">
      <ReadingCatalogLayer portal={narrow}>
        <aside
        id={libraryId}
        ref={libraryRef}
        className={`guide-library supplemental-guide-library swipe-dismiss-panel ${libraryOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-label={`${activeCatalog.title} 讀書指南目錄`}
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
          <div><p>{LEARNING_SOURCE_REGISTRY[textbookId].guideKicker}</p><h1>{supplementalLibraryTitle}</h1></div>
          <button className="guide-list-close" aria-label="關閉讀書指南目錄" onClick={() => setLibraryOpen(false)}><X /></button>
          <GuideTextbookSwitcher currentTextbook={textbookTitle(textbookId)} onOpenLibrary={onOpenLibrary} />
          <span><strong>{activeCatalog.entries.length}</strong> 篇內容可閱讀</span>
        </header>
        <div ref={chapterListRef} className="guide-chapter-list supplemental-guide-resource-list">
          {activeCatalog.entries.map((entry) => (
            <button
              key={entry.id}
              data-content-prefetch={entry.id}
              aria-current={selectedEntry.id === entry.id ? "true" : undefined}
              className={selectedEntry.id === entry.id ? "active" : ""}
              onPointerEnter={() => warmResource(entry.id)}
              onPointerDown={() => warmResource(entry.id)}
              onFocus={() => warmResource(entry.id)}
              onClick={() => selectResource(entry.id)}
            >
              <span>{resourceMarker(entry)}</span>
              <div><strong>{entry.title}</strong><small>{entry.kind === "overview" ? "Complete textbook synthesis" : `Section ${entry.section} Overview`}</small></div>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        </aside>

        {libraryOpen && <button className="guide-drawer-backdrop" aria-label="關閉讀書指南目錄" onClick={() => setLibraryOpen(false)} />}
      </ReadingCatalogLayer>

      <section className={`guide-workspace reader-size-${fontSize}`} style={{ "--guide-font-size": `${[14, 16, 18][fontSize]}px` } as CSSProperties}>
        <GuideReaderToolbar
          ariaLabel={`${supplementalLibraryTitle} 閱讀工具`}
          libraryTriggerRef={libraryTriggerRef}
          libraryAriaLabel={`開啟 ${supplementalLibraryTitle} 目錄`}
          libraryControlsId={libraryId}
          libraryOpen={libraryOpen}
          showLibraryTrigger={narrow}
          onOpenLibrary={openResourceLibrary}
          positionCurrent={resourceMarker(selectedEntry)}
          positionTotal={activeCatalog.entries.length}
          navigation={{ noun: "篇", canPrevious, canNext, onPrevious: () => selectByOffset(-1), onNext: () => selectByOffset(1) }}
          outlineTriggerRef={outlineTriggerRef}
          outlineAvailable={outline.length > 0}
          outlineControlsId={outlineId}
          outlineOpen={outlineOpen}
          outlineLabel="本文"
          onOpenOutline={() => setOutlineOpen(true)}
          audioAction={selectedAudio ? (
            <button type="button" className="reading-toolbar-audio" aria-label={selectedAudioAccessibleLabel} onPointerDown={prepareSectionAudio} onClick={openSelectedAudio}>
              <Headphones aria-hidden="true" />
              <span>音檔</span>
            </button>
          ) : undefined}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="讀書指南文字"
          mobileToolsTriggerRef={mobileToolsTriggerRef}
          mobileToolsControlsId={toolsId}
          mobileToolsOpen={mobileToolsOpen}
          showMobileToolsTrigger={compactTools}
          onOpenMobileTools={() => setMobileToolsOpen(true)}
        />

        {outlineOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setOutlineOpen(false)}><section ref={outlinePanelRef} id={outlineId} tabIndex={-1} className="reader-toc-sheet guide-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="本文文章目錄" onClick={(event) => event.stopPropagation()}><header><strong>本文目錄</strong><button data-overlay-close aria-label="關閉文章目錄" onClick={() => setOutlineOpen(false)}><X /></button></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollToOutlineItem(item.id, true)}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        <GuideReaderToolsPanel
          panelRef={mobileToolsRef}
          id={toolsId}
          open={compactTools && mobileToolsOpen}
          className="supplemental-guide-utility-panel"
          hidden={compactTools && !mobileToolsOpen}
          ariaLabel={`${supplementalLibraryTitle} 閱讀工具`}
          summary={resourceEyebrow(selectedEntry)}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="讀書指南文字"
          onClose={() => setMobileToolsOpen(false)}
          currentTextbook={textbookTitle(textbookId)}
          onOpenLibrary={onOpenLibrary}
          navigation={(
            <div className="guide-rail-navigation">
              <button className="guide-rail-current supplemental-guide-chapter-rail" aria-label={`${chapterCatalogLabel(selectedEntry)}個別章節指南`} onClick={onOpenChapterLibrary}><BookOpenText size={17} /><span><small>個別章節</small><strong>{chapterCatalogLabel(selectedEntry)}</strong></span><ChevronRight size={14} /></button>
              <ReadingNextPrev className="guide-rail-step-controls" noun="篇" canPrevious={canPrevious} canNext={canNext} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} />
              <div className="reader-rail-secondary"><ReadingFontControls className="reader-rail-font" level={fontSize} onChange={setFontSize} noun="讀書指南文字" /></div>
            </div>
          )}
          audioAction={selectedAudio ? (
            <button type="button" className="guide-audio-action" aria-label={selectedAudioAccessibleLabel} onPointerDown={prepareSectionAudio} onClick={openSelectedAudio}>
              <span className="guide-audio-action-icon"><Headphones aria-hidden="true" /></span>
              <span><small>Section 音檔</small><strong>{selectedAudioActionLabel}</strong></span>
              <Headphones aria-hidden="true" />
            </button>
          ) : undefined}
          progressActions={annotationSource ? {
            available: true,
            readState: selectedProgress?.readState ?? "unread",
            bookmarked: selectedProgress?.bookmarked === 1,
            bookmarkNoun: "本文",
            onToggleLater: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "later" ? "reading" : "later", selectedEntry.contentHash),
            onToggleDone: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "done" ? "reading" : "done", selectedEntry.contentHash),
            onToggleBookmark: () => void onBookmarkResource(annotationResourceId, selectedProgress?.bookmarked !== 1),
            annotationControl: (
              <ContentAnnotationTools
                source={annotationSource}
                contentKey={`${annotationResourceId}:full:${visibleContent.markdown ? selectedEntry.contentHash : "loading"}`}
                annotations={annotations}
                annotationStatus={annotationStatus}
                requestedAnnotationId={requestedAnnotationId}
                pendingExcerpt={pendingExcerpt}
                onExcerptHandled={() => setPendingExcerpt(null)}
                onOpenChange={onAnnotationOpenChange}
                onUpsert={onUpsert}
                onRemove={onRemove}
              />
            ),
          } : null}
          onActionCapture={() => setMobileToolsOpen(false)}
          outlineItems={outline}
          outlineAriaLabel="本文文章目錄"
          onSelectOutline={(id) => scrollToOutlineItem(id)}
        />

        <div className="guide-reading-column">
          <header className="guide-chapter-header supplemental-guide-header">
            <p>{resourceEyebrow(selectedEntry)}・{activeCatalog.title}</p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className={titleExcerpt ? "has-annotation-action" : undefined}
              data-content-annotation-companion={titleExcerpt ? annotationResourceId : undefined}
              data-annotation-anchor={titleExcerpt?.sourceAnchor}
              data-annotation-block-key={titleExcerpt ? annotationBlockKey(titleExcerpt.block, titleExcerpt.markdown) : undefined}
            >
              <span>{resourceEyebrow(selectedEntry)}</span>{selectedEntry.title}
              {titleExcerpt && <AnnotationBlockAction label="主標題" excerpt={titleExcerpt} onAddToNotes={setPendingExcerpt} />}
            </h1>
            <div>
              <span><BookOpenText size={15} />{activeCatalog.title}</span>
              <span className="ready">完整內容</span>
              <label className="guide-read-state">我的進度<select value={selectedProgress?.readState ?? "unread"} onChange={(event) => void onMarkResource(annotationResourceId, event.target.value as GuideReadState, selectedEntry.contentHash)}><option value="unread">未開始</option><option value="reading">閱讀中</option><option value="done">已完成</option><option value="later">稍後閱讀</option></select></label>
            </div>
          </header>

          <section className="supplemental-guide-chapter-entry" aria-label="前往個別章節學習指引">
            <button type="button" className="primary-button" onClick={onOpenChapterLibrary}>
              <BookOpenText size={19} />
              <span><strong>{chapterCatalogLabel(selectedEntry)}</strong><small>開啟個別章節目錄並選擇要閱讀的章節</small></span>
              <ChevronRight size={18} />
            </button>
            {quickStartLabel && <button type="button" className="text-action" onClick={() => onOpenChapter(selectedTarget)}>{quickStartLabel}<ChevronRight size={14} /></button>}
          </section>

          {outline.length > 0 && <nav className="guide-outline guide-outline-inline" aria-label="本文正文目錄"><header><ListTree size={17} /><span>本文目錄・{outline.length}</span></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollToOutlineItem(item.id)}>{item.label}</button>)}</nav>}

          {visibleContent.loading && !visibleContent.markdown && <div className="guide-body-state" role="status"><Clock3 /><span>正在載入本文…</span></div>}
          {visibleContent.error && !visibleContent.markdown && (
            <article className="guide-import-placeholder paper-card" role="alert">
              <BookOpenText />
              <p>{supplementalLibraryTitle}</p>
              <h2>本文暫時無法開啟</h2>
              <p>{visibleContent.error}</p>
              <button className="outline-button" onClick={() => setContentAttempt((attempt) => attempt + 1)}>重新載入本文</button>
            </article>
          )}
          {markdown && <article data-content-annotation-root={annotationResourceId} className={`guide-article paper-card reading-paper-surface reading-content-swap ${visibleContent.loading ? "is-refreshing" : ""}`} aria-busy={visibleContent.loading} aria-label={`${activeCatalog.title} ${resourceEyebrow(selectedEntry)}正文`} {...readingNavigation}><MarkdownContent markdown={markdown} variant="guide" documentTitle={supplementalGuideDocumentTitle(selectedEntry)} onAddToNotes={setPendingExcerpt} /></article>}

          <ReadingNextPrev className="guide-next-prev" variant="titles" noun="篇" ariaLabel={`${supplementalLibraryTitle} 前後篇`} canPrevious={canPrevious} canNext={canNext} previousTitle={previousEntry?.title ?? ""} nextTitle={nextEntry?.title ?? ""} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} />
        </div>
      </section>
    </main>
  );
}
