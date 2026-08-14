"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, BookOpenText, Bookmark, CheckCircle2, ChevronRight, Clock3, Headphones, Library, Link2, ListTree, Play, Search, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationSource } from "../components/content-annotation-tools";
import GuideProgressFilter, { matchesGuideProgressFilter, type GuideProgressFilterValue } from "../components/guide-progress-filter";
import GuideReaderToolsPanel, { GuideReaderToolbar, GuideTextbookSwitcher } from "../components/guide-reader-tools";
import LearningReaderLoadingShell from "../components/learning-reader-loading-shell";
import MarkdownContent, { AnnotationBlockAction } from "../components/markdown-content";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingFontControls from "../components/reading-font-controls";
import ReadingNextPrev from "../components/reading-next-prev";
import ReadingVariantSelector, { defaultReadingDepthOptions, type ReadingDepth, type ReadingDepthOption, type ReadingEditionOption, type ReadingVariantValue } from "../components/reading-variant-selector";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { useVisibleContentPrefetch } from "../hooks/use-visible-content-prefetch";
import { useNamespacedReadingVariantPreference } from "../hooks/use-reading-variant-preference";
import { annotationBlockKey, firstMarkdownH1Excerpt } from "../lib/annotation-block-anchor";
import { guideAnnotationResourceId, guideAnnotationScopePrefix, parseGuideAnnotationScope } from "../lib/annotation-source";
import { LEARNING_SOURCE_REGISTRY } from "../lib/learning-source-registry";
import { extractMarkdownOutline } from "../lib/markdown-heading";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import { normalizeStudyGuideDocumentTitle, sanitizeStudyGuideMarkdown } from "../lib/study-guide-markdown";
import { loadStudyGuideCatalog, loadStudyGuideLinks, loadStudyGuideMarkdown, resolveStudyGuideContent, type GuidePackId, type GuideReadingMode, type StudyGuideCatalog, type StudyGuideChapter, type StudyGuideLinks } from "../lib/study-guides";
import type { AnnotationExcerptRequest, GuideProgressRecord, GuideReadState, QuestionIndex, StudyAnnotation } from "../lib/types";

type Props = {
  questions: QuestionIndex[];
  requestedChapter: number | null;
  requestedAnnotationId?: string | null;
  rawDraftMode: boolean;
  progressMap: Map<number, GuideProgressRecord>;
  progressStatus: "loading" | "synced" | "offline";
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  onSelectChapter: (chapter: number) => void;
  onOpenReader: (questionId: string) => void;
  onStartQuestions: (ids: string[]) => void;
  onOpenChapter: (chapter: number, contentHash: string | null) => Promise<unknown>;
  onMarkChapter: (chapter: number, value: GuideReadState, contentHash: string | null) => Promise<unknown>;
  onBookmarkChapter: (chapter: number, value: boolean) => Promise<unknown>;
  onAnnotationOpenChange: (open: boolean) => void;
  onUpsertAnnotation: (draft: { id: string; questionId: string; kind: StudyAnnotation["kind"]; body: string; quote?: string; prefix?: string; suffix?: string; startOffset?: number | null; endOffset?: number | null }) => Promise<unknown>;
  onRemoveAnnotation: (id: string) => Promise<unknown>;
  onOpenLibrary: () => void;
};

function chapterLabel(chapter: number) {
  return `Chapter ${String(chapter).padStart(3, "0")}`;
}

const progressLabels: Record<GuideReadState, string> = { unread: "未開始", reading: "閱讀中", done: "已完成", later: "稍後閱讀" };
function guideReadingModeLabel(mode: GuideReadingMode) {
  if (mode === "quick") return "5 分鐘";
  return mode === "focus" ? "標準" : "完整";
}

function guideVariant(packId: GuidePackId, mode: GuideReadingMode, rawSelected: boolean): ReadingVariantValue {
  return {
    edition: packId,
    depth: rawSelected ? "raw" : mode === "focus" ? "standard" : mode,
  };
}

function guideModeFromDepth(depth: Exclude<ReadingDepth, "raw">): GuideReadingMode {
  return depth === "standard" ? "focus" : depth;
}

type GuideReadingPreference = {
  packId: GuidePackId;
  readingMode: GuideReadingMode;
  rawSelected: boolean;
};

const defaultGuideReadingPreference: GuideReadingPreference = {
  packId: "detailed",
  readingMode: "full",
  rawSelected: false,
};

