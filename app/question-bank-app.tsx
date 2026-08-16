"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { ArrowUp, BarChart3, BookMarked, BookOpenText, CircleDot, ClipboardCheck, Files, GraduationCap, Headphones, Leaf, Library, Menu, RotateCcw, Search, Settings2, X, ChevronRight } from "lucide-react";
import { useAudioPlayer } from "./components/audio-player-provider";
import ThemeToggle from "./components/theme-toggle";
import { useAnnotations } from "./hooks/use-annotations";
import { useGuideProgress } from "./hooks/use-guide-progress";
import { useGuideResourceProgress } from "./hooks/use-guide-resource-progress";
import { useGuideNoteMigration } from "./hooks/use-guide-note-migration";
import { useExplanationPreferences } from "./hooks/use-explanation-preferences";
import { useDialogFocus } from "./hooks/use-dialog-focus";
import { useProgress, type ProgressResetType } from "./hooks/use-progress";
import { useStudyPlan } from "./hooks/use-study-plan";
import { prefetchQuestionExplanation } from "./lib/explanation-packs";
import { enrichQuestionBankGuideLinks, loadQuestionBank, loadQuestionBankStartup, prefetchQuestion } from "./lib/question-data";
import { QUESTION_BANK_READY_ATTRIBUTE, QUESTION_BANK_READY_EVENT } from "./lib/app-readiness";
import { ailsGuideHash, boardGuideHash, emsGuideHash, goldfrankGuideHash, guideHash, learningDocumentHash, normalizePrepRouteId, parseAppHash, prepHash, readerHash, readerTraceHash, textbookGuideHash, type AilsRouteId, type GuideModuleId, type GuideTextbookId, type PrepRouteId } from "./lib/app-route";
import type { BoardTraceTarget } from "./lib/board-trace";
import type { AilsPageId } from "./lib/ails-review";
import { parseAnyGuideAnnotationResourceId } from "./lib/annotation-source";
import { LEARNING_SOURCE_REGISTRY } from "./lib/learning-source-registry";
import { supplementalSectionDisplayId } from "./lib/supplemental-guide-ids";
import { dedupeCanonicalQuestionIds } from "./lib/canonical-concepts";
import { ACTIVE_PRACTICE_SESSION_EVENT, activePracticeSessionKey, preparePracticeSessionForEntry, readActivePracticeSession, writeActivePracticeSession } from "./lib/practice-session";
import { buildDailyStudyPlan } from "./lib/study-plan";
import { scrollElementIntoView, scrollPageToTop } from "./lib/motion";
import type { BrowsePreset, Manifest, NavView, PracticeSession, QuestionIndex } from "./lib/types";
import DashboardView from "./views/dashboard-view";

const deferredModuleRecoveryPrefix = "em-board-module-recovery-v1:";

function recoverableDynamicImportFailure(cause: unknown) {
  const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|error loading dynamically imported module/iu.test(message);
}

async function loadDeferredModule<T>(scope: string, loader: () => Promise<T>): Promise<T> {
  try {
    const loaded = await loader();
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem(`${deferredModuleRecoveryPrefix}${scope}`); } catch { /* Recovery still works without storage. */ }
    }
    return loaded;
  } catch (cause) {
    if (typeof window === "undefined" || navigator.onLine === false || !recoverableDynamicImportFailure(cause)) throw cause;
    const key = `${deferredModuleRecoveryPrefix}${scope}`;
    let previous = 0;
    try { previous = Number(window.sessionStorage.getItem(key) ?? 0); } catch { /* A single in-memory reload is still safe. */ }
    if (!Number.isFinite(previous) || Date.now() - previous > 60_000) {
      const marker = String(Date.now());
      let markerPersisted = false;
      try {
        window.sessionStorage.setItem(key, marker);
        markerPersisted = window.sessionStorage.getItem(key) === marker;
      } catch { /* Without a durable marker, reloading could create a loop. */ }
      if (markerPersisted) {
        window.location.reload();
        return new Promise<T>(() => undefined);
      }
    }
    throw cause;
  }
}

const loadGlobalSpotlight = () => loadDeferredModule("global-spotlight", () => import("./components/global-spotlight"));
const loadLearningDataDialog = () => loadDeferredModule("learning-data-dialog", () => import("./components/learning-data-dialog"));
const loadAnalyticsView = () => loadDeferredModule("analytics", () => import("./views/analytics-view"));
const loadAudioLibraryView = () => loadDeferredModule("audio", () => import("./views/audio-library-view"));
const loadBoardPrepView = () => loadDeferredModule("board-prep", () => import("./views/board-prep-view"));
const loadBrowseView = () => loadDeferredModule("browse", () => import("./views/browse-view"));
const loadPracticeView = () => loadDeferredModule("practice", () => import("./views/practice-view"));
const loadReaderView = () => loadDeferredModule("reader", () => import("./views/reader-view"));
const loadReviewView = () => loadDeferredModule("review", () => import("./views/review-view"));
const loadNotebookView = () => loadDeferredModule("notebook", () => import("./views/notebook-view"));
const loadRestView = () => loadDeferredModule("rest", () => import("./views/rest-view"));
const loadLearningGuideView = () => loadDeferredModule("learning-guide", () => import("./views/learning-guide-view"));
const loadLearningDocumentsView = () => loadDeferredModule("learning-documents", () => import("./views/learning-documents-view"));

const GlobalSpotlight = lazy(loadGlobalSpotlight);
const LearningDataDialog = lazy(loadLearningDataDialog);

const AnalyticsView = lazy(loadAnalyticsView);
const AudioLibraryView = lazy(loadAudioLibraryView);
const BoardPrepView = lazy(loadBoardPrepView);
const BrowseView = lazy(loadBrowseView);
const PracticeView = lazy(loadPracticeView);
const ReaderView = lazy(loadReaderView);
const ReviewView = lazy(loadReviewView);
const NotebookView = lazy(loadNotebookView);
const RestView = lazy(loadRestView);
const LearningGuideView = lazy(loadLearningGuideView);
const LearningDocumentsView = lazy(loadLearningDocumentsView);

const routeViewLoaders: Partial<Record<NavView, () => Promise<unknown>>> = {
  "開始作答": loadPracticeView,
  "題庫瀏覽": loadBrowseView,
  "詳解閱讀": loadReaderView,
  "學習指引": loadLearningGuideView,
  "學習音檔": loadAudioLibraryView,
  "學習文件": loadLearningDocumentsView,
  "錯題本": loadReviewView,
  "筆記本": loadNotebookView,
  "學習分析": loadAnalyticsView,
  "備考中心": loadBoardPrepView,
  "休息站": loadRestView,
};

const routePreloadPromises = new Map<NavView, Promise<unknown>>();

function preloadRouteView(view: NavView) {
  const loader = routeViewLoaders[view];
  if (!loader) return Promise.resolve();
  const existing = routePreloadPromises.get(view);
  if (existing) return existing;
  const pending = loader().catch((cause) => {
    routePreloadPromises.delete(view);
    throw cause;
  });
  routePreloadPromises.set(view, pending);
  void pending.catch(() => undefined);
  return pending;
}

// Keep this list intentionally small. It warms the next likely route chunk
// after the current page has painted, but it does not fetch that route's data
// or initialize another page's side effects.
const relatedRouteViews: Partial<Record<NavView, readonly NavView[]>> = {
  "總覽": ["開始作答"],
  "開始作答": ["題庫瀏覽", "詳解閱讀"],
  "題庫瀏覽": ["詳解閱讀", "開始作答"],
  "詳解閱讀": ["題庫瀏覽", "開始作答"],
  "學習指引": ["學習音檔", "學習文件"],
  "學習音檔": ["學習指引", "學習文件"],
  "學習文件": ["學習指引", "學習音檔"],
  "錯題本": ["詳解閱讀", "開始作答"],
  "學習分析": ["題庫瀏覽", "開始作答"],
  "備考中心": ["開始作答", "學習指引"],
};

function canPreloadRelatedRoutes() {
  if (document.visibilityState !== "visible") return false;
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
      deviceMemory?: number;
    }
  ).connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  // Unknown capability signals are common in WebViews and Safari. Pointer
  // intent still loads immediately, but speculative sibling work stays off.
  return Boolean(connection?.effectiveType) && memory !== undefined && memory >= 4;
}

const fullQuestionIndexViews = new Set<NavView>([
  "開始作答",
  "題庫瀏覽",
  "詳解閱讀",
  "學習指引",
  "錯題本",
  "筆記本",
  "學習分析",
]);

function routeMayOfferLearningAudio(view: NavView, questionId?: string | null) {
  return (
    view === "學習指引"
    || view === "學習音檔"
    || (view === "詳解閱讀" && Boolean(questionId))
  );
}

