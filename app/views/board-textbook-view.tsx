"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpenText, ChevronLeft, ChevronRight, Clock3, Headphones, Link2, ListTree, ScanSearch, X } from "lucide-react";
import ContentAnnotationTools, { type ContentAnnotationDraft, type ContentAnnotationSource } from "../components/content-annotation-tools";
import GuideReaderToolsPanel, { GuideReaderToolbar, GuideTextbookSwitcher } from "../components/guide-reader-tools";
import LearningReaderLoadingShell from "../components/learning-reader-loading-shell";
import MarkdownContent from "../components/markdown-content";
import ReadingCatalogLayer from "../components/reading-catalog-layer";
import ReadingFontControls from "../components/reading-font-controls";
import ReadingNextPrev from "../components/reading-next-prev";
import TraceContextRail from "../components/trace-context-rail";
import TraceabilityPanel from "../components/traceability-panel";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import { useHorizontalSwipeDismiss } from "../hooks/use-horizontal-swipe-dismiss";
import { useLearningAudio } from "../hooks/use-learning-audio";
import { useReadingFontPreference } from "../hooks/use-reading-font-preference";
import { useReadingNavigation } from "../hooks/use-reading-navigation";
import { boardGuideAnnotationResourceId, boardGuideAnnotationScopePrefix } from "../lib/annotation-source";
import { reconcileBoardTraceHits, traceQuestionCount } from "../lib/board-trace-items";
import {
  boardTraceTargetLabel,
  loadBoardTextbookManifest,
  loadBoardTextbookUnitData,
  loadBoardTextbookUnitMarkdown,
  normalizeBoardUnitCode,
  prefetchBoardTextbookUnit,
  resolveBoardTraceHits,
  type BoardTextbookManifest,
  type BoardTextbookUnit,
  type BoardSentenceSelector,
  type BoardTraceTarget,
  type BoardTraceUnitData,
} from "../lib/board-trace";
import { extractMarkdownOutline } from "../lib/markdown-heading";
import { scrollElementIntoView, scrollPageToTop } from "../lib/motion";
import type { AnnotationExcerptRequest, GuideReadState, GuideResourceProgressRecord, QuestionIndex, StudyAnnotation } from "../lib/types";

const tracePreferenceKey = "em-board-board-trace-enabled-v1";
const tracePanelId = "board-textbook-traceability-panel";
const emptyTraceAtomIds: readonly string[] = [];

type Props = {
  questions: QuestionIndex[];
  requestedUnitCode: string | null;
  requestedTraceNodeId?: string | null;
  requestedTraceQuestionId?: string | null;
  requestedTraceTarget?: BoardTraceTarget | null;
  requestedAnnotationId?: string | null;
  annotations: StudyAnnotation[];
  annotationStatus: "loading" | "synced" | "local" | "error";
  progressMap: Map<string, GuideResourceProgressRecord>;
  progressStatus: "loading" | "synced" | "offline";
  onSelectUnit: (unitCode: string) => void;
  onOpenLibrary: () => void;
  onOpenReader: (questionId: string) => void;
  onOpenReaderTrace: (questionId: string, target: BoardTraceTarget) => void;
  onOpenResource: (resourceId: string, contentHash: string | null) => Promise<unknown>;
  onMarkResource: (resourceId: string, value: GuideReadState, contentHash: string | null) => Promise<unknown>;
  onBookmarkResource: (resourceId: string, value: boolean) => Promise<unknown>;
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

type TraceDataState = {
  key: string;
  data: BoardTraceUnitData | null;
  loading: boolean;
  error: string;
};

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function ensureBoardTraceHighlightStyle() {
  const styleId = "board-trace-highlight-style";
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = "::highlight(board-trace-target){background:color-mix(in srgb,var(--site-warning-soft) 86%,transparent);color:inherit}";
  document.head.appendChild(style);
}

function selectedUnitFrom(manifest: BoardTextbookManifest, requestedUnitCode: string | null) {
  const code = normalizeBoardUnitCode(requestedUnitCode);
  return manifest.units.find((unit) => unit.unitCode === code) ?? manifest.units[0] ?? null;
}

function unitMarker(unit: BoardTextbookUnit) {
  return unit.unitCode;
}

function resourceIdFor(unit: BoardTextbookUnit | null) {
  return unit ? boardGuideAnnotationResourceId(unit.unitCode) ?? "" : "";
}

function paragraphIdFor(data: BoardTraceUnitData | null, nodeId: string | null) {
  if (!nodeId) return null;
  if (data?.paragraphs[nodeId]) return nodeId;
  return data?.sentences[nodeId]?.paragraphId ?? null;
}

function traceElementFromEvent(currentTarget: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-board-trace-node]");
  return element && currentTarget.contains(element) ? element : null;
}

function interactiveEventTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, summary, [data-reading-navigation-ignore]"));
}

function textRangeForSelector(parent: HTMLElement, selector: BoardSentenceSelector) {
  if (!selector.exact) return null;
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("[data-annotation-action], .katex, script, style")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const start = text.length;
    text += node.data;
    nodes.push({ node, start, end: text.length });
  }
  const candidates: number[] = [];
  let candidate = text.indexOf(selector.exact);
  while (candidate >= 0) {
    candidates.push(candidate);
    candidate = text.indexOf(selector.exact, candidate + Math.max(1, selector.exact.length));
  }
  const contextScore = (start: number) => {
    const end = start + selector.exact.length;
    let score = 0;
    if (selector.prefix && text.slice(Math.max(0, start - selector.prefix.length), start).endsWith(selector.prefix)) score += 1;
    if (selector.suffix && text.slice(end, end + selector.suffix.length).startsWith(selector.suffix)) score += 1;
    return score;
  };
  const start = candidates.sort((left, right) => contextScore(right) - contextScore(left))[0] ?? -1;
  if (start < 0) return null;
  const end = start + selector.exact.length;
  const startNode = nodes.find((entry) => start >= entry.start && start <= entry.end);
  const endNode = nodes.find((entry) => end >= entry.start && end <= entry.end);
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode.node, Math.min(start - startNode.start, startNode.node.length));
  range.setEnd(endNode.node, Math.min(end - endNode.start, endNode.node.length));
  return range;
}

function mappedTraceElements(root: HTMLElement | null) {
  return [...(root?.querySelectorAll<HTMLElement>("[data-board-trace-node]") ?? [])]
    .filter((node) => Number(node.dataset.boardTraceDirect ?? 0) + Number(node.dataset.boardTraceRelated ?? 0) > 0);
}

