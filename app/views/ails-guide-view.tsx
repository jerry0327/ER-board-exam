"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, Headphones, Library, ListTree, Search, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationDraft, type ContentAnnotationSource } from "../components/content-annotation-tools";
import GuideReaderToolsPanel, { GuideReaderToolbar, GuideTextbookSwitcher } from "../components/guide-reader-tools";
import LearningReaderLoadingShell from "../components/learning-reader-loading-shell";
import MarkdownContent from "../components/markdown-content";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingNextPrev from "../components/reading-next-prev";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { extractMarkdownOutline } from "../lib/markdown-heading";
import { ailsGuideAnnotationResourceId, ailsGuideAnnotationScopePrefix } from "../lib/annotation-source";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import { ailsReadingPageIds, isAilsInteractivePageId, loadAilsReview, normalizeAilsPageId, type AilsPageId, type AilsReview } from "../lib/ails-review";
import type { AnnotationExcerptRequest, GuideReadState, GuideResourceProgressRecord, StudyAnnotation } from "../lib/types";
import AilsQuestionCenterView from "./ails-question-center-view";

type Props = {
  requestedPage: string | null;
  requestedAnnotationId?: string | null;
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  progressMap: Map<string, GuideResourceProgressRecord>;
  progressStatus: "loading" | "synced" | "offline";
  onSelectPage: (page: AilsPageId) => void;
  onOpenLibrary: () => void;
  onOpenResource: (resourceId: string, contentHash: string | null) => Promise<unknown>;
  onMarkResource: (resourceId: string, value: GuideReadState, contentHash: string | null) => Promise<unknown>;
  onBookmarkResource: (resourceId: string, value: boolean) => Promise<unknown>;
  onAnnotationOpenChange: (open: boolean) => void;
  onUpsert: (draft: ContentAnnotationDraft) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
};