function canWarmFullQuestionIndex() {
  if (document.visibilityState !== "visible") return false;
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  return !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
}

type RouteTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function canUseRouteTransition() {
  const transitionDocument = document as RouteTransitionDocument;
  if (!transitionDocument.startViewTransition || document.visibilityState !== "visible") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory === undefined || memory >= 4;
}

type NavItem = {
  name: NavView;
  label: string;
  pageTitle: string;
  detail: string;
  hash: string;
  icon: typeof BookOpenText;
  group: "today" | "questions" | "knowledge" | "review" | "qualification";
};

const navItems: NavItem[] = [
  { name: "總覽", label: "今日", pageTitle: "整理今日進度，安排下一輪複習", detail: "進度與下一步", hash: "dashboard", icon: BookOpenText, group: "today" },
  { name: "開始作答", label: "作答", pageTitle: "建立一輪練習", detail: "建立練習或模擬考", hash: "practice", icon: CircleDot, group: "questions" },
  { name: "題庫瀏覽", label: "選題", pageTitle: "搜尋與篩選題庫", detail: "搜尋與組合題目", hash: "browse", icon: Search, group: "questions" },
  { name: "詳解閱讀", label: "詳解", pageTitle: "選擇試卷", detail: "依年度逐題閱讀", hash: "reader", icon: Library, group: "questions" },
  { name: "學習指引", label: "指引", pageTitle: "選擇學習指引", detail: "章節指引與 AILS", hash: "guides", icon: GraduationCap, group: "knowledge" },
  { name: "學習音檔", label: "音檔", pageTitle: "學習音檔", detail: "章節語音複習", hash: "audio", icon: Headphones, group: "knowledge" },
  { name: "學習文件", label: "文件", pageTitle: "學習文件", detail: "圖譜、講義與簡報", hash: "documents", icon: Files, group: "knowledge" },
  { name: "錯題本", label: "錯題", pageTitle: "集中複習錯題與收藏", detail: "處理待釐清觀念", hash: "review", icon: RotateCcw, group: "review" },
  { name: "筆記本", label: "筆記", pageTitle: "重點與題目筆記", detail: "整理收藏與摘錄", hash: "notebook", icon: BookMarked, group: "knowledge" },
  { name: "學習分析", label: "分析", pageTitle: "學習進度與作答表現", detail: "查看弱項與覆蓋率", hash: "analytics", icon: BarChart3, group: "review" },
  { name: "備考中心", label: "備考", pageTitle: "住院醫師必修與甄審進度", detail: "資格、課程與甄審", hash: "prep", icon: ClipboardCheck, group: "qualification" },
  { name: "休息站", label: "休息", pageTitle: "選擇現在需要的恢復方式", detail: "短暫調整專注節奏", hash: "rest", icon: Leaf, group: "qualification" },
];

const primaryNavItems = [
  navItems.find((item) => item.name === "總覽")!,
  navItems.find((item) => item.name === "開始作答")!,
  { ...navItems.find((item) => item.name === "學習指引")!, label: "學習" },
  navItems.find((item) => item.name === "錯題本")!,
  navItems.find((item) => item.name === "備考中心")!,
];
const mobileNavItems = primaryNavItems.filter((item) => item.name !== "備考中心");
const drawerGroups = [
  { label: "今天", items: navItems.filter((item) => item.group === "today") },
  { label: "題庫訓練", items: navItems.filter((item) => item.group === "questions") },
  { label: "學習", items: navItems.filter((item) => item.group === "knowledge") },
  { label: "錯題與分析", items: navItems.filter((item) => item.group === "review") },
  { label: "資格與節奏", items: navItems.filter((item) => item.group === "qualification") },
];
const contextGroups = [
  { label: "題庫訓練", items: navItems.filter((item) => item.group === "questions") },
  { label: "學習", items: navItems.filter((item) => item.group === "knowledge") },
  { label: "錯題與分析", items: navItems.filter((item) => item.group === "review") },
];

const rawDraftPreferenceKey = "em-board-raw-draft-enabled-v1";

function viewFromHash() {
  if (typeof window === "undefined") return { view: "總覽" as NavView, id: null as string | null, annotationId: null as string | null, textbookId: null as GuideTextbookId | null, guideModuleId: null as GuideModuleId | null, traceNodeId: null as string | null, traceQuestionId: null as string | null, traceTarget: null as BoardTraceTarget | null };
  const route = parseAppHash(window.location.hash);
  return { view: route.view, id: route.resourceId, annotationId: route.annotationId, textbookId: route.textbookId ?? null, guideModuleId: route.guideModuleId ?? null, traceNodeId: route.traceNodeId ?? null, traceQuestionId: route.traceQuestionId ?? null, traceTarget: route.traceTarget ?? null };
}

const navGroupLabels: Record<NavItem["group"], string> = {
  today: "今日",
  questions: "題庫訓練",
  knowledge: "學習",
  review: "錯題與分析",
  qualification: "資格與節奏",
};

function RouteLoadingShell({ view }: { view: NavView }) {
  const item = navItems.find((candidate) => candidate.name === view) ?? navItems[0];
  const Icon = item.icon;

  return (
    <main className="workspace-page route-loading-shell" aria-busy="true" aria-labelledby="route-loading-title">
      <header className="page-intro route-loading-intro">
        <p className="eyebrow"><span aria-hidden="true" />{navGroupLabels[item.group]}</p>
        <h1 id="route-loading-title">{item.pageTitle}</h1>
        <p>{item.detail}</p>
        <span className="route-loading-icon" aria-hidden="true"><Icon /></span>
      </header>
      <div className="route-loading-grid" aria-hidden="true">
        <section className="route-loading-panel route-loading-panel-primary">
          <i />
          <i />
          <i />
        </section>
        <aside className="route-loading-panel">
          <i />
          <i />
        </aside>
      </div>
      <p className="sr-only" aria-live="polite">正在準備{item.name}內容</p>
    </main>
  );
}

function RouteDataError({ view, onRetry }: { view: NavView; onRetry: () => void }) {
  const item = navItems.find((candidate) => candidate.name === view) ?? navItems[0];
  return (
    <main className="workspace-page route-loading-shell" aria-labelledby="route-data-error-title">
      <header className="page-intro route-loading-intro">
        <p className="eyebrow"><span aria-hidden="true" />{navGroupLabels[item.group]}</p>
        <h1 id="route-data-error-title">{item.pageTitle}</h1>
        <p>這一頁暫時無法準備完成，請再試一次。</p>
        <button type="button" className="outline-button" onClick={onRetry}>重新載入內容</button>
      </header>
    </main>
  );
}

function StartupHome() {
  return (
    <div className="site-shell startup-shell" aria-busy="true" aria-label="正在準備急專補給站首頁">
      <header className="topbar startup-topbar">
        <a className="brand" href="#dashboard" aria-label="急專補給站首頁">
          <span className="brand-mark" aria-hidden="true" />
          <span><strong>急專補給站</strong><small>題庫・指引・音檔</small></span>
        </a>
        <nav className="desktop-nav startup-nav" aria-label="快速導覽">
          <a className="active" href="#dashboard">今日</a>
          <a href="#practice">作答</a>
          <a href="#guides">學習</a>
          <a href="#review">錯題</a>
          <a href="#prep">備考</a>
        </nav>
        <span className="startup-sync-status" role="status"><i aria-hidden="true" />準備個人化進度</span>
      </header>
      <div className="route-stage">
        <main className="dashboard-page instrument-dashboard startup-dashboard">
          <section className="instrument-hero" aria-labelledby="startup-dashboard-title">
            <div className="instrument-hero-copy">
              <p className="instrument-registration"><span>今日複習</span><b>DAILY STUDY / 01</b></p>
              <h1 id="startup-dashboard-title"><span>整理今日進度，</span><em>安排下一輪複習</em></h1>
              <p className="instrument-hero-lead">首頁已經可以閱讀；今日進度會接著顯示。</p>
              <div className="hero-actions instrument-hero-actions">
                <a className="primary-button" href="#practice">前往作答<ChevronRight aria-hidden="true" /></a>
              </div>
              <div className="instrument-archive-index" aria-label="題庫索引摘要">
                <span><b>—</b><small>QUESTIONS</small></span>
                <span><b>—</b><small>BOARD ARCHIVE</small></span>
              </div>
            </div>
            <aside className="instrument-progress-plate startup-progress-plate" aria-label="正在準備今日學習狀態">
              <header><span>STUDY STATUS</span><small>今日進度</small></header>
              <div className="startup-progress-mark" aria-hidden="true"><span /></div>
              <p>今日進度即將顯示</p>
            </aside>
          </section>
          <section className="instrument-status-strip startup-status-strip" aria-label="載入狀態">
            <article><span>TODAY 01</span><p>首頁</p><strong>可開始瀏覽</strong></article>
            <article><span>PROGRESS 02</span><p>今日進度</p><strong>即將顯示</strong></article>
            <article><span>STUDY 03</span><p>功能頁面</p><strong>可直接選擇</strong></article>
          </section>
        </main>
      </div>
    </div>
  );
}