export default function BoardTextbookView({
  questions,
  requestedUnitCode,
  requestedTraceNodeId,
  requestedTraceQuestionId,
  requestedTraceTarget,
  requestedAnnotationId,
  annotations,
  annotationStatus,
  progressMap,
  progressStatus,
  onSelectUnit,
  onOpenLibrary,
  onOpenReader,
  onOpenReaderTrace,
  onOpenResource,
  onMarkResource,
  onBookmarkResource,
  onAnnotationOpenChange,
  onUpsert,
  onRemove,
}: Props) {
  const [manifest, setManifest] = useState<BoardTextbookManifest | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [contentAttempt, setContentAttempt] = useState(0);
  const [traceAttempt, setTraceAttempt] = useState(0);
  const [contentState, setContentState] = useState<ContentState>({ key: "", markdown: "", loading: false, error: "" });
  const [traceDataState, setTraceDataState] = useState<TraceDataState>({ key: "", data: null, loading: false, error: "" });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [traceMode, setTraceMode] = useState(false);
  const [tracePanelOpen, setTracePanelOpen] = useState(false);
  const [activeTraceNodeId, setActiveTraceNodeId] = useState<string | null>(null);
  const [activeTraceElement, setActiveTraceElement] = useState<HTMLElement | null>(null);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [pendingExcerpt, setPendingExcerpt] = useState<AnnotationExcerptRequest | null>(null);
  const { level: fontSize, setLevel: setFontSize } = useReadingFontPreference();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const outlinePanelRef = useRef<HTMLElement>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const traceTriggerRef = useRef<HTMLButtonElement>(null);
  const openedResourceRef = useRef<string | null>(null);
  const narrow = useMediaQueryMatch("(max-width: 1140px)");
  const compactTools = useMediaQueryMatch("(max-width: 1440px)");
  const coarsePointer = useMediaQueryMatch("(hover: none) and (pointer: coarse)");
  const librarySwipe = useHorizontalSwipeDismiss<HTMLElement>({
    direction: "left",
    enabled: narrow && libraryOpen,
    onDismiss: () => setLibraryOpen(false),
  });
  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);

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
    void loadBoardTextbookManifest()
      .then((nextManifest) => {
        if (active) {
          setManifest(nextManifest);
          setCatalogError("");
        }
      })
      .catch(() => {
        if (active) setCatalogError("考題對照指引暫時無法開啟，請稍後再試。");
      });
    return () => { active = false; };
  }, [catalogAttempt]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      try { setTraceMode(window.localStorage.getItem(tracePreferenceKey) === "true"); } catch { /* The clean reading mode remains the default. */ }
    });
  }, []);

  const selectedUnit = manifest ? selectedUnitFrom(manifest, requestedUnitCode) : null;
  const selectedIndex = selectedUnit && manifest ? manifest.units.findIndex((unit) => unit.unitCode === selectedUnit.unitCode) : -1;
  const contentKey = selectedUnit ? `${selectedUnit.unitCode}:${selectedUnit.contentHash ?? "v1"}` : "";

  useEffect(() => {
    if (!selectedUnit) return;
    let active = true;
    const key = `${selectedUnit.unitCode}:${selectedUnit.contentHash ?? "v1"}`;
    void Promise.resolve().then(() => {
      if (active) setContentState({ key, markdown: "", loading: true, error: "" });
    });
    void loadBoardTextbookUnitMarkdown(selectedUnit.unitCode).then((markdown) => {
      if (active) setContentState({ key, markdown, loading: false, error: "" });
    }).catch(() => {
      if (active) setContentState({ key, markdown: "", loading: false, error: "這個單元暫時無法開啟。" });
    });
    return () => { active = false; };
  }, [contentAttempt, selectedUnit]);

  useEffect(() => {
    if (!selectedUnit || (!traceMode && !requestedTraceNodeId)) return;
    let active = true;
    const key = `${selectedUnit.unitCode}:${selectedUnit.contentHash ?? "v1"}`;
    void Promise.resolve().then(() => {
      if (active) setTraceDataState({ key, data: null, loading: true, error: "" });
    });
    void loadBoardTextbookUnitData(selectedUnit.unitCode).then((data) => {
      if (active) setTraceDataState({ key, data, loading: false, error: "" });
    }).catch(() => {
      if (active) setTraceDataState({ key, data: null, loading: false, error: "歷屆考點索引暫時無法載入；可關閉後再開啟重試。" });
    });
    return () => { active = false; };
  }, [requestedTraceNodeId, selectedUnit, traceAttempt, traceMode]);

  const visibleContent = contentState.key === contentKey
    ? contentState
    : { key: contentKey, markdown: "", loading: true, error: "" };
  const markdown = visibleContent.markdown;
  const visibleTraceData = traceDataState.key === contentKey
    ? traceDataState
    : { key: contentKey, data: null, loading: traceMode || Boolean(requestedTraceNodeId), error: "" };
  const unitData = visibleTraceData.data;
  const outline = useMemo(() => extractMarkdownOutline(markdown), [markdown]);
  const annotationResourceId = resourceIdFor(selectedUnit);
  const selectedProgress = progressMap.get(annotationResourceId);
  const {
    actionLabel: selectedAudioActionLabel,
    accessibleLabel: selectedAudioAccessibleLabel,
    open: openUnitAudioPlayer,
    prepare: prepareUnitAudio,
    source: selectedAudio,
  } = useLearningAudio({
    contentReady: Boolean(markdown),
    noun: "單元",
    resource: selectedUnit ? { kind: "board-unit", unitCode: selectedUnit.unitCode } : null,
  });
  const annotationPrefix = annotationResourceId ? boardGuideAnnotationScopePrefix(annotationResourceId, "full") : null;
  const annotationSource = useMemo<ContentAnnotationSource | null>(() => {
    if (!selectedUnit || !annotationPrefix) return null;
    return {
      resourceId: annotationResourceId,
      eyebrow: `考題對照指引・單元 ${selectedUnit.unitCode}`,
      panelLabel: `單元 ${selectedUnit.unitCode} 筆記`,
      rootNoteTitle: `${selectedUnit.unitCode} 單元讀書筆記`,
      rootNoteDescription: "整理本單元重點、歷屆考點與待查事項",
      rootNotePlaceholder: "整理重點、容易混淆處或待查問題…",
      emptyHint: "可反白正文建立重點或摘錄。",
      kind: "guide",
      annotationPrefix,
      contentScope: "full",
    };
  }, [annotationPrefix, annotationResourceId, selectedUnit]);

  function openSelectedAudio() {
    if (!selectedAudio || !selectedUnit) return;
    openUnitAudioPlayer();
    setMobileToolsOpen(false);
  }

  useEffect(() => {
    if (!selectedUnit || !markdown || progressStatus === "loading" || !annotationResourceId) return;
    const openedKey = `${annotationResourceId}:${selectedUnit.contentHash ?? "v1"}`;
    if (openedResourceRef.current === openedKey) return;
    openedResourceRef.current = openedKey;
    void onOpenResource(annotationResourceId, selectedUnit.contentHash ?? null)
      .then(() => selectedProgress ? undefined : onMarkResource(annotationResourceId, "reading", selectedUnit.contentHash ?? null))
      .catch(() => {
        if (openedResourceRef.current === openedKey) openedResourceRef.current = null;
      });
  }, [annotationResourceId, markdown, onMarkResource, onOpenResource, progressStatus, selectedProgress, selectedUnit]);

  const selectUnit = useCallback((unitCode: string) => {
    setLibraryOpen(false);
    setOutlineOpen(false);
    setMobileToolsOpen(false);
    setTracePanelOpen(false);
    setActiveTraceNodeId(null);
    setActiveTraceElement(null);
    setPendingExcerpt(null);
    onSelectUnit(unitCode);
    scrollPageToTop();
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [onSelectUnit]);

  const selectByOffset = useCallback((offset: number) => {
    if (!manifest || selectedIndex < 0) return;
    const next = manifest.units[selectedIndex + offset];
    if (next) selectUnit(next.unitCode);
  }, [manifest, selectUnit, selectedIndex]);
  const canPrevious = selectedIndex > 0;
  const canNext = Boolean(manifest && selectedIndex >= 0 && selectedIndex < manifest.units.length - 1);
  const readingNavigation = useReadingNavigation({
    onPrevious: () => selectByOffset(-1),
    onNext: () => selectByOffset(1),
    canPrevious,
    canNext,
    enabled: Boolean(markdown) && !tracePanelOpen,
  });

  const setTracePreference = useCallback((enabled: boolean) => {
    setTraceMode(enabled);
    if (!enabled) {
      setTracePanelOpen(false);
      setActiveTraceElement(null);
      setActiveTraceNodeId(null);
    }
    try { window.localStorage.setItem(tracePreferenceKey, String(enabled)); } catch { /* Keep the preference for this session. */ }
  }, []);

  const chooseTraceElement = useCallback((element: HTMLElement) => {
    setActiveTraceElement(element);
    setActiveTraceNodeId(element.dataset.boardTraceNode ?? null);
  }, []);

  const firstVisibleTraceElement = useCallback(() => {
    const nodes = mappedTraceElements(articleRef.current);
    return nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 80 && rect.top < window.innerHeight;
    }) ?? nodes[0] ?? null;
  }, []);

  const focusTraceElement = useCallback((element: HTMLElement) => {
    articleRef.current?.querySelector<HTMLElement>("[data-board-trace-roving='true']")?.removeAttribute("tabindex");
    articleRef.current?.querySelector<HTMLElement>("[data-board-trace-roving='true']")?.removeAttribute("data-board-trace-roving");
    element.dataset.boardTraceRoving = "true";
    element.tabIndex = 0;
    chooseTraceElement(element);
    setMobileToolsOpen(false);
    requestAnimationFrame(() => {
      scrollElementIntoView(element, { block: "center" });
      element.focus({ preventScroll: true });
    });
  }, [chooseTraceElement]);

  const focusAdjacentTraceElement = useCallback((offset: -1 | 1) => {
    const nodes = mappedTraceElements(articleRef.current);
    if (!nodes.length) return;
    const currentIndex = activeTraceElement?.isConnected ? nodes.indexOf(activeTraceElement) : -1;
    const visibleIndex = nodes.findIndex((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 80 && rect.top < window.innerHeight;
    });
    const baseIndex = currentIndex >= 0 ? currentIndex : visibleIndex >= 0 ? visibleIndex : 0;
    const nextIndex = currentIndex < 0
      ? baseIndex
      : Math.min(nodes.length - 1, Math.max(0, baseIndex + offset));
    focusTraceElement(nodes[nextIndex]);
  }, [activeTraceElement, focusTraceElement]);

  const openCurrentTracePanel = useCallback(() => {
    setTracePreference(true);
    const element = activeTraceElement?.isConnected ? activeTraceElement : firstVisibleTraceElement();
    if (element) chooseTraceElement(element);
    setTracePanelOpen(true);
  }, [activeTraceElement, chooseTraceElement, firstVisibleTraceElement, setTracePreference]);

  const handleTracePointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!traceMode || event.pointerType === "touch") return;
    const element = traceElementFromEvent(event.currentTarget, event.target);
    if (element) chooseTraceElement(element);
  }, [chooseTraceElement, traceMode]);

  const handleTraceClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!traceMode || interactiveEventTarget(event.target) || !window.matchMedia("(pointer: coarse)").matches) return;
    if (window.getSelection()?.toString()) return;
    const element = traceElementFromEvent(event.currentTarget, event.target);
    if (!element) return;
    chooseTraceElement(element);
    setTracePanelOpen(true);
  }, [chooseTraceElement, traceMode]);

  const activeParagraphId = paragraphIdFor(unitData, activeTraceNodeId);
  const activeParagraph = activeParagraphId ? unitData?.paragraphs[activeParagraphId] ?? null : null;
  const activeSentence = activeTraceNodeId ? unitData?.sentences[activeTraceNodeId] ?? null : null;
  const activeDirectAtomIds = activeSentence?.direct ?? activeParagraph?.direct ?? emptyTraceAtomIds;
  const activeRelatedAtomIds = activeSentence?.related ?? activeParagraph?.related ?? emptyTraceAtomIds;
  const directHits = useMemo(() => resolveBoardTraceHits(unitData, activeDirectAtomIds), [activeDirectAtomIds, unitData]);
  const relatedHits = useMemo(() => resolveBoardTraceHits(unitData, activeRelatedAtomIds), [activeRelatedAtomIds, unitData]);
  const reconciledTraceItems = useMemo(() => tracePanelOpen
    ? reconcileBoardTraceHits(directHits, relatedHits, questionById)
    : { directItems: [], relatedItems: [] }, [directHits, questionById, relatedHits, tracePanelOpen]);
  const { directItems, relatedItems } = reconciledTraceItems;

  useEffect(() => {
    if (!markdown || !unitData || !requestedTraceNodeId) return;
    const paragraphId = paragraphIdFor(unitData, requestedTraceNodeId);
    if (!paragraphId) return;
    const frame = requestAnimationFrame(() => {
      setTracePreference(true);
      const paragraph = document.getElementById(paragraphId);
      if (!(paragraph instanceof HTMLElement)) return;
      chooseTraceElement(paragraph);
      setActiveTraceNodeId(requestedTraceNodeId);
      paragraph.classList.add("trace-target-highlight");
      paragraph.setAttribute("tabindex", "-1");
      const selector = unitData.sentences[requestedTraceNodeId];
      const range = selector ? textRangeForSelector(paragraph, selector) : null;
      const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
      const HighlightClass = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
      if (range && registry && HighlightClass) {
        ensureBoardTraceHighlightStyle();
        registry.set("board-trace-target", new HighlightClass(range));
      }
      scrollElementIntoView(paragraph, { block: "center" });
      paragraph.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      (CSS as unknown as { highlights?: HighlightRegistry }).highlights?.delete("board-trace-target");
      document.getElementById(paragraphId)?.classList.remove("trace-target-highlight");
    };
  }, [chooseTraceElement, markdown, requestedTraceNodeId, setTracePreference, unitData]);

  const scrollToOutlineItem = (id: string, close = false) => {
    scrollElementIntoView(document.getElementById(id), { block: "start" });
    if (close) setOutlineOpen(false);
  };

  if (catalogError && !manifest) {
    return <main className="workspace-page"><div className="empty-state" role="alert"><BookOpenText /><h2>考題對照指引暫時無法開啟</h2><p>{catalogError}</p><button className="outline-button" onClick={() => setCatalogAttempt((value) => value + 1)}>重新載入</button></div></main>;
  }
  if (!manifest || !selectedUnit) {
    return <LearningReaderLoadingShell sourceId="board" description="依歷屆題目追溯對應的學習單元。" />;
  }

  const libraryId = "board-textbook-library";
  const outlineId = "board-textbook-outline";
  const toolsId = "board-textbook-tools";
  const previousUnit = manifest.units[selectedIndex - 1];
  const nextUnit = manifest.units[selectedIndex + 1];
  const currentTraceCount = traceQuestionCount([...directHits, ...relatedHits]);
  const traceDescription = requestedTraceQuestionId
    ? `由 ${requestedTraceQuestionId} ${requestedTraceTarget ? boardTraceTargetLabel(requestedTraceTarget) : ""}定位至本段。`
    : visibleTraceData.error
      ? visibleTraceData.error
      : activeParagraphId ? `本段對應 ${directItems.length} 題直接考題與 ${relatedItems.length} 題相關題目。` : "選擇正文段落即可查看歷屆考點。";
  const traceControl = (
    <div className="trace-mode-control">
      <button type="button" aria-pressed={traceMode} onClick={() => setTracePreference(!traceMode)}><ScanSearch size={17} /><span><strong>歷屆考點</strong><small>{traceMode ? "段落標記已顯示" : "保持乾淨閱讀"}</small></span></button>
      {traceMode && <div className="trace-mode-navigation" role="group" aria-label="逐段瀏覽有映射的考點"><button type="button" aria-label="上一個有映射的段落" onClick={() => focusAdjacentTraceElement(-1)}><ChevronLeft size={16} /><span>上一段</span></button><button type="button" aria-label="下一個有映射的段落" onClick={() => focusAdjacentTraceElement(1)}><span>下一段</span><ChevronRight size={16} /></button></div>}
      {traceMode && <button type="button" className="text-action" disabled={!activeParagraphId} onClick={openCurrentTracePanel}>查看目前段落</button>}
      {visibleTraceData.error && <button type="button" className="text-action" onClick={() => setTraceAttempt((value) => value + 1)}>重新載入考點索引</button>}
    </div>
  );

  return (
    <main className="guide-page board-textbook-page">
      <ReadingCatalogLayer portal={narrow}>
        <aside
        id={libraryId}
        ref={libraryRef}
        className={`guide-library board-textbook-library swipe-dismiss-panel ${libraryOpen ? "open drawer-panel" : ""} ${librarySwipe.dragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--reading-drawer-drag-x": `${librarySwipe.dragX}px` } as CSSProperties}
        aria-label="考題對照指引單元目錄"
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
          <div><p>BOARD QUESTION MAP</p><h1>歷屆考題對照指引</h1></div>
          <button className="guide-list-close" aria-label="關閉單元目錄" onClick={() => setLibraryOpen(false)}><X /></button>
          <GuideTextbookSwitcher currentTextbook="考題對照指引" onOpenLibrary={onOpenLibrary} />
          <span><strong>{manifest.unitCount}</strong> 個單元・{manifest.questionCount.toLocaleString("zh-TW")} 題</span>
        </header>
        <div className="guide-chapter-list board-textbook-unit-list">
          {manifest.units.map((unit) => (
            <button key={unit.unitCode} data-content-prefetch={unit.unitCode} aria-current={selectedUnit.unitCode === unit.unitCode ? "true" : undefined} className={selectedUnit.unitCode === unit.unitCode ? "active" : ""} onPointerEnter={() => prefetchBoardTextbookUnit(unit.unitCode)} onPointerDown={() => prefetchBoardTextbookUnit(unit.unitCode)} onFocus={() => prefetchBoardTextbookUnit(unit.unitCode)} onClick={() => selectUnit(unit.unitCode)}>
              <span>{unitMarker(unit)}</span><div><strong>{unit.title}</strong><small>{unit.paragraphCount} 個可追溯段落</small></div><ChevronRight size={14} />
            </button>
          ))}
        </div>
        </aside>

        {libraryOpen && <button className="guide-drawer-backdrop" aria-label="關閉單元目錄" onClick={() => setLibraryOpen(false)} />}
      </ReadingCatalogLayer>

      <section className={`guide-workspace reader-size-${fontSize}`} style={{ "--guide-font-size": `${[14, 16, 18][fontSize]}px` } as CSSProperties}>
        <GuideReaderToolbar
          ariaLabel="考題對照指引閱讀工具"
          libraryTriggerRef={libraryTriggerRef}
          libraryAriaLabel="開啟考題對照指引單元目錄"
          libraryControlsId={libraryId}
          libraryOpen={libraryOpen}
          showLibraryTrigger={narrow}
          onOpenLibrary={() => { setOutlineOpen(false); setMobileToolsOpen(false); setLibraryOpen(true); }}
          positionCurrent={unitMarker(selectedUnit)}
          positionTotal={manifest.units.length}
          navigation={{ noun: "單元", canPrevious, canNext, onPrevious: () => selectByOffset(-1), onNext: () => selectByOffset(1) }}
          outlineTriggerRef={outlineTriggerRef}
          outlineAvailable={outline.length > 0}
          outlineControlsId={outlineId}
          outlineOpen={outlineOpen}
          outlineLabel="本文"
          onOpenOutline={() => setOutlineOpen(true)}
          traceAction={<button ref={traceTriggerRef} type="button" className="reading-toolbar-trace" aria-haspopup="dialog" aria-controls={tracePanelId} aria-expanded={tracePanelOpen} onClick={openCurrentTracePanel}><Link2 size={16} /><span>歷屆考點</span></button>}
          audioAction={selectedAudio ? (
            <button
              type="button"
              className="reading-toolbar-audio"
              aria-label={selectedAudioAccessibleLabel}
              onPointerDown={prepareUnitAudio}
              onClick={openSelectedAudio}
            >
              <Headphones aria-hidden="true" />
              <span>音檔</span>
            </button>
          ) : undefined}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="指引文字"
          mobileToolsTriggerRef={mobileToolsTriggerRef}
          mobileToolsControlsId={toolsId}
          mobileToolsOpen={mobileToolsOpen}
          showMobileToolsTrigger={compactTools}
          onOpenMobileTools={() => setMobileToolsOpen(true)}
        />

        {outlineOpen && <div className="reader-modal-backdrop toc-backdrop" onClick={() => setOutlineOpen(false)}><section ref={outlinePanelRef} id={outlineId} tabIndex={-1} className="reader-toc-sheet guide-toc-sheet bottom-sheet-panel" role="dialog" aria-modal="true" aria-label="本單元目錄" onClick={(event) => event.stopPropagation()}><header><strong>本單元目錄</strong><button data-overlay-close aria-label="關閉文章目錄" onClick={() => setOutlineOpen(false)}><X /></button></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollToOutlineItem(item.id, true)}>{item.label}</button>)}</section></div>}
        {mobileToolsOpen && <button className="mobile-reading-tools-backdrop" tabIndex={-1} aria-label="關閉閱讀工具" onClick={() => setMobileToolsOpen(false)} />}

        <GuideReaderToolsPanel
          panelRef={mobileToolsRef}
          id={toolsId}
          open={compactTools && mobileToolsOpen}
          className="board-textbook-utility-panel"
          hidden={compactTools && !mobileToolsOpen}
          ariaLabel="考題對照指引閱讀工具"
          summary={`單元 ${selectedUnit.unitCode}`}
          fontLevel={fontSize}
          onFontChange={setFontSize}
          fontNoun="指引文字"
          onClose={() => setMobileToolsOpen(false)}
          currentTextbook="考題對照指引"
          onOpenLibrary={onOpenLibrary}
          navigation={<div className="guide-rail-navigation"><button className="guide-rail-current" onClick={() => setLibraryOpen(true)}><BookOpenText size={17} /><span><small>目前單元</small><strong>{selectedUnit.unitCode}</strong></span><ChevronRight size={14} /></button><ReadingNextPrev className="guide-rail-step-controls" noun="單元" canPrevious={canPrevious} canNext={canNext} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} /><div className="reader-rail-secondary"><ReadingFontControls className="reader-rail-font" level={fontSize} onChange={setFontSize} noun="指引文字" /></div></div>}
          audioAction={selectedAudio ? (
            <button
              type="button"
              className="guide-audio-action"
              aria-label={selectedAudioAccessibleLabel}
              onPointerDown={prepareUnitAudio}
              onClick={openSelectedAudio}
            >
              <span className="guide-audio-action-icon"><Headphones aria-hidden="true" /></span>
              <span><small>學習音檔</small><strong>{selectedAudioActionLabel}</strong></span>
              <Headphones aria-hidden="true" />
            </button>
          ) : undefined}
          traceControl={traceControl}
          progressActions={annotationSource ? {
            available: true,
            readState: selectedProgress?.readState ?? "unread",
            bookmarked: selectedProgress?.bookmarked === 1,
            bookmarkNoun: "本文",
            onToggleLater: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "later" ? "reading" : "later", selectedUnit.contentHash ?? null),
            onToggleDone: () => void onMarkResource(annotationResourceId, selectedProgress?.readState === "done" ? "reading" : "done", selectedUnit.contentHash ?? null),
            onToggleBookmark: () => void onBookmarkResource(annotationResourceId, selectedProgress?.bookmarked !== 1),
            annotationControl: <ContentAnnotationTools source={annotationSource} contentKey={`${annotationResourceId}:full:${selectedUnit.contentHash ?? "v1"}`} annotations={annotations} annotationStatus={annotationStatus} requestedAnnotationId={requestedAnnotationId} pendingExcerpt={pendingExcerpt} onExcerptHandled={() => setPendingExcerpt(null)} onOpenChange={(open) => { setAnnotationOpen(open); onAnnotationOpenChange(open); }} onUpsert={onUpsert} onRemove={onRemove} />,
          } : null}
          onActionCapture={() => setMobileToolsOpen(false)}
          outlineItems={outline}
          outlineAriaLabel="本單元文章目錄"
          onSelectOutline={(id) => scrollToOutlineItem(id)}
        />

        <div className="guide-reading-column">
          <header className="guide-chapter-header board-textbook-header">
            <p>BOARD QUESTION MAP · UNIT {selectedUnit.unitCode}</p>
            <h1 ref={headingRef} tabIndex={-1}><span>單元 {selectedUnit.unitCode}</span>{selectedUnit.title}</h1>
            <div><span><BookOpenText size={15} />歷屆考題對照指引</span><span className="ready">可對照題幹與選項</span><label className="guide-read-state">我的進度<select value={selectedProgress?.readState ?? "unread"} onChange={(event) => void onMarkResource(annotationResourceId, event.target.value as GuideReadState, selectedUnit.contentHash ?? null)}><option value="unread">未開始</option><option value="reading">閱讀中</option><option value="done">已完成</option><option value="later">稍後閱讀</option></select></label></div>
            {requestedTraceQuestionId && <p className="board-trace-origin"><Link2 size={14} />由 {requestedTraceQuestionId} {requestedTraceTarget ? boardTraceTargetLabel(requestedTraceTarget) : ""}定位</p>}
          </header>

          {outline.length > 0 && <nav className="guide-outline guide-outline-inline" aria-label="本單元正文目錄"><header><ListTree size={17} /><span>本單元目錄・{outline.length}</span></header>{outline.map((item) => <button key={item.id} data-level={item.level} onClick={() => scrollToOutlineItem(item.id)}>{item.label}</button>)}</nav>}
          {visibleContent.loading && !markdown && <div className="guide-body-state" role="status"><Clock3 /><span>正在載入本單元…</span></div>}
          {visibleContent.error && !markdown && <article className="guide-import-placeholder paper-card" role="alert"><BookOpenText /><p>考題對照指引</p><h2>本單元暫時無法開啟</h2><p>{visibleContent.error}</p><button className="outline-button" onClick={() => setContentAttempt((value) => value + 1)}>重新載入本單元</button></article>}
          {markdown && <article ref={articleRef} data-content-annotation-root={annotationResourceId} className={`guide-article board-textbook-article paper-card reading-paper-surface reading-content-swap ${traceMode ? "trace-layer-enabled" : ""} ${visibleContent.loading ? "is-refreshing" : ""}`} aria-busy={visibleContent.loading} aria-label={`考題對照指引單元 ${selectedUnit.unitCode} 正文`} onPointerOver={handleTracePointer} onFocusCapture={(event) => { const element = traceElementFromEvent(event.currentTarget, event.target); if (traceMode && element) chooseTraceElement(element); }} onClick={handleTraceClick} {...readingNavigation}><MarkdownContent markdown={markdown} variant="board" documentTitle={selectedUnit.title} onAddToNotes={setPendingExcerpt} /></article>}
          <ReadingNextPrev className="guide-next-prev" variant="titles" noun="單元" ariaLabel="考題對照指引前後單元" canPrevious={canPrevious} canNext={canNext} previousTitle={previousUnit?.title ?? ""} nextTitle={nextUnit?.title ?? ""} onPrevious={() => selectByOffset(-1)} onNext={() => selectByOffset(1)} />
        </div>
      </section>

      <TraceContextRail anchorElement={activeTraceElement} open={!coarsePointer && traceMode && !annotationOpen && currentTraceCount > 0} panelId={tracePanelId} panelOpen={tracePanelOpen} context={activeParagraphId ? { label: `單元 ${selectedUnit.unitCode} 段落`, target: { kind: "reference", resourceId: annotationResourceId, anchorId: activeParagraphId } } : null} count={currentTraceCount} onOpenPanel={() => setTracePanelOpen(true)} onDismiss={() => { setActiveTraceElement(null); setActiveTraceNodeId(null); }} />
      <TraceabilityPanel open={tracePanelOpen} id={tracePanelId} ariaLabel="歷屆考點對照" eyebrow={`單元 ${selectedUnit.unitCode}・雙向追溯`} title={activeParagraphId ? "這一段考過什麼？" : "歷屆考點"} description={traceDescription} directItems={directItems} relatedItems={relatedItems} directLabel="直接考過" relatedLabel="同觀念延伸" directHint="題目曾直接命中這一段" relatedHint="同一觀念的其他題目" directEmptyLabel="這一段目前沒有直接考題。" relatedEmptyLabel="這一段目前沒有其他相關題目。" countUnit="題" initialVisibleCount={10} loading={visibleTraceData.loading} triggerRef={traceTriggerRef} closeOnSelect onClose={() => setTracePanelOpen(false)} onSelectQuestion={(questionId, item) => item.matchesQuestionStem ? onOpenReaderTrace(questionId, "stem") : onOpenReader(questionId)} onSelectOption={(questionId, optionKey) => onOpenReaderTrace(questionId, `option-${optionKey}`)} />
    </main>
  );
}
