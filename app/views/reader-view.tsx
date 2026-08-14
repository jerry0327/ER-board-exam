"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookCheck, Bookmark, Check, Clock3, Grid3X3, Headphones, Link2, List, ListTree, Search, SlidersHorizontal, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationSource } from "../components/content-annotation-tools";
import QuestionLoading from "../components/question-loading";
import QuestionSheet from "../components/question-sheet";
import TraceContextRail from "../components/trace-context-rail";
import TraceabilityPanel from "../components/traceability-panel";
import type { TraceabilityItem } from "../components/traceability-types";
import ReadingFontControls from "../components/reading-font-controls";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingNextPrev from "../components/reading-next-prev";
import ReadingVariantSelector, { defaultReadingDepthOptions, type ReadingDepthOption, type ReadingEditionOption, type ReadingVariantValue } from "../components/reading-variant-selector";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { useVisibleContentPrefetch } from "../hooks/use-visible-content-prefetch";
import { annotationBlockScopeFrom } from "../lib/annotation-block-anchor";
import { parseReaderAnnotationScope, readerAnnotationScopePrefix } from "../lib/annotation-source";
import { createHeadingSlugger, plainMarkdownHeading } from "../lib/markdown-heading";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import { explanationForMode, type ExplanationMode } from "../lib/explanation-mode";
import { loadQuestion, loadSearchCatalog, matchesSearch, prefetchQuestion } from "../lib/question-data";
import {
  boardTraceTargetLabel,
  loadBoardQuestionTrace,
  loadBoardTraceLocatorIndex,
  primaryTraceLocation,
  reconcileBoardTraceLocations,
  traceLocationsForTarget,
  type BoardQuestionTrace,
  type BoardTraceHumanLocator,
  type BoardTraceTarget,
} from "../lib/board-trace";
import { annotationExplanationPack, explanationPacks, prefetchQuestionExplanation, resolveExplanation, type ExplanationPackId } from "../lib/explanation-packs";
import type { AnnotationExcerptRequest, FullQuestion, Manifest, ProgressRecord, QuestionIndex, StudyAnnotation } from "../lib/types";

type Props = {
  manifest: Manifest;
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  requestedQuestionId?: string | null;
  requestedAnnotationId?: string | null;
  explanationPack: ExplanationPackId;
  explanationMode: ExplanationMode;
  rawDraftMode: boolean;
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  onExplanationSelectionChange: (packId: ExplanationPackId, mode: ExplanationMode) => void;
  onBookmark: (questionId: string, value: boolean) => Promise<unknown>;
  onMarkRead: (questionId: string, value: "reading" | "done" | "later" | "unread") => Promise<unknown>;
  onSelectQuestion: (questionId: string) => void;
  onOpenGuide: (chapter: number) => void;
  onAnnotationOpenChange: (open: boolean) => void;
  onUpsertAnnotation: (draft: { id: string; questionId: string; kind: StudyAnnotation["kind"]; body: string; quote?: string; prefix?: string; suffix?: string; startOffset?: number | null; endOffset?: number | null }) => Promise<unknown>;
  onRemoveAnnotation: (id: string) => Promise<unknown>;
  questionLoader?: (question: QuestionIndex) => Promise<FullQuestion>;
  questionPrefetcher?: (question: QuestionIndex) => void;
  searchCatalogLoader?: (() => Promise<void>) | null;
  annotationsEnabled?: boolean;
  variantSelectionEnabled?: boolean;
  headerActions?: ReactNode;
  requestedTraceTarget?: BoardTraceTarget | null;
  onOpenBoardTrace?: (unitCode: string, nodeId?: string | null, questionId?: string | null, target?: BoardTraceTarget | null) => void;
};

type QuestionTraceState = {
  questionId: string;
  trace: BoardQuestionTrace | null;
  loading: boolean;
};

function explanationModeLabel(mode: ExplanationMode, compact = false) {
  if (mode === "quick") return compact ? "速讀" : "重點速讀";
  if (mode === "standard") return compact ? "標準" : "標準閱讀";
  if (mode === "raw") return "進階內容";
  return compact ? "完整" : "完整詳解";
}

function explanationVariant(packId: ExplanationPackId, mode: ExplanationMode): ReadingVariantValue {
  return {
    edition: packId === "concise" ? "concise" : "detailed",
    depth: mode,
  };
}

const explanationEditionOptions: ReadingEditionOption[] = [
  { id: "concise", label: "精要詳解", detail: "較簡短的一套詳解內容" },
  { id: "detailed", label: "詳細詳解", detail: "非常完整的一套詳解內容" },
];

const rawExplanationDepthOption: ReadingDepthOption = {
  id: "raw",
  label: "進階內容",
  detail: "檢視完整原稿",
};

function isExplanationMode(value: string | null): value is ExplanationMode {
  return value === "quick" || value === "standard" || value === "full" || value === "raw";
}

function boardTraceSectionTitle(unitCode: string, human?: BoardTraceHumanLocator) {
  if (!human) return `單元 ${unitCode}`;
  return human.sectionOrdinal > 0
    ? `單元 ${unitCode}・第 ${human.sectionOrdinal} 節`
    : `單元 ${unitCode}・導讀`;
}