export default function QuestionBankApp() {
  return <QuestionBankAppContent />;
}

function QuestionBankAppContent() {
  const initial = viewFromHash();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [questions, setQuestions] = useState<QuestionIndex[]>([]);
  const [fullQuestionIndexReady, setFullQuestionIndexReady] = useState(false);
  const [fullQuestionIndexError, setFullQuestionIndexError] = useState(false);
  const [spotlightInitiallyOpen, setSpotlightInitiallyOpen] = useState(false);
  const [spotlightLoadFailed, setSpotlightLoadFailed] = useState(false);
  const [activeNav, setActiveNav] = useState<NavView>(initial.view);
  const [requestedQuestionId, setRequestedQuestionId] = useState<string | null>(initial.id);
  const [requestedAnnotationId, setRequestedAnnotationId] = useState<string | null>(initial.annotationId);
  const [requestedTextbookId, setRequestedTextbookId] = useState<GuideTextbookId | null>(initial.textbookId);
  const [requestedGuideModuleId, setRequestedGuideModuleId] = useState<GuideModuleId | null>(initial.guideModuleId);
  const [requestedTraceNodeId, setRequestedTraceNodeId] = useState<string | null>(initial.traceNodeId);
  const [requestedTraceQuestionId, setRequestedTraceQuestionId] = useState<string | null>(initial.traceQuestionId);
  const [requestedTraceTarget, setRequestedTraceTarget] = useState<BoardTraceTarget | null>(initial.traceTarget);
  const [rawDraftEnabled, setRawDraftEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDragX, setMenuDragX] = useState(0);
  const [menuDragging, setMenuDragging] = useState(false);
  const [error, setError] = useState("");
  const [browsePreset, setBrowsePreset] = useState<BrowsePreset | null>(null);
  const [learningDataOpen, setLearningDataOpen] = useState(false);
  const [practiceLaunch, setPracticeLaunch] = useState<{ ids: string[]; nonce: number } | null>(null);
  const [activePracticeSnapshot, setActivePracticeSnapshot] = useState<{ accountKey: string; session: PracticeSession | null } | null>(null);
  const [practiceEpoch, setPracticeEpoch] = useState(0);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const routeNavigationSequenceRef = useRef(0);
  const fullQuestionLoadRef = useRef<Promise<void> | null>(null);
  const fullQuestionIndexReadyRef = useRef(false);
  const menuSwipeRef = useRef<{
    axis: "horizontal" | "vertical" | null;
    lastTime: number;
    lastX: number;
    pointerId: number;
    startTime: number;
    startX: number;
    startY: number;
    velocityX: number;
  } | null>(null);
  const menuSwipeTriggeredRef = useRef(false);
  const [studyPlanNow, setStudyPlanNow] = useState(() => new Date().toISOString());
  const progress = useProgress();
  const explanationPreferences = useExplanationPreferences();
  const explanationMode = explanationPreferences.mode;
  const setExplanationMode = explanationPreferences.setMode;
  const annotations = useAnnotations();
  const guideProgress = useGuideProgress();
  const guideResourceProgress = useGuideResourceProgress();
  const audioPlayer = useAudioPlayer();
  const prepareAudioShell = audioPlayer.prepareShell;
  const ensureFullQuestionBank = useCallback(() => {
    if (fullQuestionIndexReadyRef.current) return Promise.resolve();
    if (fullQuestionLoadRef.current) return fullQuestionLoadRef.current;
    setFullQuestionIndexError(false);
    const request = loadQuestionBank()
      .then(({ manifest: nextManifest, questions: nextQuestions }) => {
        setManifest(nextManifest);
        setQuestions(nextQuestions);
        fullQuestionIndexReadyRef.current = true;
        setFullQuestionIndexReady(true);
        void enrichQuestionBankGuideLinks(nextQuestions)
          .then((enriched) => setQuestions(enriched))
          .catch(() => undefined);
      })
      .catch((cause: unknown) => {
        fullQuestionLoadRef.current = null;
        setFullQuestionIndexError(true);
        throw cause;
      });
    fullQuestionLoadRef.current = request;
    return request;
  }, []);
  const prepareAudioForRoute = useCallback((view: NavView, questionId?: string | null) => {
    preloadRouteView(view);
    if (fullQuestionIndexViews.has(view)) void ensureFullQuestionBank().catch(() => undefined);
    if (!routeMayOfferLearningAudio(view, questionId)) return;
    // Pointer intent may fetch the small worker/module shell, but the ~52 MB
    // decoder runtime must not compete with the destination's first frame.
    prepareAudioShell();
  }, [ensureFullQuestionBank, prepareAudioShell]);
  useEffect(() => {
    prepareAudioForRoute(activeNav, activeNav === "詳解閱讀" ? requestedQuestionId : null);
  }, [activeNav, prepareAudioForRoute, requestedQuestionId]);

  useEffect(() => {
    const targets = relatedRouteViews[activeNav];
    if (!targets?.length) return;
    let cancelled = false;
    let targetIndex = 0;
    let timer: number | null = null;
    let idleId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const clearScheduled = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
      timer = null;
      idleId = null;
    };

    const scheduleNext = () => {
      if (cancelled || targetIndex >= targets.length || !canPreloadRelatedRoutes()) return;
      const run = () => {
        timer = null;
        idleId = null;
        if (cancelled || !canPreloadRelatedRoutes()) return;
        // Do not spend the idle window competing with the route's first
        // visible frame. Suspense/inline loading is still the fallback if the
        // user changes routes before this background work finishes.
        if (!document.querySelector("#site-main > main:not(.route-loading-shell)")) {
          timer = window.setTimeout(scheduleNext, 250);
          return;
        }
        const next = targets[targetIndex];
        targetIndex += 1;
        void preloadRouteView(next)
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) timer = window.setTimeout(scheduleNext, 140);
          });
      };
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(run, { timeout: 1_200 });
      } else {
        timer = window.setTimeout(run, 80);
      }
    };

    // Let the selected page paint and settle before asking the network for a
    // sibling route chunk. This is intentionally chunk-only prefetching.
    timer = window.setTimeout(scheduleNext, 700);
    return () => {
      cancelled = true;
      clearScheduled();
    };
  }, [activeNav]);
  useEffect(() => {
    if (!manifest || !questions.length || fullQuestionIndexReady) return;
    if (fullQuestionIndexViews.has(activeNav)) {
      void ensureFullQuestionBank().catch(() => undefined);
      return;
    }
    if (activeNav !== "總覽" || !canWarmFullQuestionIndex()) return;

    let cancelled = false;
    let timerId: number | null = null;
    let idleId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const warm = () => {
      timerId = null;
      idleId = null;
      if (!cancelled && canWarmFullQuestionIndex()) {
        void ensureFullQuestionBank().catch(() => undefined);
      }
    };
    timerId = window.setTimeout(() => {
      timerId = null;
      if (cancelled) return;
      if (idleWindow.requestIdleCallback) idleId = idleWindow.requestIdleCallback(warm, { timeout: 2_500 });
      else timerId = window.setTimeout(warm, 350);
    }, 1_200);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
    };
  }, [activeNav, ensureFullQuestionBank, fullQuestionIndexReady, manifest, questions.length]);
  useGuideNoteMigration({
    progress: guideProgress.records,
    progressStatus: guideProgress.status,
    progressAccountKey: guideProgress.accountKey,
    annotations: annotations.annotations,
    annotationStatus: annotations.status,
    annotationAccountKey: annotations.accountKey,
    onUpsert: annotations.upsert,
    onClearLegacyNote: guideProgress.saveChapterNote,
  });
  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const validPracticeIds = useMemo(
    () => new Set(questions.filter((question) => !question.excludedFromPractice).map((question) => question.id)),
    [questions],
  );
  const activePracticeSession = activePracticeSnapshot?.accountKey === progress.accountKey
    ? activePracticeSnapshot.session
    : null;
  const categoryIds = useMemo(() => manifest?.categories.map((category) => category.id) ?? [], [manifest]);
  const studyPlan = useStudyPlan(progress.accountKey, categoryIds);
  const dailyPlan = useMemo(() => buildDailyStudyPlan({
    questions,
    progressMap: progress.progressMap,
    attempts: progress.attempts,
    settings: studyPlan.settings,
    now: studyPlanNow,
  }), [progress.attempts, progress.progressMap, questions, studyPlan.settings, studyPlanNow]);
  useEffect(() => {
    const accountKey = progress.accountKey;
    if (!accountKey) return;
    let active = true;
    const refresh = () => {
      if (active) {
        setActivePracticeSnapshot({
          accountKey,
          session: preparePracticeSessionForEntry(readActivePracticeSession(accountKey), validPracticeIds),
        });
      }
    };
    const storageKey = activePracticeSessionKey(accountKey);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refresh();
    };
    window.addEventListener(ACTIVE_PRACTICE_SESSION_EVENT, refresh);
    window.addEventListener("storage", handleStorage);
    Promise.resolve().then(refresh);
    return () => {
      active = false;
      window.removeEventListener(ACTIVE_PRACTICE_SESSION_EVENT, refresh);
      window.removeEventListener("storage", handleStorage);
    };
  }, [progress.accountKey, validPracticeIds]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        setRawDraftEnabled(window.localStorage.getItem(rawDraftPreferenceKey) === "true");
      } catch {
        // The advanced display preference can safely remain disabled.
      }
    });
    return () => { active = false; };
  }, []);

  const updateRawDraftEnabled = useCallback((enabled: boolean) => {
    setRawDraftEnabled(enabled);
    try { window.localStorage.setItem(rawDraftPreferenceKey, String(enabled)); } catch { /* Keep the session preference. */ }
    if (!enabled && explanationMode === "raw") setExplanationMode("full");
  }, [explanationMode, setExplanationMode]);

  const activeExplanationMode = rawDraftEnabled || explanationPreferences.mode !== "raw"
    ? explanationPreferences.mode
    : "full";

  useEffect(() => {
    const refreshStudyPlanClock = () => setStudyPlanNow(new Date().toISOString());
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refreshStudyPlanClock(); };
    const interval = window.setInterval(refreshStudyPlanClock, 60_000);
    window.addEventListener("focus", refreshStudyPlanClock);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshStudyPlanClock);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let readyFrame = 0;
    const initialRoute = viewFromHash();
    loadQuestionBankStartup().then(({ manifest: nextManifest, questions: nextQuestions }) => {
      if (!active) return;
      if (!fullQuestionIndexReadyRef.current) {
        setManifest(nextManifest); setQuestions(nextQuestions);
      }
      if (initialRoute.view === "詳解閱讀" && initialRoute.id) {
        const target = nextQuestions.find((question) => question.id === initialRoute.id);
        prefetchQuestion(target ?? { id: initialRoute.id, exam: initialRoute.id.split("-Q")[0] });
      }
      readyFrame = window.requestAnimationFrame(() => {
        if (!active) return;
        document.documentElement.setAttribute(QUESTION_BANK_READY_ATTRIBUTE, "true");
        window.dispatchEvent(new Event(QUESTION_BANK_READY_EVENT));
      });
    }).catch((cause) => {
      if (!active) return;
      console.error("Unable to load the question bank", cause);
      setError("題庫資料暫時無法載入，請重新整理頁面。");
    });
    return () => {
      active = false;
      if (readyFrame) window.cancelAnimationFrame(readyFrame);
      document.documentElement.removeAttribute(QUESTION_BANK_READY_ATTRIBUTE);
    };
  }, []);

  useEffect(() => {
    const syncFromHash = () => {
      const next = viewFromHash();
      prepareAudioForRoute(next.view, next.view === "詳解閱讀" ? next.id : null);
      setActiveNav(next.view);
      setRequestedQuestionId(next.id);
      setRequestedAnnotationId(next.annotationId);
      setRequestedTextbookId(next.textbookId);
      setRequestedGuideModuleId(next.guideModuleId);
      setRequestedTraceNodeId(next.traceNodeId);
      setRequestedTraceQuestionId(next.traceQuestionId);
      setRequestedTraceTarget(next.traceTarget);
    };
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, [prepareAudioForRoute]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("site-main")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNav]);

  const navigate = useCallback((view: NavView) => {
    const item = navItems.find((entry) => entry.name === view)!;
    prepareAudioForRoute(view);
    const sequence = routeNavigationSequenceRef.current + 1;
    routeNavigationSequenceRef.current = sequence;
    const commit = () => {
      setActiveNav(view);
      setMenuOpen(false);
      // Entering the reader from the primary navigation is a deliberate return
      // to its exam chooser. Question cards and deep links use openReader().
      setRequestedQuestionId(null);
      setRequestedAnnotationId(null);
      setRequestedTextbookId(null);
      setRequestedGuideModuleId(null);
      setRequestedTraceNodeId(null);
      setRequestedTraceQuestionId(null);
      setRequestedTraceTarget(null);
      setPracticeLaunch(null);
      window.history.pushState(null, "", `#${item.hash}`);
      scrollPageToTop();
    };
    let waitTimer = 0;
    const chunkReady = preloadRouteView(view).catch(() => undefined);
    const shortHold = new Promise<void>((resolve) => {
      waitTimer = window.setTimeout(resolve, 120);
    });
    void Promise.race([chunkReady.then(() => undefined), shortHold]).then(() => {
      window.clearTimeout(waitTimer);
      if (routeNavigationSequenceRef.current !== sequence) return;
      const transitionDocument = document as RouteTransitionDocument;
      if (!canUseRouteTransition() || !transitionDocument.startViewTransition) {
        commit();
        return;
      }
      const transition = transitionDocument.startViewTransition(() => {
        flushSync(commit);
      });
      void transition.finished.catch(() => undefined);
    });
  }, [prepareAudioForRoute]);

  const openPracticeIds = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const conceptIds = dedupeCanonicalQuestionIds(ids, questionById, { progressMap: progress.progressMap });
    if (!conceptIds.length) return;
    setPracticeLaunch({ ids: conceptIds, nonce: Date.now() });
    setActiveNav("開始作答");
    setMenuOpen(false);
    window.history.pushState(null, "", "#practice");
    scrollPageToTop();
  }, [progress.progressMap, questionById]);

  const consumePracticeLaunch = useCallback((nonce: number) => {
    setPracticeLaunch((current) => current?.nonce === nonce ? null : current);
  }, []);

  const openReader = useCallback((id: string) => {
    prepareAudioForRoute("詳解閱讀", id);
    const question = questionById.get(id);
    prefetchQuestion(question ?? { id, exam: id.split("-Q")[0] });
    if (question) prefetchQuestionExplanation(question, explanationPreferences.packId);
    setRequestedQuestionId(id); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("詳解閱讀"); setMenuOpen(false);
    window.history.pushState(null, "", readerHash(id));
    scrollPageToTop();
  }, [explanationPreferences.packId, prepareAudioForRoute, questionById]);

  const selectReaderQuestion = useCallback((id: string) => {
    prepareAudioForRoute("詳解閱讀", id);
    setRequestedQuestionId(id); setRequestedAnnotationId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", readerHash(id));
  }, [prepareAudioForRoute]);

  const openReaderTrace = useCallback((id: string, target: BoardTraceTarget) => {
    prepareAudioForRoute("詳解閱讀", id);
    const question = questionById.get(id);
    prefetchQuestion(question ?? { id, exam: id.split("-Q")[0] });
    if (question) prefetchQuestionExplanation(question, explanationPreferences.packId);
    setRequestedQuestionId(id); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(target); setActiveNav("詳解閱讀"); setMenuOpen(false);
    window.history.pushState(null, "", readerTraceHash(id, target));
    scrollPageToTop();
  }, [explanationPreferences.packId, prepareAudioForRoute, questionById]);

  const selectLearningDocument = useCallback((documentId: string) => {
    setRequestedQuestionId(documentId);
    window.history.pushState(null, "", learningDocumentHash(documentId));
    scrollPageToTop();
  }, []);

  const openGuide = useCallback((resource: number | string) => {
    setRequestedQuestionId(String(resource)); setRequestedAnnotationId(null); setRequestedTextbookId("tintinalli"); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", typeof resource === "number" ? guideHash(resource) : textbookGuideHash("tintinalli", resource));
    scrollPageToTop();
  }, []);

  const selectGuideChapter = useCallback((resource: number | string) => {
    setRequestedQuestionId(String(resource)); setRequestedAnnotationId(null); setRequestedTextbookId("tintinalli"); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", typeof resource === "number" ? guideHash(resource) : textbookGuideHash("tintinalli", resource));
  }, []);

  const openGuideLibrary = useCallback(() => {
    setRequestedQuestionId(null); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", "#guides");
    scrollPageToTop();
  }, []);

  const openTextbookGuideLibrary = useCallback((textbookId: GuideTextbookId) => {
    prepareAudioForRoute("學習指引");
    setRequestedQuestionId(null); setRequestedAnnotationId(null); setRequestedTextbookId(textbookId); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", textbookGuideHash(textbookId));
    scrollPageToTop();
  }, [prepareAudioForRoute]);

  const openRosensGuide = useCallback((chapter: string) => {
    prepareAudioForRoute("學習指引");
    setRequestedQuestionId(chapter); setRequestedAnnotationId(null); setRequestedTextbookId("rosens"); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", textbookGuideHash("rosens", chapter));
    scrollPageToTop();
  }, [prepareAudioForRoute]);

  const selectRosensChapter = useCallback((chapter: string) => {
    prepareAudioForRoute("學習指引");
    setRequestedQuestionId(chapter); setRequestedAnnotationId(null); setRequestedTextbookId("rosens"); setRequestedGuideModuleId(null); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", textbookGuideHash("rosens", chapter));
  }, [prepareAudioForRoute]);

  const openAilsGuide = useCallback((page: AilsRouteId = "home") => {
    setRequestedQuestionId(page); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("ails"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", ailsGuideHash(page));
    scrollPageToTop();
  }, []);

  const selectAilsPage = useCallback((page: AilsPageId) => {
    setRequestedQuestionId(page); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("ails"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", ailsGuideHash(page));
  }, []);

  const openBoardGuide = useCallback((unitCode = "1A", nodeId?: string | null, questionId?: string | null, target?: BoardTraceTarget | null) => {
    setRequestedQuestionId(unitCode); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("board"); setRequestedTraceNodeId(nodeId ?? null); setRequestedTraceQuestionId(questionId ?? null); setRequestedTraceTarget(target ?? null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", boardGuideHash(unitCode, nodeId, questionId, target));
    scrollPageToTop();
  }, []);

  const selectBoardUnit = useCallback((unitCode: string) => {
    setRequestedQuestionId(unitCode); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("board"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", boardGuideHash(unitCode));
  }, []);

  const openEmsGuide = useCallback((chapter = "001") => {
    setRequestedQuestionId(chapter); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("ems"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", emsGuideHash(chapter));
    scrollPageToTop();
  }, []);

  const selectEmsChapter = useCallback((chapter: string) => {
    setRequestedQuestionId(chapter); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("ems"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", emsGuideHash(chapter));
  }, []);

  const openGoldfrankGuide = useCallback((chapter = "001") => {
    setRequestedQuestionId(chapter); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("goldfrank"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null); setActiveNav("學習指引"); setMenuOpen(false);
    window.history.pushState(null, "", goldfrankGuideHash(chapter));
    scrollPageToTop();
  }, []);

  const selectGoldfrankChapter = useCallback((chapter: string) => {
    setRequestedQuestionId(chapter); setRequestedAnnotationId(null); setRequestedTextbookId(null); setRequestedGuideModuleId("goldfrank"); setRequestedTraceNodeId(null); setRequestedTraceQuestionId(null); setRequestedTraceTarget(null);
    window.history.replaceState(null, "", goldfrankGuideHash(chapter));
  }, []);

  const latestQuestionReading = useMemo(() => [...progress.progressMap.values()]
    .filter((record) => record.readState === "reading" || record.readState === "later")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null, [progress.progressMap]);
  const latestGuideReading = useMemo(() => [...guideProgress.records]
    .filter((record) => record.lastOpenedAt && (record.readState === "reading" || record.readState === "later"))
    .sort((left, right) => Date.parse(right.lastOpenedAt ?? "") - Date.parse(left.lastOpenedAt ?? ""))[0] ?? null, [guideProgress.records]);
  const latestGuideResourceReading = useMemo(() => [...guideResourceProgress.records]
    .filter((record) => record.lastOpenedAt && (record.readState === "reading" || record.readState === "later"))
    .sort((left, right) => Date.parse(right.lastOpenedAt ?? "") - Date.parse(left.lastOpenedAt ?? ""))[0] ?? null, [guideResourceProgress.records]);
  const continueItem = useMemo(() => {
    if (activePracticeSession && !activePracticeSession.completed) {
      const answered = activePracticeSession.mode === "study"
        ? activePracticeSession.submitted.length
        : activePracticeSession.ids.filter((id) => (activePracticeSession.answers[id]?.length ?? 0) > 0).length;
      const modeLabel = activePracticeSession.mode === "exam" ? "模擬考" : "學習題組";
      return {
        title: `繼續${activePracticeSession.pausedAt ? "暫停的" : "未完成的"}${modeLabel}`,
        detail: `已完成 ${answered} / ${activePracticeSession.ids.length} 題，從第 ${activePracticeSession.cursor + 1} 題接續。`,
        actionLabel: "繼續作答",
        primary: true,
        onOpen: () => navigate("開始作答"),
      };
    }
    const questionTime = Date.parse(latestQuestionReading?.updatedAt ?? "") || 0;
    const legacyGuideTime = Date.parse(latestGuideReading?.lastOpenedAt ?? "") || 0;
    const resourceGuideTime = Date.parse(latestGuideResourceReading?.lastOpenedAt ?? "") || 0;
    if (resourceGuideTime > questionTime && resourceGuideTime >= legacyGuideTime && latestGuideResourceReading) {
      const source = parseAnyGuideAnnotationResourceId(latestGuideResourceReading.resourceId);
      if (source) {
        if (source.resourceKind === "unit") {
          return {
            title: `繼續閱讀考題對照指引單元 ${source.unitCode}`,
            detail: latestGuideResourceReading.readState === "later" ? "已加入稍後閱讀。" : "回到最近開啟的考題對照指引。",
            onOpen: () => openBoardGuide(source.unitCode),
          };
        }
        if (source.resourceKind === "page") {
          return {
            title: `繼續閱讀 AILS・${source.pageId}`,
            detail: latestGuideResourceReading.readState === "later" ? "已加入稍後閱讀" : "回到上次閱讀的 AILS 內容",
            onOpen: () => openAilsGuide(source.pageId as AilsRouteId),
          };
        }
        if (source.textbook === "ems" && source.resourceKind === "chapter") {
          return {
            title: `繼續閱讀 ${LEARNING_SOURCE_REGISTRY.ems.title} · 第 ${source.chapter} 章`,
            detail: latestGuideResourceReading.readState === "later" ? "已加入稍後閱讀。" : "回到最近開啟的 EMS 學習指引。",
            onOpen: () => openEmsGuide(source.chapterId),
          };
        }
        if (source.textbook === "goldfrank" && source.resourceKind === "chapter") {
          return {
            title: `繼續閱讀 ${LEARNING_SOURCE_REGISTRY.goldfrank.title} · Chapter ${source.chapterId}`,
            detail: latestGuideResourceReading.readState === "later" ? "已加入稍後閱讀。" : "回到最近開啟的 Goldfrank 學習指引。",
            onOpen: () => openGoldfrankGuide(source.chapterId),
          };
        }
        const textbookTitle = LEARNING_SOURCE_REGISTRY[source.textbook].title;
        const resource = source.resourceKind === "chapter"
          ? source.textbook === "tintinalli" ? source.chapter : source.chapterId
          : source.resourceKind === "overview" ? "overview" : `section-${source.sectionId}`;
        const label = source.resourceKind === "chapter"
          ? `${textbookTitle} · Chapter ${source.textbook === "tintinalli" ? String(source.chapter).padStart(3, "0") : source.chapterId.startsWith("e") ? `e${Number(source.chapterId.slice(1))}` : source.chapterId}`
          : source.resourceKind === "section"
            ? `${textbookTitle} · Section ${supplementalSectionDisplayId(source.sectionId)} Overview`
            : `${textbookTitle} · Whole-Book Overview`;
        return {
          title: `繼續閱讀 ${label}`,
          detail: latestGuideResourceReading.readState === "later" ? "已加入稍後閱讀。" : "回到最近開啟的學習指引。",
          onOpen: () => source.textbook === "rosens" ? openRosensGuide(String(resource)) : openGuide(resource),
        };
      }
    }
    if (legacyGuideTime > questionTime && latestGuideReading) return {
      title: `繼續閱讀 ${LEARNING_SOURCE_REGISTRY.tintinalli.title} · Chapter ${String(latestGuideReading.chapterId).padStart(3, "0")}`,
      detail: latestGuideReading.readState === "later" ? "已加入稍後閱讀。" : "回到最近開啟的學習指引。",
      onOpen: () => openGuide(latestGuideReading.chapterId),
    };
    if (latestQuestionReading) {
      const question = questions.find((item) => item.id === latestQuestionReading.questionId);
      return {
        title: `繼續閱讀 ${latestQuestionReading.questionId}`,
        detail: question?.title || "回到最近尚未讀完的詳解。",
        onOpen: () => openReader(latestQuestionReading.questionId),
      };
    }
    return null;
  }, [activePracticeSession, latestGuideReading, latestGuideResourceReading, latestQuestionReading, navigate, openAilsGuide, openBoardGuide, openEmsGuide, openGoldfrankGuide, openGuide, openReader, openRosensGuide, questions]);

  const openAnnotation = useCallback((resourceId: string, annotationId: string) => {
    const guideSource = parseAnyGuideAnnotationResourceId(resourceId);
    if (guideSource) {
      if (guideSource.resourceKind === "unit") {
        setRequestedQuestionId(guideSource.unitCode);
        setRequestedAnnotationId(annotationId);
        setRequestedTextbookId(null);
        setRequestedGuideModuleId("board");
        setRequestedTraceNodeId(null);
        setRequestedTraceQuestionId(null);
        setRequestedTraceTarget(null);
        setActiveNav("學習指引");
        setMenuOpen(false);
        window.history.pushState(null, "", boardGuideHash(guideSource.unitCode, null, null, null, annotationId));
        scrollPageToTop();
        return;
      }
      if (guideSource.resourceKind === "page") {
        setRequestedQuestionId(guideSource.pageId);
        setRequestedAnnotationId(annotationId);
        setRequestedTextbookId(null);
        setRequestedGuideModuleId("ails");
        setRequestedTraceNodeId(null);
        setRequestedTraceQuestionId(null);
        setRequestedTraceTarget(null);
        setActiveNav("學習指引");
        setMenuOpen(false);
        window.history.pushState(null, "", ailsGuideHash(guideSource.pageId, annotationId));
        scrollPageToTop();
        return;
      }
      if (guideSource.textbook === "ems" && guideSource.resourceKind === "chapter") {
        setRequestedQuestionId(guideSource.chapterId);
        setRequestedAnnotationId(annotationId);
        setRequestedTextbookId(null);
        setRequestedGuideModuleId("ems");
        setRequestedTraceNodeId(null);
        setRequestedTraceQuestionId(null);
        setRequestedTraceTarget(null);
        setActiveNav("學習指引");
        setMenuOpen(false);
        window.history.pushState(null, "", emsGuideHash(guideSource.chapterId, annotationId));
        scrollPageToTop();
        return;
      }
      if (guideSource.textbook === "goldfrank" && guideSource.resourceKind === "chapter") {
        setRequestedQuestionId(guideSource.chapterId);
        setRequestedAnnotationId(annotationId);
        setRequestedTextbookId(null);
        setRequestedGuideModuleId("goldfrank");
        setRequestedTraceNodeId(null);
        setRequestedTraceQuestionId(null);
        setRequestedTraceTarget(null);
        setActiveNav("學習指引");
        setMenuOpen(false);
        window.history.pushState(null, "", goldfrankGuideHash(guideSource.chapterId, annotationId));
        scrollPageToTop();
        return;
      }
      const guideResource = guideSource.resourceKind === "chapter"
        ? guideSource.textbook === "tintinalli" ? String(guideSource.chapter) : guideSource.chapterId
        : guideSource.resourceKind === "overview" ? "overview" : `section-${guideSource.sectionId}`;
      setRequestedQuestionId(guideResource);
      setRequestedAnnotationId(annotationId);
      setRequestedTextbookId(guideSource.textbook);
      setRequestedGuideModuleId(null);
      setRequestedTraceNodeId(null);
      setRequestedTraceQuestionId(null);
      setRequestedTraceTarget(null);
      setActiveNav("學習指引");
      setMenuOpen(false);
      const href = guideSource.textbook === "tintinalli" && guideSource.resourceKind === "chapter"
        ? guideHash(guideSource.chapter, annotationId)
        : textbookGuideHash(guideSource.textbook, guideResource, annotationId);
      window.history.pushState(null, "", href);
      scrollPageToTop();
      return;
    }
    prepareAudioForRoute("詳解閱讀", resourceId);
    setRequestedQuestionId(resourceId);
    setRequestedAnnotationId(annotationId);
    setRequestedTextbookId(null);
    setRequestedGuideModuleId(null);
    setRequestedTraceNodeId(null);
    setRequestedTraceQuestionId(null);
    setRequestedTraceTarget(null);
    setActiveNav("詳解閱讀");
    setMenuOpen(false);
    window.history.pushState(null, "", readerHash(resourceId, annotationId));
    scrollPageToTop();
  }, [prepareAudioForRoute]);

  const handleAnnotationOpenChange = useCallback((open: boolean) => {
    if (open || !requestedAnnotationId || !requestedQuestionId) return;
    setRequestedAnnotationId(null);
    if (activeNav === "學習指引" && requestedTextbookId) {
      const href = requestedTextbookId === "tintinalli" && /^\d{1,3}$/u.test(requestedQuestionId)
        ? guideHash(Number(requestedQuestionId))
        : textbookGuideHash(requestedTextbookId, requestedQuestionId);
      window.history.replaceState(null, "", href);
      return;
    }
    if (activeNav === "學習指引" && requestedGuideModuleId === "board") {
      window.history.replaceState(null, "", boardGuideHash(requestedQuestionId));
      return;
    }
    if (activeNav === "學習指引" && requestedGuideModuleId === "ails") {
      window.history.replaceState(null, "", ailsGuideHash(requestedQuestionId));
      return;
    }
    if (activeNav === "學習指引" && requestedGuideModuleId === "ems") {
      window.history.replaceState(null, "", emsGuideHash(requestedQuestionId));
      return;
    }
    if (activeNav === "學習指引" && requestedGuideModuleId === "goldfrank") {
      window.history.replaceState(null, "", goldfrankGuideHash(requestedQuestionId));
      return;
    }
    if (activeNav === "詳解閱讀") {
      window.history.replaceState(null, "", readerHash(requestedQuestionId));
    }
  }, [activeNav, requestedAnnotationId, requestedGuideModuleId, requestedQuestionId, requestedTextbookId]);

  const openBrowseCategory = useCallback((category: string, status: BrowsePreset["status"] = "all") => {
    setBrowsePreset({ category, status, nonce: Date.now() });
    setActiveNav("題庫瀏覽");
    setMenuOpen(false);
    window.history.pushState(null, "", "#browse");
    scrollPageToTop();
  }, []);

  const openBrowseSourceSection = useCallback((sourceSection: number) => {
    setBrowsePreset({ sourceSection, status: "all", nonce: Date.now() });
    setActiveNav("題庫瀏覽");
    setMenuOpen(false);
    window.history.pushState(null, "", "#browse");
    scrollPageToTop();
  }, []);

  const openPrepRoute = useCallback((route: PrepRouteId) => {
    const enteringPrep = activeNav !== "備考中心";
    setRequestedQuestionId(route);
    setRequestedAnnotationId(null);
    setRequestedTextbookId(null);
    setRequestedGuideModuleId(null);
    setRequestedTraceNodeId(null);
    setRequestedTraceQuestionId(null);
    setRequestedTraceTarget(null);
    setActiveNav("備考中心");
    setMenuOpen(false);
    window.history.pushState(null, "", prepHash(route));
    if (enteringPrep) scrollPageToTop();
  }, [activeNav]);

  const skipToMain = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById("site-main");
    target?.focus({ preventScroll: true });
    scrollElementIntoView(target, { block: "start" });
  }, []);

  const resetLearningData = useCallback(async (types: ProgressResetType[], questionIds?: string[]) => {
    await progress.resetProgress(types, questionIds);
    const resetActivePractice = types.includes("attempts") && Boolean(progress.accountKey) && (
      !questionIds?.length || activePracticeSession?.ids.some((id) => questionIds.includes(id))
    );
    if (resetActivePractice && progress.accountKey) {
      writeActivePracticeSession(null, progress.accountKey);
      setPracticeEpoch((value) => value + 1);
    }
    if (types.includes("reading") && activeNav === "詳解閱讀") {
      setRequestedQuestionId(null);
      setRequestedAnnotationId(null);
      window.history.replaceState(null, "", "#reader");
      scrollPageToTop();
    }
  }, [activeNav, activePracticeSession?.ids, progress]);

  const openLearningData = useCallback(() => {
    void loadLearningDataDialog().catch(() => undefined);
    setLearningDataOpen(true);
  }, []);

  const requestSpotlight = useCallback(() => {
    setSpotlightLoadFailed(false);
    setSpotlightInitiallyOpen(true);
    void loadGlobalSpotlight().catch(() => undefined);
    void ensureFullQuestionBank().catch(() => {
      setSpotlightInitiallyOpen(false);
      setSpotlightLoadFailed(true);
    });
  }, [ensureFullQuestionBank]);

  useEffect(() => {
    const handleSpotlightShortcut = (event: KeyboardEvent) => {
      if (event.altKey || (!event.metaKey && !event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
      if (document.querySelector<HTMLElement>("[aria-modal='true']")) return;
      event.preventDefault();
      requestSpotlight();
    };
    window.addEventListener("keydown", handleSpotlightShortcut);
    return () => window.removeEventListener("keydown", handleSpotlightShortcut);
  }, [requestSpotlight]);

  const retryFullQuestionIndex = useCallback(() => {
    fullQuestionLoadRef.current = null;
    setFullQuestionIndexError(false);
    void ensureFullQuestionBank().catch(() => undefined);
  }, [ensureFullQuestionBank]);

  useDialogFocus(menuOpen, mobileDrawerRef, () => setMenuOpen(false));

  function resetMenuSwipe() {
    menuSwipeRef.current = null;
    setMenuDragging(false);
    setMenuDragX(0);
  }

  function handleMenuPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.pointerType === "mouse") return;
    menuSwipeTriggeredRef.current = false;
    menuSwipeRef.current = {
      axis: null,
      lastTime: event.timeStamp,
      lastX: event.clientX,
      pointerId: event.pointerId,
      startTime: event.timeStamp,
      startX: event.clientX,
      startY: event.clientY,
      velocityX: 0,
    };
  }

  function handleMenuPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = menuSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.axis) {
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 8) return;
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
      const vertical = Math.abs(deltaY) > Math.abs(deltaX) * 1.15;
      if (!horizontal && !vertical && distance < 18) return;
      gesture.axis = horizontal || (!vertical && Math.abs(deltaX) > Math.abs(deltaY))
        ? "horizontal"
        : "vertical";
      if (gesture.axis === "vertical") return;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setMenuDragging(true);
    }
    if (gesture.axis !== "horizontal") return;
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
    gesture.velocityX = (event.clientX - gesture.lastX) / elapsed;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;
    setMenuDragX(Math.max(0, deltaX));
  }

  function handleMenuPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = menuSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const elapsed = Math.max(1, event.timeStamp - gesture.startTime);
    const fallbackVelocity = deltaX / elapsed;
    const velocity = Math.max(gesture.velocityX, fallbackVelocity);
    const threshold = Math.min(96, event.currentTarget.clientWidth * .25);
    const shouldClose = gesture.axis === "horizontal"
      && (deltaX >= threshold || (deltaX >= 30 && velocity >= .45));
    menuSwipeTriggeredRef.current = gesture.axis === "horizontal";
    resetMenuSwipe();
    if (shouldClose) setMenuOpen(false);
  }

  function handleMenuLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    // A touch that begins on a button or icon first gives that child implicit
    // capture. Moving capture to the drawer emits a bubbling lost-capture event
    // from the child; that is not a cancelled drawer gesture.
    if (event.target !== event.currentTarget) return;
    const gesture = menuSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    handleMenuPointerCancel();
  }

  function handleMenuPointerCancel() {
    menuSwipeTriggeredRef.current = false;
    resetMenuSwipe();
  }

  const activeContextGroup = contextGroups.find((group) => group.items.some((item) => item.name === activeNav)) ?? null;
  const primaryItemIsActive = (item: NavItem) => activeNav === item.name
    || (item.name === "開始作答" && (activeNav === "題庫瀏覽" || activeNav === "詳解閱讀"))
    || (item.name === "學習指引" && (activeNav === "學習音檔" || activeNav === "學習文件" || activeNav === "筆記本"))
    || (item.name === "錯題本" && activeNav === "學習分析");

  if (error) return <main className="loading-page"><div className="loading-mark"><X /></div><p>{error}</p><button className="outline-button" onClick={() => window.location.reload()}>重新載入</button></main>;
  if (!manifest || !questions.length) return <StartupHome />;

  return (
    <div className={`site-shell ${audioPlayer.current ? "audio-player-active" : ""} ${audioPlayer.current && audioPlayer.expanded && !audioPlayer.stowed ? "audio-player-expanded" : ""} ${audioPlayer.current && audioPlayer.expanded && audioPlayer.queueOpen && !audioPlayer.stowed ? "audio-player-queue-open" : ""} ${audioPlayer.current && audioPlayer.stowed ? "audio-player-stowed" : ""}`.trim()}>
      <a className="skip-link" href="#site-main" onClick={skipToMain}>跳至主要內容</a>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("總覽")} aria-label="急專補給站，回到今日總覽"><span className="brand-mark" aria-hidden="true" /><span><strong>急專補給站</strong><small>題庫・指引・音檔</small></span></button>
        <nav className="desktop-nav" aria-label="主要導覽">{primaryNavItems.map((item) => <button key={item.name} className={primaryItemIsActive(item) ? "active" : ""} aria-current={primaryItemIsActive(item) ? "page" : undefined} onPointerDown={() => prepareAudioForRoute(item.name)} onClick={() => navigate(item.name)}>{item.label}</button>)}</nav>
        <div className="topbar-actions">
          {spotlightInitiallyOpen && fullQuestionIndexReady ? (
            <Suspense fallback={<button type="button" className="quiet-button spotlight-trigger" aria-label="全站搜尋載入中"><Search /><span>搜尋</span><kbd>⌘ K</kbd></button>}>
              <GlobalSpotlight initiallyOpen onOpen={() => { void ensureFullQuestionBank().catch(() => undefined); }} questions={questions} annotations={annotations.annotations} onOpenReader={openReader} onOpenAnnotation={openAnnotation} onOpenTintinalli={openGuide} onOpenRosens={openRosensGuide} onOpenGoldfrank={openGoldfrankGuide} onPlayAudio={(source) => { audioPlayer.prepareShell(); audioPlayer.prepare(); audioPlayer.prefetchSource(source); void audioPlayer.play(source); }} onOpenDocument={selectLearningDocument} onNavigate={navigate} onStartQuestions={openPracticeIds} />
            </Suspense>
          ) : <button type="button" className="quiet-button spotlight-trigger" aria-label={spotlightInitiallyOpen ? "全站搜尋資料準備中" : spotlightLoadFailed ? "全站搜尋載入失敗，重試" : "全站搜尋"} aria-busy={spotlightInitiallyOpen || undefined} disabled={spotlightInitiallyOpen} onClick={requestSpotlight}><Search /><span>{spotlightInitiallyOpen ? "準備中" : spotlightLoadFailed ? "重試搜尋" : "搜尋"}</span><kbd>⌘ K</kbd></button>}
          <ThemeToggle />
          <button className="icon-button learning-data-trigger" aria-label="開啟設定" onClick={openLearningData}><Settings2 /></button>
          <button className="icon-button site-menu-trigger" type="button" aria-label="開啟功能總覽" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="mobile-site-navigation" onClick={() => setMenuOpen(true)}><Menu /><span>功能</span></button>
        </div>
      </header>

      {menuOpen && <div className="drawer-backdrop" onClick={() => setMenuOpen(false)}><div
        id="mobile-site-navigation"
        ref={mobileDrawerRef}
        tabIndex={-1}
        className={`mobile-drawer site-drawer drawer-panel ${menuDragging ? "is-swipe-dragging" : ""}`.trim()}
        style={{ "--site-drawer-drag-x": `${menuDragX}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label="功能總覽"
        onPointerDown={handleMenuPointerDown}
        onPointerMove={handleMenuPointerMove}
        onPointerUp={handleMenuPointerEnd}
        onPointerCancel={handleMenuPointerCancel}
        onLostPointerCapture={handleMenuLostPointerCapture}
        onClickCapture={(event) => {
          if (!menuSwipeTriggeredRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          menuSwipeTriggeredRef.current = false;
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="site-drawer-header"><span><small>急專補給站</small><strong>功能總覽</strong></span><button className="icon-button close-menu" autoFocus aria-label="關閉選單" onClick={() => setMenuOpen(false)}><X /></button></header>
        <div className="site-drawer-groups">
          {drawerGroups.map((group) => <section key={group.label} aria-label={group.label}><h2>{group.label}</h2>{group.items.map((item) => { const Icon = item.icon; return <button key={item.name} className={activeNav === item.name ? "active" : ""} aria-current={activeNav === item.name ? "page" : undefined} onPointerDown={() => prepareAudioForRoute(item.name)} onClick={() => navigate(item.name)}><Icon size={18} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={17} /></button>; })}</section>)}
        </div>
        <button className="site-drawer-settings" onClick={() => { setMenuOpen(false); openLearningData(); }}><Settings2 size={18} /><span><strong>閱讀與資料設定</strong><small>詳解版本、顯示與學習紀錄</small></span><ChevronRight size={17} /></button>
      </div></div>}

      {activeContextGroup && <nav className="context-nav" aria-label={`${activeContextGroup.label}頁面`}>
        <span>{activeContextGroup.label}</span>
        <div>{activeContextGroup.items.map((item) => <button type="button" key={item.name} className={activeNav === item.name ? "active" : ""} aria-current={activeNav === item.name ? "page" : undefined} onPointerDown={() => prepareAudioForRoute(item.name)} onClick={() => navigate(item.name)}>{item.label}</button>)}</div>
      </nav>}

      <div id="site-main" className="route-stage" tabIndex={-1}>
      <Suspense fallback={<RouteLoadingShell view={activeNav} />}>
      {fullQuestionIndexViews.has(activeNav) && !fullQuestionIndexReady ? (
        fullQuestionIndexError
          ? <RouteDataError view={activeNav} onRetry={retryFullQuestionIndex} />
          : <RouteLoadingShell view={activeNav} />
      ) : <>
      {activeNav === "總覽" && <DashboardView manifest={manifest} questions={questions} progressMap={progress.progressMap} attempts={progress.attempts} plan={dailyPlan} planSettings={studyPlan.settings} planReady={studyPlan.ready} continueItem={continueItem} onNavigate={navigate} onBrowseCategory={openBrowseCategory} onStartQuestions={openPracticeIds} onUpdatePlanSettings={studyPlan.updateSettings} />}
      {activeNav === "開始作答" && <PracticeView key={`${progress.accountKey ?? "loading"}:${practiceEpoch}`} manifest={manifest} questions={questions} progressMap={progress.progressMap} accountKey={progress.accountKey} explanationPack={explanationPreferences.packId} explanationMode={activeExplanationMode} onAttempt={progress.recordAttempt} onAttempts={progress.recordAttempts} onBookmark={progress.toggleBookmark} onOpenReader={openReader} onOpenGuide={openGuide} onOpenAnalytics={() => navigate("學習分析")} launch={practiceLaunch} plan={dailyPlan} planSettings={studyPlan.settings} planReady={studyPlan.ready} onUpdatePlanSettings={studyPlan.updateSettings} onLaunchConsumed={consumePracticeLaunch} />}
      {activeNav === "題庫瀏覽" && <BrowseView key={browsePreset?.nonce ?? 0} manifest={manifest} questions={questions} progressMap={progress.progressMap} preset={browsePreset} onOpenReader={openReader} onStartQuestions={openPracticeIds} />}
      {activeNav === "詳解閱讀" && <ReaderView manifest={manifest} questions={questions} progressMap={progress.progressMap} requestedQuestionId={requestedQuestionId} requestedAnnotationId={requestedAnnotationId} requestedTraceTarget={requestedTraceTarget} explanationPack={explanationPreferences.packId} explanationMode={activeExplanationMode} rawDraftMode={rawDraftEnabled} annotations={annotations.annotations} annotationStatus={annotations.status} onExplanationSelectionChange={explanationPreferences.setSelection} onBookmark={progress.toggleBookmark} onMarkRead={progress.markRead} onSelectQuestion={selectReaderQuestion} onOpenGuide={openGuide} onOpenBoardTrace={openBoardGuide} onAnnotationOpenChange={handleAnnotationOpenChange} onUpsertAnnotation={annotations.upsert} onRemoveAnnotation={annotations.remove} />}
      {activeNav === "學習指引" && <LearningGuideView questions={questions} requestedTextbookId={requestedTextbookId} requestedGuideModuleId={requestedGuideModuleId} requestedResourceId={requestedQuestionId} requestedTraceNodeId={requestedTraceNodeId} requestedTraceQuestionId={requestedTraceQuestionId} requestedTraceTarget={requestedTraceTarget} requestedAnnotationId={requestedAnnotationId} rawDraftMode={rawDraftEnabled} progressMap={guideProgress.progressMap} progressStatus={guideProgress.status} guideResourceProgressMap={guideResourceProgress.progressMap} guideResourceProgressStatus={guideResourceProgress.status} annotations={annotations.annotations} annotationStatus={annotations.status} onOpenLibrary={openGuideLibrary} onOpenTextbookLibrary={openTextbookGuideLibrary} onOpenTintinalli={openGuide} onSelectTintinalliChapter={selectGuideChapter} onOpenRosens={openRosensGuide} onSelectRosensChapter={selectRosensChapter} onOpenGoldfrank={openGoldfrankGuide} onSelectGoldfrankChapter={selectGoldfrankChapter} onOpenAils={openAilsGuide} onSelectAilsPage={selectAilsPage} onOpenBoard={openBoardGuide} onSelectBoardUnit={selectBoardUnit} onOpenEms={openEmsGuide} onSelectEmsChapter={selectEmsChapter} onOpenReaderTrace={openReaderTrace} onOpenReader={openReader} onStartQuestions={openPracticeIds} onOpenChapter={guideProgress.openChapter} onMarkChapter={guideProgress.markChapter} onBookmarkChapter={guideProgress.bookmarkChapter} onOpenGuideResource={guideResourceProgress.openResource} onMarkGuideResource={guideResourceProgress.markResource} onBookmarkGuideResource={guideResourceProgress.bookmarkResource} onAnnotationOpenChange={handleAnnotationOpenChange} onUpsertAnnotation={annotations.upsert} onRemoveAnnotation={annotations.remove} />}
      {activeNav === "學習音檔" && <AudioLibraryView />}
      {activeNav === "學習文件" && <LearningDocumentsView requestedDocumentId={requestedQuestionId} onSelectDocument={selectLearningDocument} />}
      {activeNav === "錯題本" && <ReviewView questions={questions} progressMap={progress.progressMap} onOpenReader={openReader} onMastery={progress.setMastery} onStartQuestions={openPracticeIds} />}
      {activeNav === "筆記本" && <NotebookView annotations={annotations.annotations} questions={questions} progressMap={progress.progressMap} guideProgressMap={guideProgress.progressMap} guideResourceProgressMap={guideResourceProgress.progressMap} onUpsert={annotations.upsert} onRemove={annotations.remove} onOpenAnnotation={openAnnotation} />}
      {activeNav === "學習分析" && <AnalyticsView manifest={manifest} questions={questions} records={progress.records} attempts={progress.attempts} onBrowseCategory={openBrowseCategory} onBrowseSourceSection={openBrowseSourceSection} onStartQuestions={openPracticeIds} />}
      {activeNav === "備考中心" && <BoardPrepView accountKey={progress.accountKey} routeId={normalizePrepRouteId(requestedQuestionId)} onRouteChange={openPrepRoute} />}
      {activeNav === "休息站" && <RestView />}
      </>}
      </Suspense>
      </div>

      <footer className="site-footer">
        <div className="site-footer-brand"><span className="brand-mark" aria-hidden="true" /><span><strong>急專補給站</strong><small>歷屆題庫、學習指引與音檔，為急診專科考試而整理。</small></span></div>
        <nav aria-label="頁尾導覽">
          <button type="button" onClick={() => navigate("開始作答")}>開始作答</button>
          <button type="button" onClick={() => navigate("學習指引")}>學習內容</button>
          <button type="button" onClick={() => navigate("備考中心")}>備考中心</button>
          <button type="button" onClick={openLearningData}>閱讀與資料設定</button>
          <button type="button" className="site-footer-to-top" onClick={scrollPageToTop}><ArrowUp aria-hidden="true" />回到上方</button>
        </nav>
      </footer>

      {learningDataOpen && <Suspense fallback={null}><LearningDataDialog open manifest={manifest} questions={questions} syncStatus={progress.status} explanationPack={explanationPreferences.packId} explanationMode={activeExplanationMode} rawDraftEnabled={rawDraftEnabled} onExplanationPackChange={explanationPreferences.setPackId} onExplanationModeChange={explanationPreferences.setMode} onRawDraftEnabledChange={updateRawDraftEnabled} onClose={() => setLearningDataOpen(false)} onReset={resetLearningData} /></Suspense>}

      <nav className="mobile-bottom-nav" aria-label="行動版主要導覽">
        {mobileNavItems.map(({ name, label, icon: Icon }) => <button key={name} className={primaryItemIsActive(navItems.find((item) => item.name === name)! ) ? "active" : ""} aria-current={primaryItemIsActive(navItems.find((item) => item.name === name)! ) ? "page" : undefined} onPointerDown={() => prepareAudioForRoute(name)} onClick={() => navigate(name)}><Icon size={19} /><span>{label}</span></button>)}
        <button type="button" className={menuOpen || !mobileNavItems.some((item) => item.name === activeNav) ? "active" : ""} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="mobile-site-navigation" onClick={() => setMenuOpen(true)}><Menu size={19} /><span>更多</span></button>
      </nav>
    </div>
  );
}