function deserializeGuideReadingPreference(stored: string | null): GuideReadingPreference {
  if (!stored) return defaultGuideReadingPreference;
  const value = JSON.parse(stored) as { packId?: unknown; readingMode?: unknown; rawSelected?: unknown } | null;
  return {
    packId: value?.packId === "concise" || value?.packId === "detailed" ? value.packId : defaultGuideReadingPreference.packId,
    readingMode: value?.readingMode === "quick" || value?.readingMode === "focus" || value?.readingMode === "full" ? value.readingMode : defaultGuideReadingPreference.readingMode,
    rawSelected: value?.rawSelected === true,
  };
}

function serializeGuideReadingPreference(value: GuideReadingPreference) {
  return JSON.stringify(value);
}

const rawReadingDepthOption: ReadingDepthOption = {
  id: "raw",
  label: "進階內容",
  detail: "顯示未經整理的完整內容",
};

function chapterAvailable(chapter: StudyGuideChapter, packId: GuidePackId) {
  return Boolean(chapter.contents?.[packId]?.available);
}

export default function GuideView({ questions, requestedChapter, requestedAnnotationId, rawDraftMode, progressMap, progressStatus, annotations, annotationStatus, onSelectChapter, onOpenReader, onStartQuestions, onOpenChapter, onMarkChapter, onBookmarkChapter, onAnnotationOpenChange, onUpsertAnnotation, onRemoveAnnotation, onOpenLibrary }: Props) {
  const [catalog, setCatalog] = useState<StudyGuideCatalog | null>(null);
  const [links, setLinks] = useState<StudyGuideLinks | null>(null);
  const [displayedGuide, setDisplayedGuide] = useState<{ chapterId: number; packId: GuidePackId; mode: GuideReadingMode; raw: boolean; markdown: string } | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sectionId, setSectionId] = useState("all");
  const [status, setStatus] = useState<"all" | "available" | "linked">("all");
  const [progressFilter, setProgressFilter] = useState<GuideProgressFilterValue>("all");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const { level: fontSize, setLevel: setFontSize } = useReadingFontPreference();
  const [pendingExcerpt, setPendingExcerpt] = useState<AnnotationExcerptRequest | null>(null);
  const {
    value: { packId, readingMode, rawSelected },
    setValue: setReadingPreference,
  } = useNamespacedReadingVariantPreference({
    namespace: "tintinalli",
    defaultValue: defaultGuideReadingPreference,
    deserialize: deserializeGuideReadingPreference,
    serialize: serializeGuideReadingPreference,
  });
  const setPackId = useCallback((value: GuidePackId) => {
    setReadingPreference((current) => ({ ...current, packId: value }));
  }, [setReadingPreference]);
  const setReadingMode = useCallback((value: GuideReadingMode) => {
    setReadingPreference((current) => ({ ...current, readingMode: value }));
  }, [setReadingPreference]);
  const setRawSelected = useCallback((value: boolean) => {
    setReadingPreference((current) => ({ ...current, rawSelected: value }));
  }, [setReadingPreference]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const outlinePanelRef = useRef<HTMLElement>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const openedChapterRef = useRef<number | null>(null);
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

  useEffect(() => {
    if (requestedChapter !== null || !narrow || !catalog) return;
    void Promise.resolve().then(() => setLibraryOpen(true));
  }, [catalog, narrow, requestedChapter]);
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
    if (!rawDraftMode && rawSelected) {
      Promise.resolve().then(() => { if (active) setRawSelected(false); });
    }
    return () => { active = false; };
  }, [rawDraftMode, rawSelected, setRawSelected]);

  useEffect(() => {
    let active = true;
    Promise.all([loadStudyGuideCatalog(), loadStudyGuideLinks()])
      .then(([nextCatalog, nextLinks]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setLinks(nextLinks);
      })
      .catch(() => { if (active) setError("學習指引目錄暫時無法載入，請重新整理後再試。"); });
    return () => { active = false; };
  }, []);

  const selectedId = requestedChapter && requestedChapter >= 1 && requestedChapter <= 303 ? requestedChapter : 1;
  const requestedGuideScope = parseGuideAnnotationScope(requestedAnnotationId);
  const deepLinkScope = requestedGuideScope?.chapter === selectedId ? requestedGuideScope : null;
  // A deep link temporarily restores the annotation's rendered source. The
  // user's saved Guide edition/depth remains untouched and becomes active
  // again as soon as the drawer returns to the chapter's base route.
  const effectivePackId = deepLinkScope?.packId ?? packId;
  const effectiveReadingMode: GuideReadingMode = deepLinkScope
    ? deepLinkScope.mode === "raw" ? "full" : deepLinkScope.mode
    : readingMode;
  const rawActive = deepLinkScope
    ? deepLinkScope.mode === "raw" && rawDraftMode
    : rawDraftMode && rawSelected;
  const selectedChapter = catalog?.chapters.find((chapter) => chapter.id === selectedId) ?? null;
  const selectedProgress = progressMap.get(selectedId);
  const selectedPack = catalog?.packs.find((pack) => pack.id === effectivePackId) ?? null;
  const selectedPackContent = selectedChapter?.contents?.[effectivePackId] ?? null;
  const loadedReadingMode: GuideReadingMode = rawActive ? "full" : effectiveReadingMode;
  const selectedModeContent = selectedChapter ? resolveStudyGuideContent(selectedChapter, effectivePackId, loadedReadingMode) : null;
  const selectedAvailable = Boolean(selectedPackContent?.available && selectedModeContent);
  const selectedContentHash = selectedPackContent?.modes.full.contentHash ?? null;

  useEffect(() => {
    if (!catalog || catalog.packs.some((pack) => pack.id === packId && pack.status === "available")) return;
    const defaultPackId = catalog.defaultPackId;
    void Promise.resolve().then(() => setPackId(defaultPackId));
  }, [catalog, packId, setPackId]);

  useEffect(() => {
    if (!selectedChapter) return;
    let active = true;
    const next = catalog?.chapters.find((chapter) => chapter.id === selectedChapter.id + 1);
    Promise.resolve().then(() => {
      if (!active) return;
      setError("");
      if (!selectedAvailable) {
        setLoadingChapter(false);
        return;
      }
      setLoadingChapter(true);
      void loadStudyGuideMarkdown(selectedChapter, effectivePackId, loadedReadingMode)
        .then((value) => {
          if (!active) return;
          setDisplayedGuide({ chapterId: selectedChapter.id, packId: effectivePackId, mode: loadedReadingMode, raw: rawActive, markdown: value });
          if (next && chapterAvailable(next, effectivePackId)) {
            void loadStudyGuideMarkdown(next, effectivePackId, loadedReadingMode).catch(() => undefined);
          }
        })
        .catch((cause: unknown) => {
          console.error(`Unable to load ${chapterLabel(selectedChapter.id)} study guide`, cause);
          if (active) setError(`${chapterLabel(selectedChapter.id)} 的正文暫時無法載入。`);
        })
        .finally(() => { if (active) setLoadingChapter(false); });
    });
    return () => { active = false; };
  }, [catalog?.chapters, effectivePackId, loadedReadingMode, rawActive, selectedAvailable, selectedChapter, selectedModeContent?.contentHash]);

  useEffect(() => {
    if (requestedChapter === null || !selectedChapter || !selectedAvailable || progressStatus === "loading" || openedChapterRef.current === selectedChapter.id) return;
    openedChapterRef.current = selectedChapter.id;
    const initialize = async () => {
      await onOpenChapter(selectedChapter.id, selectedContentHash);
      // Only a chapter with no prior record is auto-started. An explicit
      // "未開始" choice, bookmark, or completed state must remain untouched.
      if (!selectedProgress) await onMarkChapter(selectedChapter.id, "reading", selectedContentHash);
    };
    void initialize().catch(() => {
      if (openedChapterRef.current === selectedChapter.id) openedChapterRef.current = null;
    });
  }, [onMarkChapter, onOpenChapter, progressStatus, requestedChapter, selectedAvailable, selectedChapter, selectedContentHash, selectedProgress]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-Hant");
  const filteredChapters = (catalog?.chapters ?? []).filter((chapter) => {
    if (sectionId !== "all" && chapter.sectionId !== Number(sectionId)) return false;
    if (status === "available" && !chapterAvailable(chapter, effectivePackId)) return false;
    if (status === "linked" && chapter.linkedQuestionCount === 0) return false;
    const progress = progressMap.get(chapter.id);
    if (!matchesGuideProgressFilter(progress, progressFilter)) return false;
    if (!normalizedQuery) return true;
    return [String(chapter.id), String(chapter.id).padStart(3, "0"), chapter.title, chapter.sectionTitle]
      .join(" ").toLocaleLowerCase("zh-Hant").includes(normalizedQuery);
  });
  const warmChapter = useCallback((chapterKey: string) => {
    const chapter = catalog?.chapters.find((candidate) => String(candidate.id) === chapterKey);
    if (chapter && chapterAvailable(chapter, effectivePackId)) {
      void loadStudyGuideMarkdown(chapter, effectivePackId, loadedReadingMode).catch(() => undefined);
    }
  }, [catalog?.chapters, effectivePackId, loadedReadingMode]);
  const prefetchWatchKey = filteredChapters.map((chapter) => (
    `${chapter.id}:${resolveStudyGuideContent(chapter, effectivePackId, loadedReadingMode)?.contentHash ?? "missing"}`
  )).join("|");
  useVisibleContentPrefetch(chapterListRef, warmChapter, prefetchWatchKey, Boolean(catalog));

  const questionMap = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const relatedQuestions = useMemo(() => (links?.chapterToQuestions[String(selectedId)] ?? [])
    .map((id) => questionMap.get(id))
    .filter((question): question is QuestionIndex => Boolean(question)), [links?.chapterToQuestions, questionMap, selectedId]);
  const relatedPracticeIds = useMemo(
    () => relatedQuestions.filter((question) => !question.excludedFromPractice && !question.allCredit).map((question) => question.id),
    [relatedQuestions],
  );
  const relatedPracticeCount = useMemo(
    () => new Set(relatedQuestions.filter((question) => !question.excludedFromPractice && !question.allCredit).map((question) => question.canonicalId ?? question.id)).size,
    [relatedQuestions],
  );
  const guideEditionOptions = useMemo<ReadingEditionOption[]>(() => {
    const conciseAvailable = Boolean(selectedChapter?.contents?.concise?.available);
    const detailedAvailable = Boolean(selectedChapter?.contents?.detailed?.available);
    return [
      {
        id: "concise",
        label: "精要學習指引",
        detail: "較簡短的一套章節指引",
        disabled: !conciseAvailable,
        reason: "本章精要版尚未提供",
      },
      {
        id: "detailed",
        label: "詳細學習指引",
        detail: "非常完整的一套章節指引",
        disabled: !detailedAvailable,
        reason: catalog?.packs.find((pack) => pack.id === "detailed")?.status === "coming_soon" ? "詳細版尚未開放" : "本章詳細版尚未提供",
      },
    ];
  }, [catalog?.packs, selectedChapter]);
  const guideDepthOptions = useMemo<ReadingDepthOption[]>(() => (
    rawDraftMode ? [...defaultReadingDepthOptions, rawReadingDepthOption] : defaultReadingDepthOptions
  ), [rawDraftMode]);
  // Keep the previous depth visible while the next one loads. The fallback is
  // limited to the same chapter and edition so content never appears under a
  // different chapter heading or pack label.
  const visibleGuide = displayedGuide?.chapterId === selectedId && displayedGuide.packId === effectivePackId
    ? displayedGuide
    : null;
  const loadedMarkdown = visibleGuide?.markdown ?? "";
  const displayedRaw = visibleGuide?.raw ?? false;
  const markdown = useMemo(() => (
    displayedRaw || !loadedMarkdown
      ? loadedMarkdown
      : normalizeStudyGuideDocumentTitle(
        sanitizeStudyGuideMarkdown(loadedMarkdown),
        selectedChapter?.title ?? "",
      )
  ), [displayedRaw, loadedMarkdown, selectedChapter?.title]);
  const {
    actionLabel: selectedAudioActionLabel,
    accessibleLabel: selectedAudioAccessibleLabel,
    open: openChapterAudioPlayer,
    prepare: prepareChapterAudio,
    source: selectedAudio,
  } = useLearningAudio({
    contentReady: Boolean(markdown),
    noun: "章",
    resource: { kind: "textbook-chapter", textbookId: "tintinalli", chapterId: selectedId },
  });
  const outline = useMemo(() => displayedRaw ? [] : extractMarkdownOutline(markdown), [displayedRaw, markdown]);
  const chapterTitleExcerpt = useMemo(
    () => markdown ? firstMarkdownH1Excerpt(markdown, selectedChapter?.title ?? "") : null,
    [markdown, selectedChapter?.title],
  );
  const completedImported = (catalog?.chapters ?? []).filter((chapter) => chapterAvailable(chapter, effectivePackId) && progressMap.get(chapter.id)?.readState === "done").length;
  const annotationResourceId = guideAnnotationResourceId(selectedId)!;
  const annotationMode = deepLinkScope?.mode ?? (displayedRaw ? "raw" : visibleGuide?.mode ?? loadedReadingMode);
  const annotationReadingLocked = Boolean(requestedAnnotationId);
  const annotationPrefix = guideAnnotationScopePrefix(annotationResourceId, `${effectivePackId}-${annotationMode}`)!;
  const annotationSource = useMemo<ContentAnnotationSource>(() => ({
    resourceId: annotationResourceId,
    eyebrow: chapterLabel(selectedId),
    panelLabel: "本章筆記",
    rootNoteTitle: "章節筆記",
    rootNoteDescription: "整理本章重點與待查事項",
    rootNotePlaceholder: "整理本章重點、容易混淆處或待查問題…",
    emptyHint: "可反白正文，或直接將表格與各層標題加入筆記。",
    kind: "guide",
    annotationPrefix,
    contentScope: annotationMode,
  }), [annotationMode, annotationPrefix, annotationResourceId, selectedId]);

  const commitReadingVariant = (next: ReadingVariantValue) => {
    setPackId(next.edition);
    if (next.depth === "raw") {
      if (!rawDraftMode) return;
      setRawSelected(true);
      setReadingMode("full");
    } else {
      setRawSelected(false);
      setReadingMode(guideModeFromDepth(next.depth));
    }
    setMobileToolsOpen(false);
  };

  const selectChapter = useCallback((chapter: number) => {
    setLibraryOpen(false);
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    onSelectChapter(chapter);
    scrollPageToTop();
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [onSelectChapter]);

  const openChapterLibrary = () => {
    setMobileToolsOpen(false);
    setLibraryOpen(true);
  };

  const openSelectedAudio = () => {
    openChapterAudioPlayer();
    setMobileToolsOpen(false);
  };

  const readingNavigation = useReadingNavigation({
    onPrevious: () => selectChapter(selectedId - 1),
    onNext: () => selectChapter(selectedId + 1),
    canPrevious: selectedId > 1,
    canNext: selectedId < 303,
    enabled: selectedAvailable,
  });

  if (error && !catalog) return <main className="workspace-page"><div className="empty-state" role="alert"><BookOpenText /><h2>學習指引目錄載入失敗</h2><p>{error}</p><button className="outline-button" onClick={() => window.location.reload()}>重新載入</button></div></main>;
  if (!catalog || !links) return <LearningReaderLoadingShell sourceId="tintinalli" description="303 章學習指引、章節目錄與共用閱讀工具。" />;
  if (!selectedChapter) return null;

  return (
    <main className="guide-page">
      <ReadingCatalogLayer portal={narrow}>
        <aside
        id="tintinalli-guide-library"
        ref={libraryRef}
        className={`guide-library swipe-dismiss-panel ${libraryOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-label="303 章學習指引目錄"
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
          <div><p>TINTINALLI · 9TH EDITION</p><h1>{LEARNING_SOURCE_REGISTRY.tintinalli.title}</h1></div>
          <button className="guide-list-close" aria-label="關閉章節目錄" onClick={() => setLibraryOpen(false)}><X /></button>
          <GuideTextbookSwitcher currentTextbook={LEARNING_SOURCE_REGISTRY.tintinalli.title} onOpenLibrary={onOpenLibrary} />
          <span>已完成 <strong>{completedImported}</strong> / {selectedPack?.importedChapters ?? 0} 章 · {selectedPack?.label ?? "學習指引"}</span>
        </header>
        <label className="guide-search" data-swipe-dismiss-ignore=""><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋章號或章名" aria-label="搜尋學習指引章節" /></label>
        <div className="guide-filters" data-swipe-dismiss-ignore="">
          <select value={sectionId} onChange={(event) => setSectionId(event.target.value)} aria-label="依 Section 篩選學習指引"><option value="all">全部 26 Sections</option>{catalog.sections.map((section) => <option key={section.id} value={section.id}>Section {section.id}・{section.title}</option>)}</select>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="依內容狀態篩選學習指引"><option value="all">全部 303 章</option><option value="available">內容可閱讀</option><option value="linked">已有相關考題</option></select>
          <GuideProgressFilter value={progressFilter} onChange={setProgressFilter} ariaLabel="依個人進度篩選 Tintinalli 章節" />
        </div>
        <div ref={chapterListRef} className="guide-chapter-list">
          {filteredChapters.map((chapter, index) => (
            <Fragment key={chapter.id}>
              {(index === 0 || filteredChapters[index - 1]?.sectionId !== chapter.sectionId) && <div className="guide-section-label"><span>Section {chapter.sectionId}</span><strong>{chapter.sectionTitle}</strong></div>}
              <button
                data-content-prefetch={String(chapter.id)}
                aria-current={selectedId === chapter.id ? "true" : undefined}
                className={selectedId === chapter.id ? "active" : ""}
                onPointerEnter={() => warmChapter(String(chapter.id))}
                onPointerDown={() => warmChapter(String(chapter.id))}
                onFocus={() => warmChapter(String(chapter.id))}
                onClick={() => selectChapter(chapter.id)}
              >
                <span>{String(chapter.id).padStart(3, "0")}</span>
                <div><strong>{chapter.title}</strong><small>{progressLabels[progressMap.get(chapter.id)?.readState ?? "unread"]}・{chapterAvailable(chapter, effectivePackId) ? "可閱讀" : "內容尚未提供"}・{chapter.linkedQuestionCount} 題</small></div>
                {progressMap.get(chapter.id)?.bookmarked === 1 ? <Bookmark size={14} fill="currentColor" /> : progressMap.get(chapter.id)?.readState === "done" ? <CheckCircle2 size={14} /> : <ChevronRight size={14} />}
              </button>
            </Fragment>
          ))}
          {!filteredChapters.length && <p className="guide-list-empty">沒有符合目前條件的章節。</p>}
        </div>
        </aside>

        {libraryOpen && <button className="guide-drawer-backdrop" aria-label="關閉章節目錄" onClick={() => setLibraryOpen(false)} />}
      </ReadingCatalogLayer>

      <section className={`guide-workspace reader-size-${fontSize}`} style={{ "--guide-font-size": `${[14, 16, 18][fontSize]}px` } as CSSProperties}>
        <GuideReaderToolbar
          ariaLabel="學習指引閱讀工具"
          libraryTriggerRef={libraryTriggerRef}
          libraryAriaLabel="開啟 303 章學習指引目錄"
          libraryControlsId="tintinalli-guide-library"
          libraryOpen={libraryOpen}
          showLibraryTrigger={narrow}
          onOpenLibrary={openChapterLibrary}
          positionCurrent={String(selectedId).padStart(3, "0")}
          positionTotal={303}
          navigation={{ noun: "章", canPrevious: selectedId > 1, canNext: selectedId < 303, onPrevious: () => selectChapter(selectedId - 1), onNext: () => selectChapter(selectedId + 1) }}
          outlineTriggerRef={outlineTriggerRef}
          outlineAvailable={outline.length > 0}
          outlineControlsId="guide-toc-sheet"
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
          mobileToolsControlsId="guide-mobile-tools"
          mobileToolsOpen={mobileToolsOpen}
          showMobileToolsTrigger={compactTools}
          onOpenMobileTools={() => setMobileToolsOpen(true)}
        />

        {outlineOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setOutlineOpen(false)}><section ref={outlinePanelRef} id="guide-toc-sheet" tabIndex={-1} className="reader-toc-sheet guide-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="本章文章目錄" onClick={(event) => event.stopPropagation()}><header><strong>本章目錄</strong><button data-overlay-close aria-label="關閉文章目錄" onClick={() => setOutlineOpen(false)}><X /></button></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => { scrollElementIntoView(document.getElementById(item.id), { block: "start" }); setOutlineOpen(false); }}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        <GuideReaderToolsPanel
          panelRef={mobileToolsRef}
          id="guide-mobile-tools"
          open={compactTools && mobileToolsOpen}
          hidden={compactTools && !mobileToolsOpen}
          ariaLabel="Tintinalli 學習指引閱讀工具"
          summary={`${selectedPack?.label ?? "學習指引"}・${rawActive ? "進階內容" : guideReadingModeLabel(effectiveReadingMode)}`}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="學習指引文字"
          onClose={() => setMobileToolsOpen(false)}
          currentTextbook={LEARNING_SOURCE_REGISTRY.tintinalli.title}
          onOpenLibrary={onOpenLibrary}
          navigation={(
            <div className="guide-rail-navigation">
              <button className="guide-rail-current" aria-label="開啟 303 章目錄" aria-controls="tintinalli-guide-library" aria-expanded={libraryOpen} onClick={openChapterLibrary}><Library size={17} /><span><small>SECTION {selectedChapter.sectionId}</small><strong>{chapterLabel(selectedId)} <em>/ 303</em></strong></span></button>
              <ReadingNextPrev className="guide-rail-step-controls" noun="章" canPrevious={selectedId > 1} canNext={selectedId < 303} onPrevious={() => selectChapter(selectedId - 1)} onNext={() => selectChapter(selectedId + 1)} />
              <div className="reader-rail-secondary"><ReadingFontControls className="reader-rail-font" level={fontSize} onChange={setFontSize} noun="學習指引文字" /></div>
            </div>
          )}
          audioAction={selectedAudio ? (
            <button type="button" className="guide-audio-action" aria-label={selectedAudioAccessibleLabel} onPointerDown={prepareChapterAudio} onClick={openSelectedAudio}>
              <span className="guide-audio-action-icon"><Headphones aria-hidden="true" /></span>
              <span><small>學習音檔</small><strong>{selectedAudioActionLabel}</strong></span>
              <Headphones aria-hidden="true" />
            </button>
          ) : undefined}
          progressActions={{
            available: selectedAvailable,
            readState: selectedProgress?.readState ?? "unread",
            bookmarked: selectedProgress?.bookmarked === 1,
            onToggleLater: () => void onMarkChapter(selectedId, selectedProgress?.readState === "later" ? "reading" : "later", selectedContentHash),
            onToggleDone: () => void onMarkChapter(selectedId, selectedProgress?.readState === "done" ? "reading" : "done", selectedContentHash),
            onToggleBookmark: () => void onBookmarkChapter(selectedId, selectedProgress?.bookmarked !== 1),
            annotationControl: <ContentAnnotationTools source={annotationSource} contentKey={`${annotationResourceId}:${effectivePackId}:${annotationMode}:${visibleGuide ? (selectedContentHash ?? "ready") : "loading"}`} annotations={annotations} annotationStatus={progressStatus === "loading" || Boolean(selectedProgress?.note.trim()) ? "loading" : annotationStatus} requestedAnnotationId={requestedAnnotationId} pendingExcerpt={pendingExcerpt} onExcerptHandled={() => setPendingExcerpt(null)} onOpenChange={onAnnotationOpenChange} onUpsert={onUpsertAnnotation} onRemove={onRemoveAnnotation} />,
          }}
          onActionCapture={() => setMobileToolsOpen(false)}
          variantSelector={(
            <div className="guide-reading-variant">
              <ReadingVariantSelector
                value={guideVariant(effectivePackId, effectiveReadingMode, rawActive)}
                editionOptions={guideEditionOptions}
                depthOptions={guideDepthOptions}
                busy={loadingChapter}
                locked={annotationReadingLocked}
                lockedReason="正顯示筆記建立時的學習指引；關閉筆記後可切換。"
                ariaLabel="學習指引版本與閱讀程度選擇器"
                onCommit={commitReadingVariant}
              />
              {annotationReadingLocked && <p className="reader-preference-lock" role="status">正顯示筆記建立時的學習指引；關閉筆記後可切換。</p>}
            </div>
          )}
          outlineItems={outline}
          outlineAriaLabel="本章文章目錄"
          onSelectOutline={(id) => scrollElementIntoView(document.getElementById(id), { block: "start" })}
        />

        <div className="guide-reading-column">

          <header className="guide-chapter-header">
            <p>SECTION {selectedChapter.sectionId}・{selectedChapter.sectionTitle}</p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className={chapterTitleExcerpt ? "has-annotation-action" : undefined}
              data-content-annotation-companion={chapterTitleExcerpt ? annotationResourceId : undefined}
              data-annotation-anchor={chapterTitleExcerpt?.sourceAnchor}
              data-annotation-block-key={chapterTitleExcerpt ? annotationBlockKey(chapterTitleExcerpt.block, chapterTitleExcerpt.markdown) : undefined}
            >
              <span>{chapterLabel(selectedChapter.id)}</span>{selectedChapter.title}
              {chapterTitleExcerpt && <AnnotationBlockAction label="主標題" excerpt={chapterTitleExcerpt} onAddToNotes={setPendingExcerpt} />}
            </h1>
            <div><span><Link2 size={15} />{relatedQuestions.length} 題歷屆題目</span><span className={selectedAvailable ? "ready" : "pending"}>{selectedAvailable ? `${selectedPack?.label}・${rawActive ? "進階內容" : guideReadingModeLabel(effectiveReadingMode)}` : "此版本尚未提供"}</span><label className="guide-read-state">我的進度<select value={selectedProgress?.readState ?? "unread"} onChange={(event) => void onMarkChapter(selectedId, event.target.value as GuideReadState, selectedContentHash)}><option value="unread">未開始</option><option value="reading" disabled={!selectedAvailable}>閱讀中</option><option value="done" disabled={!selectedAvailable}>已完成</option><option value="later">稍後閱讀</option></select></label></div>
          </header>

          {outline.length > 0 && <nav className="guide-outline guide-outline-inline" aria-label="本章正文目錄"><header><ListTree size={17} /><span>本章目錄・{outline.length}</span></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollElementIntoView(document.getElementById(item.id), { block: "start" })}>{item.label}</button>)}</nav>}

          {loadingChapter && !markdown && <div className="guide-body-state" role="status"><Clock3 /><span>正在載入本章正文…</span></div>}
          {selectedAvailable && markdown && <article data-content-annotation-root={annotationResourceId} className={`guide-article paper-card reading-paper-surface reading-content-swap ${displayedRaw ? "guide-raw-source" : ""} ${loadingChapter ? "is-refreshing" : ""}`} aria-busy={loadingChapter} aria-label={`${chapterLabel(selectedChapter.id)} ${displayedRaw ? "進階內容" : `${guideReadingModeLabel(visibleGuide?.mode ?? effectiveReadingMode)}學習指引正文`}`} {...readingNavigation}>{displayedRaw ? <pre><code>{markdown}</code></pre> : <MarkdownContent markdown={markdown} variant="guide" documentTitle={selectedChapter.title} onAddToNotes={setPendingExcerpt} />}</article>}
          {!loadingChapter && !selectedAvailable && (
            <article className="guide-import-placeholder paper-card">
              <BookOpenText />
              <p>{selectedPack?.label ?? "學習指引"}</p>
              <h2>這個內容版本尚未提供</h2>
              <p>這一章目前沒有此內容版本；可切換至另一個可閱讀版本，收藏、筆記與閱讀進度都會保留。</p>
              {relatedQuestions.length > 0 && <button className="outline-button" onClick={() => onOpenReader(relatedQuestions[0].id)}>先閱讀本章相關題目<ArrowRight size={17} /></button>}
            </article>
          )}
          {error && catalog && <p className="form-notice" role="alert">{error}</p>}

          <section className="guide-related paper-card" aria-labelledby="guide-related-heading">
            <header><div><p>題目連結</p><h2 id="guide-related-heading">本章相關歷屆題目</h2></div><div className="guide-related-actions"><strong>{relatedQuestions.length}</strong>{relatedPracticeIds.length > 0 && <button className="primary-button" onClick={() => onStartQuestions(relatedPracticeIds)}><Play size={15} fill="currentColor" />練習本章 {relatedPracticeCount} 個觀念</button>}</div></header>
            {relatedQuestions.length ? <div className="guide-related-list">{relatedQuestions.map((question) => <button key={question.id} onClick={() => onOpenReader(question.id)}><span>{question.id}</span><div><strong>{question.title}</strong><small>{question.category}・{question.focus}</small></div><ArrowRight size={16} /></button>)}</div> : <div className="guide-related-empty"><Link2 /><p>這一章目前沒有相關題目。</p></div>}
          </section>

          <ReadingNextPrev className="guide-next-prev" variant="titles" noun="章" canPrevious={selectedId > 1} canNext={selectedId < 303} previousTitle={catalog.chapters[selectedId - 2]?.title ?? ""} nextTitle={catalog.chapters[selectedId]?.title ?? ""} onPrevious={() => selectChapter(selectedId - 1)} onNext={() => selectChapter(selectedId + 1)} />
        </div>
      </section>
    </main>
  );
}