export default function ReaderView({
  manifest,
  questions,
  progressMap,
  requestedQuestionId,
  requestedAnnotationId,
  explanationPack,
  explanationMode,
  rawDraftMode,
  annotations,
  annotationStatus,
  onExplanationSelectionChange,
  onBookmark,
  onMarkRead,
  onSelectQuestion,
  onOpenGuide,
  onAnnotationOpenChange,
  onUpsertAnnotation,
  onRemoveAnnotation,
  questionLoader = loadQuestion,
  questionPrefetcher = prefetchQuestion,
  searchCatalogLoader = loadSearchCatalog,
  annotationsEnabled = true,
  variantSelectionEnabled = true,
  headerActions,
  requestedTraceTarget,
  onOpenBoardTrace,
}: Props) {
  const [query, setQuery] = useState("");
  const [exam, setExam] = useState("all");
  const [category, setCategory] = useState("all");
  const [sourceSection, setSourceSection] = useState("all");
  const [readState, setReadState] = useState("all");
  const [chooserExam, setChooserExam] = useState("");
  const [jumpOpen, setJumpOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [jumpNumber, setJumpNumber] = useState("");
  const [selectedId, setSelectedId] = useState(requestedQuestionId ?? "");
  const [loaded, setLoaded] = useState<{ key: string; question: FullQuestion | null; explanation: string; requestedPackId: ExplanationPackId; resolvedPackId: ExplanationPackId; mode: ExplanationMode; fallback: boolean }>({ key: "", question: null, explanation: "", requestedPackId: "original", resolvedPackId: "original", mode: "full", fallback: false });
  const [loadState, setLoadState] = useState<{ key: string; busy: boolean; error: string }>({ key: "", busy: false, error: "" });
  const { level: fontSize, setLevel: setFontSize } = useReadingFontPreference();
  const [listOpen, setListOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [searchVersion, setSearchVersion] = useState(0);
  const [pendingExcerpt, setPendingExcerpt] = useState<AnnotationExcerptRequest | null>(null);
  const [questionTraceState, setQuestionTraceState] = useState<QuestionTraceState>({ questionId: "", trace: null, loading: false });
  const [traceLocatorIndexes, setTraceLocatorIndexes] = useState<Map<string, Map<string, BoardTraceHumanLocator>>>(new Map());
  const [tracePanelOpen, setTracePanelOpen] = useState(false);
  const [activeTraceTarget, setActiveTraceTarget] = useState<BoardTraceTarget>(requestedTraceTarget ?? "stem");
  const [activeTraceElement, setActiveTraceElement] = useState<HTMLElement | null>(null);
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(false);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const jumpPanelRef = useRef<HTMLElement>(null);
  const jumpTriggerRef = useRef<HTMLButtonElement>(null);
  const tocPanelRef = useRef<HTMLElement>(null);
  const tocTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const internalRequestRef = useRef<string | null>(null);
  const questionListRef = useRef<HTMLDivElement>(null);
  const questionArticleRef = useRef<HTMLDivElement>(null);
  const traceTriggerRef = useRef<HTMLButtonElement>(null);
  const traceLocatorRequestRef = useRef(0);
  const narrow = useMediaQueryMatch("(max-width: 1140px)");
  const compactTools = useMediaQueryMatch("(max-width: 1440px)");
  const librarySwipe = useHorizontalSwipeDismiss<HTMLElement>({
    direction: "left",
    enabled: narrow && listOpen,
    onDismiss: () => setListOpen(false),
  });

  useOverlayFocusManagement({
    open: narrow && listOpen,
    panelRef: libraryRef,
    triggerRef: libraryTriggerRef,
    onClose: () => setListOpen(false),
    dismissWhenMediaQueryStopsMatching: "(max-width: 1140px)",
  });
  useOverlayFocusManagement({
    open: mobileToolsOpen,
    panelRef: mobileToolsRef,
    triggerRef: mobileToolsTriggerRef,
    onClose: () => setMobileToolsOpen(false),
    dismissWhenMediaQueryStopsMatching: "(max-width: 1440px)",
  });
  useOverlayFocusManagement({
    open: jumpOpen,
    panelRef: jumpPanelRef,
    triggerRef: jumpTriggerRef,
    onClose: () => setJumpOpen(false),
    initialFocusSelector: "[data-overlay-close]",
  });
  useOverlayFocusManagement({
    open: tocOpen,
    panelRef: tocPanelRef,
    triggerRef: tocTriggerRef,
    onClose: () => setTocOpen(false),
    dismissWhenMediaQueryStopsMatching: "(max-width: 600px)",
    initialFocusSelector: "[data-overlay-close]",
  });

  const readerAnnotationScope = parseReaderAnnotationScope(requestedAnnotationId);
  const annotationPack = annotationExplanationPack(requestedAnnotationId);
  const requestedAnnotation = requestedAnnotationId
    ? annotations.find((item) => item.id === requestedAnnotationId)
    : undefined;
  const storedAnnotationMode = requestedAnnotation ? annotationBlockScopeFrom(requestedAnnotation) : null;
  const requestedAnnotationMode = readerAnnotationScope?.mode ?? storedAnnotationMode;
  const annotationMode = isExplanationMode(requestedAnnotationMode)
    && (requestedAnnotationMode !== "raw" || rawDraftMode)
    ? requestedAnnotationMode
    : null;
  const annotationHasReadingScope = Boolean(readerAnnotationScope || annotationPack || storedAnnotationMode);
  const annotationReadingLocked = Boolean(requestedAnnotationId);
  const effectiveExplanationPack = annotationPack ?? explanationPack;
  const effectiveExplanationMode: ExplanationMode = annotationHasReadingScope ? annotationMode ?? "full" : explanationMode;
  const explanationDepthOptions = useMemo<ReadingDepthOption[]>(() => (
    rawDraftMode ? [...defaultReadingDepthOptions, rawExplanationDepthOption] : defaultReadingDepthOptions
  ), [rawDraftMode]);

  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    if (!searchCatalogLoader) return;
    void searchCatalogLoader().then(() => { if (active) setSearchVersion(1); }).catch(() => undefined);
    return () => { active = false; };
  }, [query, searchCatalogLoader]);

  const examCards = useMemo(() => [...manifest.groups].reverse().map((group) => {
    const groupQuestions = questions.filter((question) => question.exam === group.id);
    const readCount = groupQuestions.filter((question) => progressMap.get(question.id)?.readState === "done").length;
    const count = groupQuestions.length || group.count;
    return {
      ...group,
      count,
      readCount,
      percent: count ? Math.round(readCount / count * 100) : 0,
    };
  }), [manifest.groups, progressMap, questions]);
  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const warmQuestion = useCallback((id: string) => {
    const question = questionById.get(id);
    if (!question) return;
    questionPrefetcher(question);
    prefetchQuestionExplanation(question, effectiveExplanationPack);
  }, [effectiveExplanationPack, questionById, questionPrefetcher]);

  const selectQuestion = useCallback((id: string) => {
    warmQuestion(id);
    setSelectedId(id);
    setListOpen(false);
    setJumpOpen(false);
    setTocOpen(false);
    setMobileToolsOpen(false);
    setNotice("");
    internalRequestRef.current = id;
    onSelectQuestion(id);
  }, [onSelectQuestion, warmQuestion]);

  useEffect(() => {
    if (!requestedQuestionId) {
      internalRequestRef.current = null;
      Promise.resolve().then(() => {
        setSelectedId("");
        setLoaded({ key: "", question: null, explanation: "", requestedPackId: "original", resolvedPackId: "original", mode: "full", fallback: false });
        setLoadState({ key: "", busy: false, error: "" });
        setQuery("");
        setExam("all");
        setCategory("all");
        setSourceSection("all");
        setReadState("all");
        setNotice("");
      });
      return;
    }
    const requested = questions.find((item) => item.id === requestedQuestionId);
    const target = requested ?? questions[0];
    if (!target) return;
    const internalRequest = internalRequestRef.current === requestedQuestionId;
    internalRequestRef.current = null;
    Promise.resolve().then(() => {
      if (!internalRequest) {
        setQuery("");
        setExam(target.exam);
        setCategory("all");
        setSourceSection("all");
        setReadState("all");
      }
      setSelectedId(target.id);
      if (requested) {
        if (!internalRequest) setNotice("");
        return;
      }
      setNotice(`找不到 ${requestedQuestionId}，已回到題庫第一篇詳解。`);
      internalRequestRef.current = target.id;
      onSelectQuestion(target.id);
    });
  }, [onSelectQuestion, questions, requestedQuestionId]);

  const filtered = useMemo(() => questions.filter((item) => {
    if (exam !== "all" && item.exam !== exam) return false;
    if (category !== "all" && item.category !== category) return false;
    if (sourceSection !== "all" && !item.sourceSections.includes(Number(sourceSection))) return false;
    if (!matchesSearch(item, query, searchVersion)) return false;
    const progress = progressMap.get(item.id);
    if (readState === "done" && progress?.readState !== "done") return false;
    if (readState === "later" && progress?.readState !== "later") return false;
    if (readState === "unread" && progress?.readState === "done") return false;
    if (readState === "bookmarked" && progress?.bookmarked !== 1) return false;
    return true;
  }), [category, exam, progressMap, query, questions, readState, searchVersion, sourceSection]);
  const listedQuestions = useMemo(
    () => filtered.slice(0, exam === "all" ? 120 : filtered.length),
    [exam, filtered],
  );
  const prefetchWatchKey = listedQuestions.map((question) => `${question.id}:${question.contentHash ?? "unversioned"}`).join("|");
  useVisibleContentPrefetch(questionListRef, warmQuestion, prefetchWatchKey, listedQuestions.length > 0);

  useEffect(() => {
    if (!selectedId || !filtered.length || filtered.some((item) => item.id === selectedId)) return;
    const nextId = filtered[0].id;
    Promise.resolve().then(() => {
      setSelectedId(nextId);
      setNotice("");
      internalRequestRef.current = nextId;
      onSelectQuestion(nextId);
    });
  }, [filtered, onSelectQuestion, selectedId]);

  useEffect(() => {
    const index = questions.find((item) => item.id === selectedId);
    if (!index) return;
    let active = true;
    const key = `${selectedId}:${effectiveExplanationPack}`;
    const targetMode = effectiveExplanationMode;
    Promise.resolve().then(() => {
      if (active) setLoadState({ key, busy: true, error: "" });
    });
    questionLoader(index)
      .then(async (item) => ({ item, explanation: await resolveExplanation(item, effectiveExplanationPack) }))
      .then(({ item, explanation }) => {
        if (active) {
          setLoaded({ key, question: item, explanation: explanation.markdown, requestedPackId: effectiveExplanationPack, resolvedPackId: explanation.resolvedPackId, mode: targetMode, fallback: explanation.fallback });
          setLoadState({ key, busy: false, error: "" });
        }
      })
      .catch(() => {
        if (active) setLoadState({ key, busy: false, error: "題目詳解暫時無法載入；已保留原本內容，請稍後再試。" });
      });
    return () => { active = false; };
  }, [effectiveExplanationMode, effectiveExplanationPack, questionLoader, questions, retry, selectedId]);

  useEffect(() => {
    if (!loaded.question || loaded.requestedPackId !== effectiveExplanationPack || loaded.mode === effectiveExplanationMode) return;
    Promise.resolve().then(() => setLoaded((current) => (
      current.requestedPackId === effectiveExplanationPack ? { ...current, mode: effectiveExplanationMode } : current
    )));
  }, [effectiveExplanationMode, effectiveExplanationPack, loaded.mode, loaded.question, loaded.requestedPackId]);

  const loadKey = `${selectedId}:${effectiveExplanationPack}`;
  const question = loaded.question;
  const {
    actionLabel: questionAudioActionLabel,
    accessibleLabel: questionAudioAccessibleLabel,
    open: openQuestionAudioPlayer,
    prepare: prepareQuestionAudio,
    source: questionAudio,
  } = useLearningAudio({
    contentReady: Boolean(question),
    noun: "題組",
    resource: question ? { kind: "question", questionId: question.id } : null,
  });

  function openQuestionAudio() {
    if (!questionAudio) return;
    openQuestionAudioPlayer();
    setMobileToolsOpen(false);
  }
  const loadError = loadState.key === loadKey ? loadState.error : "";
  const refreshingContent = loadState.key === loadKey && loadState.busy && loaded.key !== loadKey;
  const resolvedPackId = loaded.resolvedPackId;
  const displayedExplanationMode = loaded.requestedPackId === effectiveExplanationPack
    ? effectiveExplanationMode
    : loaded.mode;
  const displayedRaw = rawDraftMode && displayedExplanationMode === "raw";
  const visibleExplanation = useMemo(
    () => question ? explanationForMode(loaded.explanation, displayedExplanationMode) : "",
    [displayedExplanationMode, loaded.explanation, question],
  );
  const questionTrace = questionTraceState.questionId === question?.id ? questionTraceState.trace : null;
  const traceLoading = Boolean(question && onOpenBoardTrace && (
    questionTraceState.questionId !== question.id || questionTraceState.loading
  ));
  const visibleTracePanelOpen = tracePanelOpen && Boolean(questionTrace) && !traceLoading;
  const traceQuestionId = question?.id ?? "";

  useEffect(() => {
    if (!question || !onOpenBoardTrace) {
      void Promise.resolve().then(() => {
        setQuestionTraceState({ questionId: "", trace: null, loading: false });
        setTracePanelOpen(false);
        setActiveTraceElement(null);
      });
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setQuestionTraceState({ questionId: question.id, trace: null, loading: true });
      setTracePanelOpen(false);
      setActiveTraceElement(null);
      setActiveTraceTarget(requestedTraceTarget ?? "stem");
    });
    void loadBoardQuestionTrace(question.id)
      .then((trace) => {
        if (active) {
          setQuestionTraceState({ questionId: question.id, trace, loading: false });
        }
      })
      .catch(() => {
        if (active) {
          setQuestionTraceState({ questionId: question.id, trace: null, loading: false });
        }
      });
    return () => { active = false; };
  }, [onOpenBoardTrace, question, requestedTraceTarget]);

  const traceTargets = useMemo<BoardTraceTarget[]>(() => {
    if (!questionTrace) return [];
    const targets: BoardTraceTarget[] = [];
    if (questionTrace.stem?.length) targets.push("stem");
    for (const optionKey of Object.keys(questionTrace.options ?? {}).sort()) {
      if (questionTrace.options[optionKey]?.length) targets.push(`option-${optionKey.toUpperCase()}`);
    }
    return targets;
  }, [questionTrace]);

  const activeTraceLocations = useMemo(
    () => traceLocationsForTarget(questionTrace, activeTraceTarget),
    [activeTraceTarget, questionTrace],
  );
  const reconciledTraceLocations = useMemo(
    () => reconcileBoardTraceLocations(activeTraceLocations),
    [activeTraceLocations],
  );

  useEffect(() => {
    const requestVersion = ++traceLocatorRequestRef.current;
    const clearLocatorIndexes = () => {
      setTraceLocatorIndexes((current) => current.size === 0 ? current : new Map());
    };

    if (!visibleTracePanelOpen || !traceQuestionId) {
      clearLocatorIndexes();
      return;
    }

    const unitCodes = [...new Set(reconciledTraceLocations.map((location) => location.unitCode))];
    if (!unitCodes.length) {
      clearLocatorIndexes();
      return;
    }

    void Promise.allSettled(unitCodes.map(async (unitCode) => (
      [unitCode, await loadBoardTraceLocatorIndex(unitCode)] as const
    ))).then((results) => {
      if (traceLocatorRequestRef.current !== requestVersion) return;
      const successfulEntries = results.flatMap((result) => (
        result.status === "fulfilled" ? [result.value] : []
      ));
      setTraceLocatorIndexes(new Map(successfulEntries));
    });

    return () => {
      if (traceLocatorRequestRef.current === requestVersion) {
        traceLocatorRequestRef.current += 1;
      }
    };
  }, [reconciledTraceLocations, traceQuestionId, visibleTracePanelOpen]);

  const directTraceItems = useMemo<TraceabilityItem[]>(() => reconciledTraceLocations
    .filter((location) => location.relation === "primary")
    .map((location, index) => ({
      id: `${activeTraceTarget}:${location.unitCode}:${location.paragraphId}:primary:${index}`,
      eyebrow: boardTraceTargetLabel(activeTraceTarget),
      title: (() => {
        const human = traceLocatorIndexes.get(location.unitCode)?.get(location.paragraphId);
        return boardTraceSectionTitle(location.unitCode, human);
      })(),
      excerpt: traceLocatorIndexes.get(location.unitCode)?.get(location.paragraphId)?.heading || undefined,
      locator: (() => {
        const human = traceLocatorIndexes.get(location.unitCode)?.get(location.paragraphId);
        if (!human) return location.nodeId.startsWith("ts-") ? "精準定位" : "答案所在段落";
        const sentence = human.sentenceOrdinals[location.nodeId];
        return `第 ${human.paragraphOrdinal} 段${sentence ? `・精準定位第 ${sentence} 句` : ""}`;
      })(),
      target: { kind: "reference", resourceId: location.unitCode, anchorId: location.nodeId },
    })), [activeTraceTarget, reconciledTraceLocations, traceLocatorIndexes]);
  const relatedTraceItems = useMemo<TraceabilityItem[]>(() => reconciledTraceLocations
    .filter((location) => location.relation !== "primary")
    .map((location, index) => ({
      id: `${activeTraceTarget}:${location.unitCode}:${location.paragraphId}:related:${index}`,
      eyebrow: boardTraceTargetLabel(activeTraceTarget),
      title: (() => {
        const human = traceLocatorIndexes.get(location.unitCode)?.get(location.paragraphId);
        return boardTraceSectionTitle(location.unitCode, human);
      })(),
      excerpt: traceLocatorIndexes.get(location.unitCode)?.get(location.paragraphId)?.heading || undefined,
      locator: (() => {
        const human = traceLocatorIndexes.get(location.unitCode)?.get(location.paragraphId);
        if (!human) return "同觀念補充段落";
        const sentence = human.sentenceOrdinals[location.nodeId];
        return `第 ${human.paragraphOrdinal} 段${sentence ? `・定位第 ${sentence} 句` : ""}`;
      })(),
      target: { kind: "reference", resourceId: location.unitCode, anchorId: location.nodeId },
    })), [activeTraceTarget, reconciledTraceLocations, traceLocatorIndexes]);

  const activateTraceTarget = useCallback((target: BoardTraceTarget, element?: HTMLElement | null) => {
    setActiveTraceTarget(target);
    if (element) setActiveTraceElement(element);
  }, []);

  const openTracePanel = useCallback((target?: BoardTraceTarget) => {
    const nextTarget = target && traceTargets.includes(target)
      ? target
      : traceTargets.includes(activeTraceTarget)
        ? activeTraceTarget
        : traceTargets[0] ?? "stem";
    setActiveTraceTarget(nextTarget);
    const element = questionArticleRef.current?.querySelector<HTMLElement>(`[data-board-question-trace-target="${nextTarget}"]`) ?? null;
    if (element) setActiveTraceElement(element);
    setTracePanelOpen(true);
  }, [activeTraceTarget, traceTargets]);

  const openPrimaryTrace = useCallback((target: BoardTraceTarget) => {
    const location = primaryTraceLocation(questionTrace, target);
    if (location && question && onOpenBoardTrace) {
      onOpenBoardTrace(location.unitCode, location.nodeId, question.id, target);
      return;
    }
    openTracePanel(target);
  }, [onOpenBoardTrace, openTracePanel, question, questionTrace]);

  const handleTracePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>("[data-board-question-trace-target]");
    const target = element?.dataset.boardQuestionTraceTarget as BoardTraceTarget | undefined;
    if (element && target && event.currentTarget.contains(element)) activateTraceTarget(target, element);
  }, [activateTraceTarget]);

  const handleTraceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(pointer: coarse)").matches || !(event.target instanceof Element)) return;
    if (event.target.closest("button, a, [data-annotation-action], [data-reading-navigation-ignore]") || window.getSelection()?.toString()) return;
    const element = event.target.closest<HTMLElement>("[data-board-question-trace-target]");
    const target = element?.dataset.boardQuestionTraceTarget as BoardTraceTarget | undefined;
    if (element && target && event.currentTarget.contains(element)) {
      activateTraceTarget(target, element);
      openTracePanel(target);
    }
  }, [activateTraceTarget, openTracePanel]);

  useEffect(() => {
    if (!question || !requestedTraceTarget || !traceTargets.includes(requestedTraceTarget)) return;
    const frame = requestAnimationFrame(() => {
      setActiveTraceTarget(requestedTraceTarget);
      const element = questionArticleRef.current?.querySelector<HTMLElement>(`[data-board-question-trace-target="${requestedTraceTarget}"]`) ?? null;
      if (!element) return;
      setActiveTraceElement(element);
      scrollElementIntoView(element, { block: "center" });
      if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
      element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [question, requestedTraceTarget, traceTargets]);

  useEffect(() => {
    if (!question) return;
    const position = filtered.findIndex((item) => item.id === question.id);
    for (const item of [filtered[position - 1], filtered[position + 1], filtered[position + 2]]) {
      if (item) {
        void questionLoader(item).catch(() => undefined);
        prefetchQuestionExplanation(item, effectiveExplanationPack);
      }
    }
  }, [effectiveExplanationPack, filtered, question, questionLoader]);

  useEffect(() => {
    if (!question) return;
    const state = progressMap.get(question.id)?.readState;
    if (!state || state === "unread") void onMarkRead(question.id, "reading");
  }, [onMarkRead, progressMap, question]);

  useEffect(() => {
    if (!question || requestedTraceTarget) return;
    const frame = requestAnimationFrame(() => document.getElementById(`question-heading-${question.id}`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [question, requestedTraceTarget]);

  const selectedPosition = filtered.findIndex((item) => item.id === selectedId);

  const toc = useMemo(() => {
    if (!question || displayedRaw) return [];
    const headingSlug = createHeadingSlugger();
    return visibleExplanation.split("\n").flatMap((line) => {
      const match = line.match(/^(##|###)\s+(.+)$/);
      if (!match) return [];
      const heading = plainMarkdownHeading(match[2]);
      const id = headingSlug(heading);
      if (match[1] !== "##") return [];
      return [{ label: heading.replace(/^\d+\.\s*/, ""), id }];
    });
  }, [displayedRaw, question, visibleExplanation]);
  const progress = question ? progressMap.get(question.id) : undefined;
  const bookmarked = progress?.bookmarked === 1;
  const readingVariantValue = explanationVariant(effectiveExplanationPack, effectiveExplanationMode);
  const annotationSource = useMemo<ContentAnnotationSource | null>(() => annotationsEnabled && question ? {
    resourceId: question.id,
    eyebrow: question.id,
    panelLabel: "本題筆記",
    rootNoteTitle: "題目筆記",
    rootNoteDescription: "整理整題判斷方式",
    rootNotePlaceholder: "整理這題的判斷方式、易錯點或待查事項…",
    emptyHint: "可反白詳解文字，或直接將表格與各層標題加入筆記。",
    kind: "question",
    annotationPrefix: readerAnnotationScopePrefix(resolvedPackId, displayedExplanationMode),
    contentScope: displayedExplanationMode,
    explanationPack: resolvedPackId,
  } : null, [annotationsEnabled, displayedExplanationMode, question, resolvedPackId]);
  const handleAnnotationPanelOpenChange = useCallback((open: boolean) => {
    setAnnotationPanelOpen(open);
    onAnnotationOpenChange(open);
  }, [onAnnotationOpenChange]);

  const commitReadingVariant = (next: ReadingVariantValue) => {
    const nextPack: ExplanationPackId = next.edition === "concise" ? "concise" : "original";
    if (next.depth === "raw" && !rawDraftMode) return;
    onExplanationSelectionChange(nextPack, next.depth);
    setMobileToolsOpen(false);
  };

  const chooseRelative = useCallback((offset: number) => {
    const next = filtered[selectedPosition + offset];
    if (next) {
      selectQuestion(next.id);
      scrollPageToTop();
    }
  }, [filtered, selectQuestion, selectedPosition]);

  const readingNavigation = useReadingNavigation({
    onPrevious: () => chooseRelative(-1),
    onNext: () => chooseRelative(1),
    canPrevious: selectedPosition > 0,
    canNext: selectedPosition >= 0 && selectedPosition < filtered.length - 1,
    enabled: Boolean(requestedQuestionId),
  });

  const paperQuestions = useMemo(
    () => questions.filter((item) => item.exam === (question?.exam ?? chooserExam)).sort((left, right) => left.number - right.number),
    [chooserExam, question?.exam, questions],
  );

  const jumpToQuestion = (item: QuestionIndex) => {
    setQuery("");
    setExam(item.exam);
    setCategory("all");
    setSourceSection("all");
    setReadState("all");
    setJumpOpen(false);
    setTocOpen(false);
    selectQuestion(item.id);
    scrollPageToTop();
  };

  const submitJumpNumber = () => {
    const number = Number(jumpNumber.replace(/\D/g, ""));
    const target = paperQuestions.find((item) => item.number === number);
    if (!target) {
      setNotice("找不到這個題號。");
      return;
    }
    setJumpNumber("");
    jumpToQuestion(target);
  };

  if (!requestedQuestionId) {
    const chosenGroup = manifest.groups.find((group) => group.id === chooserExam);
    if (chosenGroup) {
      return (
        <main className="workspace-page reader-exam-chooser reader-paper-chooser">
          <header className="paper-chooser-header">
            <button className="text-action" onClick={() => { setChooserExam(""); setJumpNumber(""); }}><ArrowLeft size={18} />返回試卷</button>
            <div><p className="eyebrow"><span />{chosenGroup.id}</p><h1>{chosenGroup.label}</h1><p>{paperQuestions.length.toLocaleString("zh-TW")} 題・選擇要閱讀的詳解</p></div>
            <form className="paper-number-jump" onSubmit={(event) => { event.preventDefault(); submitJumpNumber(); }}>
              <label htmlFor="paper-number">跳到題號</label>
              <div><input id="paper-number" inputMode="numeric" value={jumpNumber} onChange={(event) => setJumpNumber(event.target.value)} placeholder="例如 37" /><button type="submit">前往</button></div>
            </form>
          </header>
          {notice && <p className="form-notice" role="status">{notice}</p>}
          <section className="paper-question-grid" aria-label={`${chosenGroup.label}題號`}>
            {paperQuestions.map((item) => {
              const itemProgress = progressMap.get(item.id);
              const state = itemProgress?.readState === "done" ? "已讀完" : itemProgress?.readState === "later" ? "稍後再讀" : "未讀完";
              return <button key={item.id} className={itemProgress?.readState === "done" ? "done" : itemProgress?.readState === "later" ? "later" : ""} aria-label={`第 ${item.number} 題，${item.title}，${state}${itemProgress?.bookmarked === 1 ? "，已收藏" : ""}`} onPointerEnter={() => warmQuestion(item.id)} onPointerDown={() => warmQuestion(item.id)} onFocus={() => warmQuestion(item.id)} onClick={() => jumpToQuestion(item)}><span>{item.number}</span>{itemProgress?.readState === "done" && <Check size={12} />}{itemProgress?.bookmarked === 1 && <Bookmark size={11} fill="currentColor" />}</button>;
            })}
          </section>
        </main>
      );
    }
    return (
      <main className="workspace-page reader-exam-chooser">
        <header className="page-intro reader-exam-chooser-header">
          <p className="eyebrow"><span />詳解閱讀</p>
          <h1>選擇試卷</h1>
          <p>直接閱讀詳解，並標記已讀或稍後再讀。</p>
        </header>
        {notice && <p className="form-notice" role="status">{notice}</p>}
        <section className="reader-exam-grid" aria-label="依年度與卷別選擇詳解">
          {examCards.map((group) => (
            <button
              className="reader-exam-card paper-card"
              key={group.id}
              aria-label={`${group.label}，共 ${group.count.toLocaleString("zh-TW")} 題，已讀 ${group.readCount.toLocaleString("zh-TW")} 題，閱讀進度 ${group.percent}%，開啟詳解`}
              onClick={() => { setChooserExam(group.id); setNotice(""); scrollPageToTop(); }}
            >
              <span className="reader-exam-card-head">
                <span><small>{group.id}</small><strong>{group.label}</strong></span>
                <ArrowRight size={20} />
              </span>
              <span className="reader-exam-card-count">{group.count.toLocaleString("zh-TW")} 題・已讀 {group.readCount.toLocaleString("zh-TW")} 題</span>
              <span
                className="reader-exam-card-progress"
                aria-hidden="true"
              >
                <i style={{ width: `${group.percent}%` }} />
                <small>{group.percent}%</small>
              </span>
            </button>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="reader-page">
      <ReadingCatalogLayer portal={narrow}>
        {listOpen && <button className="reader-drawer-backdrop" aria-label="關閉題目目錄" onClick={() => setListOpen(false)} />}
        <aside
        id="reader-library"
        ref={libraryRef}
        className={`reader-library swipe-dismiss-panel ${listOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-hidden={narrow && !listOpen}
        inert={narrow && !listOpen ? true : undefined}
        onPointerDown={librarySwipe.onPointerDown}
        onPointerMove={librarySwipe.onPointerMove}
        onPointerUp={librarySwipe.onPointerUp}
        onPointerCancel={librarySwipe.onPointerCancel}
        onLostPointerCapture={librarySwipe.onLostPointerCapture}
        onClickCapture={librarySwipe.onClickCapture}
      >
        <div className="reader-library-heading"><div><BookCheck /><span><strong>詳解閱讀</strong><small>{filtered.length.toLocaleString("zh-TW")} 題</small></span></div><button className="reader-list-close" onClick={() => setListOpen(false)}>完成</button></div>
        <label className="reader-search" data-swipe-dismiss-ignore=""><Search size={17} /><input aria-label="搜尋詳解題目或主題" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋題目或主題" /></label>
        <div className="reader-selects" data-swipe-dismiss-ignore="">{manifest.groups.length > 1 && <select aria-label="依年度篩選" value={exam} onChange={(event) => setExam(event.target.value)}><option value="all">全部年度</option>{manifest.groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</select>}<select aria-label="依主要領域篩選" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">全部主要領域</option>{manifest.categories.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select>{manifest.sourceSections.length > 0 && <select aria-label="依 Tintinalli 章節篩選" value={sourceSection} onChange={(event) => setSourceSection(event.target.value)}><option value="all">全部來源章節</option>{manifest.sourceSections.map((item) => <option key={item.id} value={item.id}>Section {item.id}・{item.label}</option>)}</select>}<select aria-label="依閱讀狀態篩選" value={readState} onChange={(event) => setReadState(event.target.value)}><option value="all">全部閱讀狀態</option><option value="unread">尚未讀完</option><option value="done">已讀完</option><option value="later">稍後再讀</option><option value="bookmarked">已收藏</option></select></div>
        <div ref={questionListRef} className="reader-question-list">
          {listedQuestions.map((item) => {
            const itemProgress = progressMap.get(item.id);
            return <button key={item.id} data-content-prefetch={item.id} aria-current={selectedId === item.id ? "true" : undefined} className={selectedId === item.id ? "active" : ""} onPointerEnter={() => warmQuestion(item.id)} onPointerDown={() => warmQuestion(item.id)} onFocus={() => warmQuestion(item.id)} onClick={() => selectQuestion(item.id)}><span>{item.id}</span><strong>{item.title}</strong><small>{item.category}</small>{itemProgress?.readState === "done" && <Check size={14} />}{itemProgress?.bookmarked === 1 && <Bookmark size={13} fill="currentColor" />}</button>;
          })}
          {!filtered.length && <p className="list-limit-note">沒有符合目前篩選條件的題目。</p>}
          {exam === "all" && filtered.length > 120 && <p className="list-limit-note">先顯示前 120 題；輸入關鍵字可直接找到其餘題目。</p>}
        </div>
        </aside>
      </ReadingCatalogLayer>

      <section className={`reader-workspace reader-size-${fontSize}`}>
        <div className="reader-toolbar reading-toolbar">
          {headerActions}
          <button ref={libraryTriggerRef} className="reader-list-trigger reading-toolbar-library" aria-label="開啟題目目錄" aria-controls="reader-library" aria-expanded={listOpen} onClick={() => setListOpen(true)}><List size={18} /><span>目錄</span></button>
          <button ref={jumpTriggerRef} className="reader-paper-jump-trigger reading-toolbar-position" aria-haspopup="dialog" aria-controls="reader-jump-sheet" aria-expanded={jumpOpen} onClick={() => setJumpOpen(true)}><Grid3X3 size={16} /><span>Q{String(question?.number ?? 0).padStart(3, "0")}</span><small>/ {paperQuestions.length}</small></button>
          <ReadingNextPrev className="reader-step-controls reading-toolbar-steps" variant="icons" noun="篇詳解" canPrevious={selectedPosition > 0} canNext={selectedPosition >= 0 && selectedPosition < filtered.length - 1} onPrevious={() => chooseRelative(-1)} onNext={() => chooseRelative(1)} />
          <div className="reader-position"><span>{selectedPosition >= 0 ? selectedPosition + 1 : "—"}</span> / {filtered.length}</div>
          {questionAudio && <button type="button" className="reading-toolbar-audio" aria-label={questionAudioAccessibleLabel} onPointerDown={prepareQuestionAudio} onClick={openQuestionAudio}><Headphones aria-hidden="true" /><span>音檔</span></button>}
          <nav className="reader-toc" aria-label="詳解章節">{toc.slice(0, 7).map((item) => <button key={item.id} onClick={() => scrollElementIntoView(document.getElementById(item.id), { block: "start" })}>{item.label}</button>)}</nav>
          <button ref={tocTriggerRef} className="reader-toc-trigger reading-toolbar-outline" aria-haspopup="dialog" aria-controls="reader-toc-sheet" aria-expanded={tocOpen} onClick={() => setTocOpen(true)}><ListTree size={16} /><span>章節</span></button>
          {onOpenBoardTrace && <button ref={traceTriggerRef} className="reading-toolbar-trace" disabled={traceLoading || traceTargets.length === 0} aria-haspopup="dialog" aria-controls="reader-traceability-panel" aria-expanded={visibleTracePanelOpen} onClick={() => openTracePanel()}><Link2 size={16} /><span>{traceLoading ? "載入對照" : "來源對照"}</span></button>}
          <ReadingFontControls className="font-controls reading-toolbar-font" level={fontSize} onChange={setFontSize} noun="詳解文字" />
          <button ref={mobileToolsTriggerRef} className="reader-mobile-tools-trigger reading-toolbar-tools" disabled={!question} aria-haspopup="dialog" aria-expanded={Boolean(question && mobileToolsOpen)} aria-controls="reader-mobile-tools" onClick={() => setMobileToolsOpen(true)}><SlidersHorizontal size={16} /><span>閱讀</span></button>
        </div>

        {jumpOpen && <div className="reader-modal-backdrop" onClick={() => setJumpOpen(false)}><section ref={jumpPanelRef} id="reader-jump-sheet" tabIndex={-1} className="reader-jump-sheet overlay-panel" role="dialog" aria-modal="true" aria-label="跳到同一份試卷的其他題目" onClick={(event) => event.stopPropagation()}><header><div><span>{question?.exam}</span><strong>快速跳題</strong></div><button data-overlay-close aria-label="關閉快速跳題" onClick={() => setJumpOpen(false)}><X /></button></header><div className="paper-question-grid compact">{paperQuestions.map((item) => { const state = progressMap.get(item.id); return <button key={item.id} aria-current={item.id === question?.id ? "true" : undefined} className={`${item.id === question?.id ? "current" : ""} ${state?.readState === "done" ? "done" : state?.readState === "later" ? "later" : ""}`} aria-label={`第 ${item.number} 題，${item.title}`} onPointerEnter={() => warmQuestion(item.id)} onPointerDown={() => warmQuestion(item.id)} onFocus={() => warmQuestion(item.id)} onClick={() => jumpToQuestion(item)}><span>{item.number}</span>{state?.readState === "done" && <Check size={11} />}</button>; })}</div></section></div>}
        {tocOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setTocOpen(false)}><section ref={tocPanelRef} id="reader-toc-sheet" tabIndex={-1} className="reader-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="本題詳解章節" onClick={(event) => event.stopPropagation()}><header><strong>本題目錄</strong><button data-overlay-close aria-label="關閉章節目錄" onClick={() => setTocOpen(false)}><X /></button></header><button onClick={() => { scrollElementIntoView(document.getElementById(`question-heading-${question?.id}`)); setTocOpen(false); }}>回到題目</button>{toc.map((item) => <button key={item.id} onClick={() => { scrollElementIntoView(document.getElementById(item.id), { block: "start" }); setTocOpen(false); }}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && question && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        {!question && loadError ? <div className="empty-state reader-load-state"><BookCheck size={30} /><h2>詳解載入失敗</h2><p>{loadError}</p><button className="outline-button" onClick={() => setRetry((value) => value + 1)}>重新載入</button></div> : !question ? <div className="reader-load-state"><QuestionLoading label="正在展開題目詳解…" /></div> : (
          <div className="reader-reading-layout">
            <aside
              ref={mobileToolsRef}
              id="reader-mobile-tools"
              className={`reader-utility-panel ${mobileToolsOpen ? "mobile-open" : ""}`}
              aria-label="閱讀工具"
              aria-hidden={compactTools && !mobileToolsOpen ? true : undefined}
              inert={compactTools && !mobileToolsOpen ? true : undefined}
              role={compactTools && mobileToolsOpen ? "dialog" : undefined}
              aria-modal={compactTools && mobileToolsOpen ? true : undefined}
            >
              <div className="reader-utility-inner overlay-panel">
                <header className="mobile-reading-tools-heading">
                  <div><SlidersHorizontal size={17} /><span><strong>閱讀工具</strong><small>{explanationPacks.find((pack) => pack.id === effectiveExplanationPack)?.shortLabel}・{explanationModeLabel(effectiveExplanationMode, true)}</small></span></div>
                  <ReadingFontControls className="mobile-reading-font-tools" level={fontSize} onChange={setFontSize} noun="詳解文字" />
                  <button className="mobile-reading-tools-close" aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)}><X /></button>
                </header>
                <div className="reader-rail-navigation">
                  <button className="reader-rail-jump" aria-haspopup="dialog" aria-controls="reader-jump-sheet" aria-expanded={jumpOpen} onClick={() => { setMobileToolsOpen(false); setJumpOpen(true); }}><Grid3X3 size={17} /><span><small>{question.exam}</small><strong>Q{String(question.number).padStart(3, "0")} <em>/ {paperQuestions.length}</em></strong></span></button>
                  {onOpenBoardTrace && <button className="reader-rail-trace" disabled={traceLoading || traceTargets.length === 0} aria-haspopup="dialog" aria-controls="reader-traceability-panel" aria-expanded={visibleTracePanelOpen} onClick={() => { setMobileToolsOpen(false); openTracePanel(); }}><Link2 size={17} /><span><small>本題來源</small><strong>來源對照</strong></span><ArrowRight size={14} /></button>}
                  <ReadingNextPrev className="reader-rail-step-controls" noun="題" canPrevious={selectedPosition > 0} canNext={selectedPosition >= 0 && selectedPosition < filtered.length - 1} onPrevious={() => chooseRelative(-1)} onNext={() => chooseRelative(1)} />
                  <div className="reader-rail-secondary">
                    <ReadingFontControls className="reader-rail-font" level={fontSize} onChange={setFontSize} noun="詳解文字" />
                  </div>
                </div>
                {questionAudio && <button type="button" className="guide-audio-action" aria-label={questionAudioAccessibleLabel} onPointerDown={prepareQuestionAudio} onClick={openQuestionAudio}><span className="guide-audio-action-icon"><Headphones aria-hidden="true" /></span><span><small>本題組音檔</small><strong>{questionAudioActionLabel}</strong></span><Headphones aria-hidden="true" /></button>}
                <div className="reader-actions-bar" onClickCapture={() => setMobileToolsOpen(false)}>
                  <button aria-label={progress?.readState === "later" ? "取消稍後再讀" : "加入稍後再讀"} aria-pressed={progress?.readState === "later"} className={progress?.readState === "later" ? "active" : ""} onClick={() => onMarkRead(question.id, progress?.readState === "later" ? "reading" : "later")}><Clock3 size={17} /><span className="reader-action-label-full">{progress?.readState === "later" ? "已排入稍後" : "稍後再讀"}</span><span className="reader-action-label-short">稍後</span></button>
                  <button aria-label={progress?.readState === "done" ? "取消已讀標記" : "標記為已讀完"} aria-pressed={progress?.readState === "done"} className={progress?.readState === "done" ? "active done" : ""} onClick={() => onMarkRead(question.id, progress?.readState === "done" ? "reading" : "done")}><BookCheck size={17} /><span className="reader-action-label-full">{progress?.readState === "done" ? "已讀完" : "標記讀完"}</span><span className="reader-action-label-short">讀完</span></button>
                  <button aria-label={bookmarked ? "取消收藏本題" : "收藏本題"} aria-pressed={bookmarked} className={bookmarked ? "active" : ""} onClick={() => onBookmark(question.id, !bookmarked)}><Bookmark size={17} fill={bookmarked ? "currentColor" : "none"} /><span>收藏</span></button>
                  {annotationSource && <ContentAnnotationTools source={annotationSource} annotations={annotations} annotationStatus={annotationStatus} contentKey={`${question.id}:${resolvedPackId}:${displayedExplanationMode}`} requestedAnnotationId={requestedAnnotationId} pendingExcerpt={pendingExcerpt} onExcerptHandled={() => setPendingExcerpt(null)} onOpenChange={handleAnnotationPanelOpenChange} onUpsert={onUpsertAnnotation} onRemove={onRemoveAnnotation} />}
                </div>
                {variantSelectionEnabled && <div className="reader-preference-stack">
                  <ReadingVariantSelector
                    value={readingVariantValue}
                    editionOptions={explanationEditionOptions}
                    depthOptions={explanationDepthOptions}
                    busy={loadState.busy}
                    locked={annotationReadingLocked}
                    lockedReason="正顯示筆記建立時的詳解；關閉筆記後可切換。"
                    ariaLabel="詳解版本與閱讀程度選擇器"
                    onCommit={commitReadingVariant}
                  />
                  {annotationReadingLocked && <p className="reader-preference-lock" role="status">正顯示筆記建立時的詳解；關閉筆記後可切換。</p>}
                </div>}
                <nav className="reader-rail-toc" aria-label="本題文章目錄"><header><ListTree size={16} /><span>本題章節</span></header><button onClick={() => scrollElementIntoView(document.getElementById(`question-heading-${question.id}`), { block: "start" })}>回到題目</button>{toc.map((item) => <button key={item.id} onClick={() => scrollElementIntoView(document.getElementById(item.id), { block: "start" })}>{item.label}</button>)}</nav>
              </div>
            </aside>
            <div className="reader-reading-column">
              {(notice || loadError) && <p className="reader-notice" role="status">{loadError || notice}</p>}
              {loaded.fallback && <p className="reader-notice" role="status" aria-live="polite">精要詳解暫不可用，已顯示詳細版。</p>}
              <div ref={questionArticleRef} key={`${loaded.key}:${loaded.mode}`} className={`reader-gesture-surface reading-content-swap ${refreshingContent ? "is-refreshing" : ""}`} aria-busy={refreshingContent} onPointerOver={handleTracePointer} onFocusCapture={(event) => { if (!(event.target instanceof Element)) return; const element = event.target.closest<HTMLElement>("[data-board-question-trace-target]"); const target = element?.dataset.boardQuestionTraceTarget as BoardTraceTarget | undefined; if (element && target) activateTraceTarget(target, element); }} onClick={handleTraceClick} {...readingNavigation} data-content-annotation-root={question.id}><QuestionSheet question={question} reader showFullExplanation explanationMarkdown={visibleExplanation} explanationRaw={displayedRaw} bookmarked={bookmarked} progress={progress} onBookmark={() => onBookmark(question.id, !bookmarked)} onOpenGuide={onOpenGuide} onAddExplanationToNotes={annotationsEnabled ? setPendingExcerpt : undefined} traceTargets={onOpenBoardTrace ? traceTargets : []} requestedTraceTarget={requestedTraceTarget} onOpenBoardTraceTarget={onOpenBoardTrace ? openPrimaryTrace : undefined} /></div>
              <ReadingNextPrev className="reader-next-prev" noun="篇" canPrevious={selectedPosition > 0} canNext={selectedPosition >= 0 && selectedPosition < filtered.length - 1} onPrevious={() => chooseRelative(-1)} onNext={() => chooseRelative(1)} />
            </div>
          </div>
        )}
      </section>
      {onOpenBoardTrace && <TraceContextRail anchorElement={activeTraceElement} open={!traceLoading && !annotationPanelOpen && activeTraceLocations.length > 0} panelId="reader-traceability-panel" panelOpen={visibleTracePanelOpen} context={question ? { label: `${question.id} ${boardTraceTargetLabel(activeTraceTarget)}`, target: activeTraceTarget === "stem" ? { kind: "question", questionId: question.id } : { kind: "option", questionId: question.id, optionKey: activeTraceTarget.slice("option-".length) } } : null} count={activeTraceLocations.length} onOpenPanel={() => openTracePanel(activeTraceTarget)} onDismiss={() => setActiveTraceElement(null)} />}
      {onOpenBoardTrace && <TraceabilityPanel open={visibleTracePanelOpen} id="reader-traceability-panel" ariaLabel="題目來源對照" eyebrow={question?.id ?? "題目詳解"} title={`${boardTraceTargetLabel(activeTraceTarget)}的考題溯源`} description="同一段只顯示一次；最精準位置優先定位答案依據，其餘保留為補充閱讀。" directItems={directTraceItems} relatedItems={relatedTraceItems} directLabel="最精準位置" relatedLabel="補充段落" directHint="答案可直接在這裡找到" relatedHint="同一觀念的其他內容" directEmptyLabel="這個位置目前沒有直接對照。" relatedEmptyLabel="這個位置目前沒有其他延伸對照。" initialVisibleCount={10} loading={traceLoading} triggerRef={traceTriggerRef} closeOnSelect onClose={() => setTracePanelOpen(false)} onSelectReference={(unitCode, nodeId) => { if (question) onOpenBoardTrace(unitCode, nodeId, question.id, activeTraceTarget); }} />}
    </main>
  );
}