export default function AilsGuideView({
  requestedPage,
  requestedAnnotationId,
  annotations,
  annotationStatus,
  progressMap,
  progressStatus,
  onSelectPage,
  onOpenLibrary,
  onOpenResource,
  onMarkResource,
  onBookmarkResource,
  onAnnotationOpenChange,
  onUpsert,
  onRemove,
}: Props) {
  const [review, setReview] = useState<AilsReview | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
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
    loadAilsReview()
      .then((value) => { if (active) setReview(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "AILS 複習內容暫時無法載入。"); });
    return () => { active = false; };
  }, []);

  const explanationEntry = requestedPage === "answers";
  const selectedId = explanationEntry ? "qbank" : normalizeAilsPageId(requestedPage);
  const readingPages = useMemo(() => review
    ? ailsReadingPageIds.map((id) => review.pages.find((page) => page.id === id)).filter((page): page is NonNullable<typeof page> => Boolean(page))
    : [], [review]);
  const selectedPage = review?.pages.find((page) => page.id === selectedId) ?? null;
  const selectedIndex = readingPages.findIndex((page) => page.id === selectedId);
  const outline = useMemo(() => selectedPage ? extractMarkdownOutline(selectedPage.markdown) : [], [selectedPage]);
  const filteredGroups = useMemo(() => {
    if (!review) return [];
    const needle = query.trim().toLocaleLowerCase("zh-Hant");
    return review.groups.map((group) => ({
      ...group,
      pages: group.pages
        .filter((id) => ailsReadingPageIds.includes(id as (typeof ailsReadingPageIds)[number]))
        .map((id) => review.pages.find((page) => page.id === id))
        .filter((page): page is NonNullable<typeof page> => Boolean(page))
        .filter((page) => !needle || `${page.title} ${page.kicker} ${page.deck}`.toLocaleLowerCase("zh-Hant").includes(needle)),
    })).filter((group) => group.pages.length);
  }, [query, review]);
  const annotationResourceId = selectedPage ? ailsGuideAnnotationResourceId(selectedPage.id) ?? "" : "";
  const annotationPrefix = annotationResourceId ? ailsGuideAnnotationScopePrefix(annotationResourceId, "full") : null;
  const selectedProgress = progressMap.get(annotationResourceId);
  const contentHash = review && selectedPage ? `${review.revisedAt}:${selectedPage.id}` : null;
  const interactiveMode = selectedPage && isAilsInteractivePageId(selectedPage.id) ? selectedPage.id : null;
  const {
    actionLabel: selectedAudioActionLabel,
    accessibleLabel: selectedAudioAccessibleLabel,
    open: openPageAudioPlayer,
    prepare: preparePageAudio,
    source: selectedAudio,
  } = useLearningAudio({
    contentReady: Boolean(selectedPage?.markdown && !interactiveMode),
    noun: "頁",
    resource: selectedPage && !interactiveMode
      ? { kind: "textbook-chapter", textbookId: "ails", chapterId: selectedPage.id }
      : null,
  });
  const annotationSource = useMemo<ContentAnnotationSource | null>(() => {
    if (!selectedPage || !annotationPrefix || !annotationResourceId) return null;
    return {
      resourceId: annotationResourceId,
      eyebrow: `AILS・${selectedPage.title}`,
      panelLabel: `${selectedPage.title}筆記`,
      rootNoteTitle: `${selectedPage.title}讀書筆記`,
      rootNoteDescription: "整理本頁重點、易混淆處與待查事項",
      rootNotePlaceholder: "整理重點、易混淆處或待查問題…",
      emptyHint: "可反白正文，或直接將表格與各層標題加入筆記。",
      kind: "guide",
      annotationPrefix,
      contentScope: "full",
    };
  }, [annotationPrefix, annotationResourceId, selectedPage]);

  useEffect(() => {
    if (!selectedPage || !annotationResourceId || !contentHash || progressStatus === "loading") return;
    const openedKey = `${annotationResourceId}:${contentHash}`;
    if (openedResourceRef.current === openedKey) return;
    openedResourceRef.current = openedKey;
    void onOpenResource(annotationResourceId, contentHash)
      .then(() => selectedProgress ? undefined : onMarkResource(annotationResourceId, "reading", contentHash))
      .catch(() => {
        if (openedResourceRef.current === openedKey) openedResourceRef.current = null;
      });
  }, [annotationResourceId, contentHash, onMarkResource, onOpenResource, progressStatus, selectedPage, selectedProgress]);

  const selectPage = useCallback((page: AilsPageId) => {
    setLibraryOpen(false);
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    setPendingExcerpt(null);
    onSelectPage(page);
    scrollPageToTop();
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [onSelectPage]);
  const canPrevious = selectedIndex > 0;
  const canNext = selectedIndex >= 0 && selectedIndex < readingPages.length - 1;
  const previousPage = readingPages[selectedIndex - 1] ?? null;
  const nextPage = readingPages[selectedIndex + 1] ?? null;
  const readingNavigation = useReadingNavigation({
    onPrevious: () => { if (previousPage) selectPage(previousPage.id); },
    onNext: () => { if (nextPage) selectPage(nextPage.id); },
    canPrevious,
    canNext,
    enabled: Boolean(review),
  });

  if (error && !review) {
    return <main className="workspace-page"><div className="empty-state paper-card" role="alert"><Library /><h2>AILS 複習內容無法載入</h2><p>{error}</p><button className="outline-button" onClick={() => window.location.reload()}>重新載入</button></div></main>;
  }
  if (!review || !selectedPage) return <LearningReaderLoadingShell sourceId="ails" title="AILS急性中毒救命術" description="第三版急性中毒教材、選題與詳解閱讀。" />;

  if (interactiveMode) {
    return (
      <AilsQuestionCenterView
        key={explanationEntry ? "qbank-answers" : interactiveMode}
        initialMode={interactiveMode}
        initialReaderNum={explanationEntry ? review.questions[0]?.num : undefined}
        questions={review.questions}
        topics={review.topics}
        onSelectMode={(mode) => selectPage(mode)}
        onBackToContent={() => selectPage("master")}
      />
    );
  }

  return (
    <main className="guide-page ails-guide-page">
      <ReadingCatalogLayer portal={narrow}>
        <aside
        id="ails-guide-library"
        ref={libraryRef}
        className={`guide-library ails-guide-library swipe-dismiss-panel ${libraryOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-label="AILS 複習目錄"
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
          <div><p>AILS · 第三版</p><h1>AILS急性中毒救命術</h1></div>
          <button className="guide-list-close" aria-label="關閉 AILS 目錄" onClick={() => setLibraryOpen(false)}><X /></button>
          <GuideTextbookSwitcher currentTextbook="AILS急性中毒救命術" onOpenLibrary={onOpenLibrary} />
          <span><strong>{readingPages.length}</strong> 篇重點 · {review.questions.length} 題練習</span>
        </header>
        <label className="guide-search" data-swipe-dismiss-ignore=""><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋 AILS 內容" aria-label="搜尋 AILS 複習目錄" /></label>
        <div className="guide-chapter-list ails-guide-list">
          {filteredGroups.map((group) => (
            <Fragment key={group.id}>
              <div className="guide-section-label"><span>{group.label}</span></div>
              {group.pages.map((page) => {
                const position = readingPages.findIndex((item) => item.id === page.id) + 1;
                return (
                  <button type="button" key={page.id} aria-current={selectedPage.id === page.id ? "page" : undefined} className={selectedPage.id === page.id ? "active" : ""} onClick={() => selectPage(page.id)}>
                    <span>{String(position).padStart(2, "0")}</span>
                    <div><strong>{page.title}</strong><small>{page.kicker}</small></div>
                    <ChevronRight size={14} />
                  </button>
                );
              })}
            </Fragment>
          ))}
          {!filteredGroups.length && <p className="guide-list-empty">沒有符合搜尋條件的內容。</p>}
        </div>
        </aside>

        {libraryOpen && <button className="guide-drawer-backdrop" aria-label="關閉 AILS 目錄" onClick={() => setLibraryOpen(false)} />}
      </ReadingCatalogLayer>

      <section className={`guide-workspace reader-size-${fontSize}`} style={{ "--guide-font-size": `${[14, 16, 18][fontSize]}px` } as CSSProperties}>
        <GuideReaderToolbar
          ariaLabel="AILS 閱讀工具"
          libraryTriggerRef={libraryTriggerRef}
          libraryAriaLabel="開啟 AILS 複習目錄"
          libraryControlsId="ails-guide-library"
          libraryOpen={libraryOpen}
          showLibraryTrigger={narrow}
          onOpenLibrary={() => setLibraryOpen(true)}
          positionCurrent={String(selectedIndex + 1).padStart(2, "0")}
          positionTotal={readingPages.length}
          navigation={{ noun: "頁", canPrevious, canNext, onPrevious: () => previousPage && selectPage(previousPage.id), onNext: () => nextPage && selectPage(nextPage.id) }}
          outlineTriggerRef={outlineTriggerRef}
          outlineAvailable={outline.length > 0}
          outlineControlsId="ails-guide-toc-sheet"
          outlineOpen={outlineOpen}
          outlineLabel="本頁"
          onOpenOutline={() => setOutlineOpen(true)}
          audioAction={selectedAudio ? (
            <button type="button" className="reading-toolbar-audio" aria-label={selectedAudioAccessibleLabel} onPointerDown={preparePageAudio} onClick={openPageAudioPlayer}>
              <Headphones aria-hidden="true" />
              <span>音檔</span>
            </button>
          ) : undefined}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="AILS 文字"
          mobileToolsTriggerRef={mobileToolsTriggerRef}
          mobileToolsControlsId="ails-mobile-tools"
          mobileToolsOpen={mobileToolsOpen}
          showMobileToolsTrigger={compactTools}
          onOpenMobileTools={() => setMobileToolsOpen(true)}
        />

        {outlineOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setOutlineOpen(false)}><section ref={outlinePanelRef} id="ails-guide-toc-sheet" tabIndex={-1} className="reader-toc-sheet guide-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="AILS 本頁目錄" onClick={(event) => event.stopPropagation()}><header><strong>本頁目錄</strong><button data-overlay-close aria-label="關閉本頁目錄" onClick={() => setOutlineOpen(false)}><X /></button></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => { scrollElementIntoView(document.getElementById(item.id), { block: "start" }); setOutlineOpen(false); }}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        <GuideReaderToolsPanel
          panelRef={mobileToolsRef}
          id="ails-mobile-tools"
          open={compactTools && mobileToolsOpen}
          hidden={compactTools && !mobileToolsOpen}
          ariaLabel="AILS 閱讀工具"
          summary={`AILS・${selectedPage.title}`}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="AILS 文字"
          onClose={() => setMobileToolsOpen(false)}
          currentTextbook="AILS急性中毒救命術"
          onOpenLibrary={onOpenLibrary}
          navigation={(
            <div className="guide-rail-navigation">
              <button type="button" className="guide-rail-current" aria-label="開啟 AILS 複習目錄" aria-controls="ails-guide-library" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(true)}><Library size={17} /><span><small>AILS REVIEW</small><strong>{String(selectedIndex + 1).padStart(2, "0")} <em>/ {readingPages.length}</em></strong></span></button>
              <ReadingNextPrev className="guide-rail-step-controls" noun="頁" canPrevious={canPrevious} canNext={canNext} onPrevious={() => previousPage && selectPage(previousPage.id)} onNext={() => nextPage && selectPage(nextPage.id)} />
            </div>
          )}
          audioAction={selectedAudio ? (
            <button type="button" className="guide-audio-action" aria-label={selectedAudioAccessibleLabel} onPointerDown={preparePageAudio} onClick={() => { openPageAudioPlayer(); setMobileToolsOpen(false); }}>
              <span className="guide-audio-action-icon"><Headphones aria-hidden="true" /></span>
              <span><small>學習音檔</small><strong>{selectedAudioActionLabel}</strong></span>
              <Headphones aria-hidden="true" />
            </button>
          ) : undefined}
          progressActions={annotationSource ? {
            available: true,
            readState: selectedProgress?.readState ?? "unread",
            bookmarked: selectedProgress?.bookmarked === 1,
            bookmarkNoun: "本文",
            onToggleLater: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "later" ? "reading" : "later", contentHash),
            onToggleDone: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "done" ? "reading" : "done", contentHash),
            onToggleBookmark: () => void onBookmarkResource(annotationResourceId, selectedProgress?.bookmarked !== 1),
            annotationControl: (
              <ContentAnnotationTools
                source={annotationSource}
                contentKey={`${annotationResourceId}:full:${contentHash ?? "v1"}`}
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
          outlineItems={outline}
          outlineAriaLabel="AILS 本頁目錄"
          onSelectOutline={(id) => scrollElementIntoView(document.getElementById(id), { block: "start" })}
        />

        <div className="guide-reading-column">
          <header className="guide-chapter-header ails-page-header">
            <p>{selectedPage.kicker}</p>
            <h1 ref={headingRef} tabIndex={-1}><span>AILS</span>{selectedPage.title}</h1>
            {selectedPage.deck && <p className="ails-page-deck">{selectedPage.deck}</p>}
            <div><span className="ready">AILS 急性中毒</span><span>{review.revisedAt} 校訂</span>{selectedPage.metadata.slice(0, 1).map((item) => <span key={item}>{item}</span>)}</div>
          </header>

          {outline.length > 0 && <nav className="guide-outline guide-outline-inline" aria-label="AILS 本頁正文目錄"><header><ListTree size={17} /><span>本頁目錄・{outline.length}</span></header>{outline.map((item) => <button type="button" key={item.id} data-level={item.level} onClick={() => scrollElementIntoView(document.getElementById(item.id), { block: "start" })}>{item.label}</button>)}</nav>}

          <article data-content-annotation-root={annotationResourceId} className="guide-article paper-card reading-paper-surface ails-guide-article" aria-label={`AILS ${selectedPage.title}正文`} {...readingNavigation}>
            <MarkdownContent markdown={selectedPage.markdown} variant="guide" onAddToNotes={setPendingExcerpt} />
          </article>

          <ReadingNextPrev
            className="guide-next-prev ails-page-next-prev"
            variant="titles"
            noun="頁"
            canPrevious={canPrevious}
            canNext={canNext}
            previousTitle={previousPage?.title ?? ""}
            nextTitle={nextPage?.title ?? ""}
            onPrevious={() => previousPage && selectPage(previousPage.id)}
            onNext={() => nextPage && selectPage(nextPage.id)}
          />
        </div>
      </section>
    </main>
  );
}
