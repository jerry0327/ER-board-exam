"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Clock3, Eraser, FileText, Flag, ListChecks, Pause, Play, RefreshCw, RotateCcw, Trash2, Trophy, X } from "lucide-react";
import QuestionLoading from "../components/question-loading";
import QuestionSheet from "../components/question-sheet";
import SessionEvaluationPanel from "../components/session-evaluation-panel";
import StudyPlanPanel from "../components/study-plan-panel";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { useAnswerSelection } from "../hooks/use-answer-selection";
import { useMinuteClock } from "../hooks/use-minute-clock";
import { buildCanonicalConcepts, dedupeCanonicalQuestionIds, selectCanonicalRepresentative } from "../lib/canonical-concepts";
import { loadQuestion, prefetchQuestion, shuffleStable } from "../lib/question-data";
import { activePracticeSessionKey, mergePracticeSessions, practiceSessionElapsedMs, preparePracticeSessionForEntry, readActivePracticeSession, reconcilePracticeSession, writeActivePracticeSession } from "../lib/practice-session";
import { explanationForMode, type ExplanationMode } from "../lib/explanation-mode";
import { prefetchQuestionExplanation, resolveExplanation, type ExplanationPackId } from "../lib/explanation-packs";
import { evaluateSession, sameAnswer } from "../lib/session-evaluation";
import type { DailyStudyPlan, StudyPlanSettings } from "../lib/study-plan";
import type { AttemptInput, Confidence, FullQuestion, Manifest, PracticeFilters, PracticeSession, ProgressRecord, QuestionIndex } from "../lib/types";

type Props = {
  manifest: Manifest;
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  accountKey: string | null;
  explanationPack: ExplanationPackId;
  explanationMode: ExplanationMode;
  onAttempt: (questionId: string, selectedKeys: string[], correct: boolean | null, confidence: Confidence, mode: "study" | "exam") => Promise<unknown>;
  onAttempts: (attempts: AttemptInput[]) => Promise<unknown>;
  onBookmark: (questionId: string, value: boolean) => Promise<unknown>;
  onOpenReader: (id: string) => void;
  onOpenGuide: (chapter: number) => void;
  onOpenAnalytics?: () => void;
  launch: { ids: string[]; nonce: number; mode?: "study" | "exam" } | null;
  plan?: DailyStudyPlan;
  planSettings?: StudyPlanSettings;
  planReady?: boolean;
  onUpdatePlanSettings?: (value: StudyPlanSettings) => boolean;
  onLaunchConsumed: (nonce: number) => void;
  questionLoader?: (question: QuestionIndex) => Promise<FullQuestion>;
  questionPrefetcher?: (question: QuestionIndex) => void;
  sessionNamespace?: string;
  initialFilters?: Partial<PracticeFilters>;
  canonicalizeSelection?: boolean;
  showStudyPlan?: boolean;
  showExamFilter?: boolean;
  headerActions?: ReactNode;
  copy?: Partial<{
    eyebrow: string;
    title: string;
    description: string;
    categoryLabel: string;
    allCategoriesLabel: string;
  }>;
};

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

function interleaveCategories(items: QuestionIndex[]) {
  const buckets = new Map<string, QuestionIndex[]>();
  for (const question of shuffleStable(items)) {
    const bucket = buckets.get(question.category) ?? [];
    bucket.push(question);
    buckets.set(question.category, bucket);
  }
  const order = shuffleStable([...buckets.keys()]);
  const result: QuestionIndex[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const category of order) {
      const next = buckets.get(category)?.shift();
      if (!next) continue;
      result.push(next);
      remaining = true;
    }
  }
  return result;
}

function examSubmissionPrefix(session: PracticeSession) {
  const seed = `${session.startedAt}|${session.ids.join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const started = Date.parse(session.startedAt);
  return `exam_${Number.isFinite(started) ? started.toString(36) : "legacy"}_${(hash >>> 0).toString(36)}`;
}

const defaultPracticeCopy = {
  eyebrow: "開始作答",
  title: "建立一輪練習",
  description: "混合練習不會重複抽到相同題幹；選定單一試卷時保留全部題目。",
  categoryLabel: "急診領域",
  allCategoriesLabel: "全部領域",
};

export default function PracticeView({
  manifest,
  questions,
  progressMap,
  accountKey,
  explanationPack,
  explanationMode,
  onAttempt,
  onAttempts,
  onBookmark,
  onOpenReader,
  onOpenGuide,
  onOpenAnalytics,
  launch,
  plan,
  planSettings,
  planReady = false,
  onUpdatePlanSettings,
  onLaunchConsumed,
  questionLoader = loadQuestion,
  questionPrefetcher = prefetchQuestion,
  sessionNamespace = "board",
  initialFilters,
  canonicalizeSelection = true,
  showStudyPlan = true,
  showExamFilter = manifest.groups.length > 1,
  headerActions,
  copy: copyOverrides,
}: Props) {
  const copy = { ...defaultPracticeCopy, ...copyOverrides };
  const [filters, setFilters] = useState<PracticeFilters>(() => ({
    mode: "study",
    count: 10,
    exam: "all",
    category: "all",
    source: "all",
    order: "random",
    timerEnabled: true,
    ...initialFilters,
  }));
  const [session, setSession] = useState<PracticeSession | null>(null);
  const sessionRef = useRef<PracticeSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [loadedQuestion, setLoadedQuestion] = useState<FullQuestion | null>(null);
  const [loadedExplanation, setLoadedExplanation] = useState<{ key: string; markdown: string; fallback: boolean } | null>(null);
  const [questionLoadError, setQuestionLoadError] = useState<{ id: string; message: string } | null>(null);
  const [loadRetry, setLoadRetry] = useState(0);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const syncRunRef = useRef(0);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const decisionDialogRef = useRef<HTMLElement>(null);
  const launchNonceRef = useRef<number | null>(null);
  const skipPersistRef = useRef(false);
  const [examSyncStatus, setExamSyncStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [navigatorOpen, setNavigatorOpen] = useState(true);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [resolvedLaunchNonce, setResolvedLaunchNonce] = useState<number | null>(null);
  const dueNow = useMinuteClock();
  const indexMap = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const validPracticeIds = useMemo(() => new Set(questions.filter((question) => !question.excludedFromPractice).map((question) => question.id)), [questions]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!accountKey) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      const restored = preparePracticeSessionForEntry(
        readActivePracticeSession(accountKey, sessionNamespace),
        validPracticeIds,
      );
      setNavigatorOpen(restored?.mode !== "exam" || restored.ids.length <= 20);
      setSession(restored);
      setSessionReady(true);
    });
    return () => { active = false; };
  }, [accountKey, sessionNamespace, validPracticeIds]);
  useEffect(() => {
    if (!sessionReady || !accountKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    writeActivePracticeSession(session, accountKey, sessionNamespace);
  }, [accountKey, session, sessionNamespace, sessionReady]);
  useEffect(() => {
    if (!accountKey) return;
    const key = activePracticeSessionKey(accountKey, sessionNamespace);
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      Promise.resolve().then(() => {
        const incoming = reconcilePracticeSession(readActivePracticeSession(accountKey, sessionNamespace), validPracticeIds);
        const previous = sessionRef.current;
        const merged = mergePracticeSessions(previous, incoming);
        sessionRef.current = merged;
        skipPersistRef.current = merged !== previous;
        if (merged !== incoming) writeActivePracticeSession(merged, accountKey, sessionNamespace);
        setSession(merged);
        setNotice(merged ? "已顯示另一個分頁的作答進度。" : "這份題組已在另一個分頁結束。");
      });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [accountKey, sessionNamespace, validPracticeIds]);
  useEffect(() => {
    if (!session?.timerEnabled || session.completed || session.pausedAt) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.completed, session?.pausedAt, session?.timerEnabled]);
  useEffect(() => {
    if (!session?.completed) return;
    const frame = requestAnimationFrame(() => resultHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [session?.completed]);
  const canonicalConcepts = useMemo(
    () => buildCanonicalConcepts(questions.filter((question) => !question.excludedFromPractice && !question.allCredit), progressMap, dueNow),
    [dueNow, progressMap, questions],
  );
  const conceptByQuestion = useMemo(() => {
    const result = new Map<string, typeof canonicalConcepts[number]>();
    for (const concept of canonicalConcepts) {
      for (const question of concept.members) result.set(question.id, concept);
    }
    return result;
  }, [canonicalConcepts]);
  const pendingWrongCount = useMemo(
    () => canonicalConcepts.filter((concept) => concept.progress.pending).length,
    [canonicalConcepts],
  );
  const selectedGroup = manifest.groups.find((group) => group.id === filters.exam);
  const selectedPaperCount = selectedGroup
    ? questions.filter((question) => question.exam === selectedGroup.id && !question.excludedFromPractice).length
    : 0;
  const currentId = session?.ids[session.cursor];
  const currentConcept = currentId ? conceptByQuestion.get(currentId) : undefined;
  const currentIndex = currentId ? indexMap.get(currentId) : undefined;
  const nextId = session?.ids[(session?.cursor ?? 0) + 1];
  const current = loadedQuestion?.id === currentId ? loadedQuestion : null;
  const updateAnswer = useAnswerSelection(current, setSession);
  const explanationKey = currentId ? `${currentId}:${explanationPack}` : "";
  const currentExplanation = loadedExplanation?.key === explanationKey ? loadedExplanation : null;
  const flaggedSet = useMemo(() => new Set(session?.flaggedIds ?? []), [session?.flaggedIds]);
  const unansweredIds = useMemo(() => session?.ids.filter((id) => {
    const question = indexMap.get(id);
    return !question?.allCredit && !(session.answers[id]?.length);
  }) ?? [], [indexMap, session]);
  const answeredCount = (session?.ids.length ?? 0) - unansweredIds.length;
  const completedCount = session?.mode === "study" ? session.submitted.length : answeredCount;
  const elapsedLabel = session?.timerEnabled ? formatElapsed(practiceSessionElapsedMs(session, clockNow)) : "";
  const launchConflictOpen = Boolean(launch && resolvedLaunchNonce !== launch.nonce && session && !session.completed);
  const dialogOpen = launchConflictOpen || endDialogOpen;
  useEffect(() => {
    if (!currentIndex) return;
    let active = true;
    questionLoader(currentIndex)
      .then((question) => {
        if (!active) return;
        setLoadedQuestion(question);
        setQuestionLoadError((error) => error?.id === question.id ? null : error);
        if (session?.mode !== "study") return;
        void resolveExplanation(question, explanationPack).then((explanation) => {
          if (active) setLoadedExplanation({ key: `${question.id}:${explanationPack}`, markdown: explanation.markdown, fallback: explanation.fallback });
        });
      })
      .catch(() => {
        if (active) setQuestionLoadError({ id: currentIndex.id, message: "這題的完整內容暫時無法載入，請檢查連線後再試。" });
      });
    const next = nextId ? indexMap.get(nextId) : undefined;
    if (next) {
      questionLoader(next).catch(() => undefined);
      if (session?.mode === "study") prefetchQuestionExplanation(next, explanationPack);
    }
    return () => { active = false; };
  }, [currentIndex, explanationPack, indexMap, loadRetry, nextId, questionLoader, session?.mode]);

  useEffect(() => {
    if (!current || dialogOpen) return;
    const frame = requestAnimationFrame(() => document.getElementById(`question-heading-${current.id}`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [current, dialogOpen]);

  const startSession = (override: Partial<PracticeFilters> = {}, fullPaper = false) => {
    const activeFilters: PracticeFilters = { ...filters, ...override };
    const now = new Date().toISOString();
    let candidates: QuestionIndex[];
    if (fullPaper) {
      if (activeFilters.exam === "all") {
        setNotice("請先選擇單一年度／卷別，再開始整份試卷模擬考。");
        return;
      }
      candidates = questions
        .filter((question) => !question.excludedFromPractice)
        .filter((question) => question.exam === activeFilters.exam)
        .sort((left, right) => left.number - right.number);
    } else {
      candidates = canonicalConcepts.flatMap((concept) => {
        const matchingMembers = concept.members.filter((question) => (
          (activeFilters.exam === "all" || question.exam === activeFilters.exam)
          && (activeFilters.category === "all" || question.category === activeFilters.category)
        ));
        if (!matchingMembers.length) return [];
        if (activeFilters.source === "new" && concept.progress.attempts > 0) return [];
        if (activeFilters.source === "wrong" && !concept.progress.pending) return [];
        if (activeFilters.source === "due" && !concept.progress.due) return [];
        if (activeFilters.source === "bookmarked" && !concept.progress.bookmarked) return [];
        const bookmarkedMembers = activeFilters.source === "bookmarked"
          ? matchingMembers.filter((question) => progressMap.get(question.id)?.bookmarked === 1)
          : [];
        const representative = selectCanonicalRepresentative(bookmarkedMembers.length ? bookmarkedMembers : matchingMembers, progressMap);
        return representative ? [representative] : [];
      });
      if (activeFilters.order === "random") {
        candidates = activeFilters.category === "all" ? interleaveCategories(candidates) : shuffleStable(candidates);
      }
    }
    if (!candidates.length) {
      setNotice("這組條件目前沒有可作答的題目，請放寬年度、主題或學習狀態。");
      return;
    }
    const ids = fullPaper
      ? candidates.map((question) => question.id)
      : candidates.slice(0, Math.min(activeFilters.count, candidates.length)).map((question) => question.id);
    const next: PracticeSession = {
      schemaVersion: 2,
      ids,
      cursor: 0,
      mode: fullPaper ? "exam" : activeFilters.mode,
      answers: {},
      confidence: {},
      eliminatedOptions: {},
      scratchpads: {},
      submitted: [],
      flaggedIds: [],
      timerEnabled: (fullPaper || activeFilters.mode === "exam") && activeFilters.timerEnabled,
      completed: false,
      startedAt: now,
    };
    syncRunRef.current += 1;
    submittingRef.current = false;
    setExamSyncStatus("idle");
    setNotice("");
    setClockNow(Date.now());
    setNavigatorOpen(ids.length <= 20);
    if (candidates[0]) questionPrefetcher(candidates[0]);
    setSession(next);
  };

  const startSpecificSession = useCallback((ids: string[], mode: "study" | "exam" = "study") => {
    const availableIds = ids.filter((id) => indexMap.has(id));
    const validIds = canonicalizeSelection
      ? dedupeCanonicalQuestionIds(availableIds, indexMap, { progressMap })
      : [...new Set(availableIds)];
    if (!validIds.length) return;
    const next: PracticeSession = {
      schemaVersion: 2,
      ids: validIds,
      cursor: 0,
      mode,
      answers: {},
      confidence: {},
      eliminatedOptions: {},
      scratchpads: {},
      submitted: [],
      flaggedIds: [],
      timerEnabled: mode === "exam",
      completed: false,
      startedAt: new Date().toISOString(),
    };
    syncRunRef.current += 1;
    submittingRef.current = false;
    setExamSyncStatus("idle");
    setExpandedQuestionId(null);
    setNotice("");
    setClockNow(Date.now());
    const first = indexMap.get(validIds[0]);
    if (first) questionPrefetcher(first);
    setSession(next);
  }, [canonicalizeSelection, indexMap, progressMap, questionPrefetcher]);

  useEffect(() => {
    if (!sessionReady || !launch || launchNonceRef.current === launch.nonce || resolvedLaunchNonce === launch.nonce) return;
    if (session && !session.completed) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      launchNonceRef.current = launch.nonce;
      setResolvedLaunchNonce(launch.nonce);
      startSpecificSession(launch.ids, launch.mode ?? "study");
      onLaunchConsumed(launch.nonce);
    });
    return () => { active = false; };
  }, [launch, onLaunchConsumed, resolvedLaunchNonce, session, sessionReady, startSpecificSession]);

  const resolvePendingLaunch = (replace: boolean) => {
    if (!launch) return;
    setEndDialogOpen(false);
    launchNonceRef.current = launch.nonce;
    setResolvedLaunchNonce(launch.nonce);
    if (replace) startSpecificSession(launch.ids, launch.mode ?? "study");
    else if (session?.pausedAt) {
      const resumedAt = Date.now();
      setSession({
        ...session,
        pausedAt: undefined,
        accumulatedPausedMs: (session.accumulatedPausedMs ?? 0) + Math.max(0, resumedAt - Date.parse(session.pausedAt)),
      });
    }
    onLaunchConsumed(launch.nonce);
  };

  const updateConfidence = (confidence: Confidence) => {
    if (!session || !current) return;
    setSession({ ...session, confidence: { ...session.confidence, [current.id]: confidence } });
  };

  const toggleEliminatedOption = (key: string) => {
    if (!currentId) return;
    setSession((currentSession) => {
      if (!currentSession || currentSession.completed || currentSession.ids[currentSession.cursor] !== currentId) return currentSession;
      if (currentSession.mode === "study" && currentSession.submitted.includes(currentId)) return currentSession;
      const existing = currentSession.eliminatedOptions[currentId] ?? [];
      const eliminatedOptions = existing.includes(key)
        ? existing.filter((value) => value !== key)
        : [...existing, key];
      return {
        ...currentSession,
        eliminatedOptions: { ...currentSession.eliminatedOptions, [currentId]: eliminatedOptions },
      };
    });
  };

  const updateScratchpad = (value: string) => {
    if (!currentId) return;
    const draft = value.slice(0, 4000);
    setSession((currentSession) => currentSession && currentSession.ids.includes(currentId)
      ? { ...currentSession, scratchpads: { ...currentSession.scratchpads, [currentId]: draft } }
      : currentSession);
  };

  const submitStudyAnswer = () => {
    if (!session || !current || submittingRef.current || session.submitted.includes(current.id)) return;
    const selected = session.answers[current.id] ?? [];
    const confidence = session.confidence[current.id] ?? "normal";
    const correct = current.allCredit ? null : sameAnswer(selected, current.answerKeys);
    submittingRef.current = true;
    setSubmitting(true);
    let syncOperation: Promise<unknown>;
    try {
      syncOperation = onAttempt(current.id, selected, correct, confidence, "study");
    } catch {
      submittingRef.current = false;
      setSubmitting(false);
      setNotice("目前無法儲存這題，請再試一次。");
      return;
    }
    const nextSession = { ...session, submitted: [...new Set([...session.submitted, current.id])] };
    if (accountKey) writeActivePracticeSession(nextSession, accountKey, sessionNamespace);
    setSession(nextSession);
    queueMicrotask(() => {
      submittingRef.current = false;
      setSubmitting(false);
    });
    void syncOperation.catch(() => setNotice("目前無法儲存答案，請稍後再試。"));
  };

  const finishExam = () => {
    if (!session || submittingRef.current || session.completed) return;
    if (session.mode === "exam" && !session.reviewing) {
      setSession({ ...session, reviewing: true });
      return;
    }
    const completedSession = session;
    submittingRef.current = true;
    const entries = completedSession.ids
      .map((id) => indexMap.get(id))
      .filter((question): question is QuestionIndex => Boolean(question));
    const submissionPrefix = examSubmissionPrefix(completedSession);
    const attempts: AttemptInput[] = entries.map((question, index) => {
      const selected = completedSession.answers[question.id] ?? [];
      return {
        mutationId: `${submissionPrefix}_${index}`,
        questionId: question.id,
        selectedKeys: selected,
        correct: question.allCredit ? null : sameAnswer(selected, question.answerKeys),
        confidence: completedSession.confidence[question.id] ?? "normal",
        mode: "exam",
      };
    });
    const syncRun = ++syncRunRef.current;
    const finishedSession: PracticeSession = {
      ...completedSession,
      reviewing: false,
      completed: true,
      completedAt: new Date().toISOString(),
      submitted: [...completedSession.ids],
    };

    // recordAttempts synchronously persists the whole exam with stable
    // mutation ids before its returned promise begins draining the outbox.
    let syncOperation: Promise<unknown>;
    try {
      // recordAttempts queues the whole batch synchronously before returning;
      // a storage failure keeps the exam in review instead of falsely marking
      // it completed.
      syncOperation = onAttempts(attempts);
    } catch {
      submittingRef.current = false;
      setSubmitting(false);
      setExamSyncStatus("error");
      setNotice("目前無法交卷，請再試一次。");
      return;
    }
    // Persist completion in the same event before painting the result. A
    // reload cannot restore an unfinished session and enqueue a second batch.
    if (accountKey) writeActivePracticeSession(finishedSession, accountKey, sessionNamespace);
    setSession(finishedSession);
    setExamSyncStatus("syncing");
    setSubmitting(false);
    void syncOperation
      .then(() => { if (syncRunRef.current === syncRun) setExamSyncStatus("done"); })
      .catch(() => { if (syncRunRef.current === syncRun) setExamSyncStatus("error"); });
  };

  const openExamReview = () => {
    if (!session || session.mode !== "exam" || session.completed) return;
    setSession({ ...session, reviewing: true });
  };

  const jumpToQuestion = (id: string) => {
    if (!session) return;
    const cursor = session.ids.indexOf(id);
    if (cursor < 0) return;
    const question = indexMap.get(id);
    if (question) questionPrefetcher(question);
    setSession({ ...session, cursor, reviewing: false });
  };

  const toggleCurrentFlag = () => {
    if (!session || !currentId) return;
    const flaggedIds = flaggedSet.has(currentId)
      ? session.flaggedIds.filter((id) => id !== currentId)
      : [...session.flaggedIds, currentId];
    setSession({ ...session, flaggedIds });
  };

  const toggleConceptBookmark = () => {
    if (!currentId) return;
    const bookmarked = currentConcept?.progress.bookmarked ?? (progressMap.get(currentId)?.bookmarked === 1);
    const targets = bookmarked
      ? (currentConcept?.members ?? []).filter((question) => progressMap.get(question.id)?.bookmarked === 1)
      : [indexMap.get(currentId)].filter((question): question is QuestionIndex => Boolean(question));
    void Promise.all(targets.map((question) => onBookmark(question.id, !bookmarked)));
  };

  const pauseSession = () => {
    if (!session || session.completed || session.pausedAt) return;
    setEndDialogOpen(false);
    setSession({ ...session, pausedAt: new Date().toISOString(), reviewing: false });
  };

  const resumeSession = () => {
    if (!session?.pausedAt) return;
    const pausedAt = Date.parse(session.pausedAt);
    setClockNow(Date.now());
    setSession({
      ...session,
      pausedAt: undefined,
      accumulatedPausedMs: (session.accumulatedPausedMs ?? 0) + (Number.isFinite(pausedAt) ? Math.max(0, Date.now() - pausedAt) : 0),
    });
  };

  const discardSession = () => {
    syncRunRef.current += 1;
    submittingRef.current = false;
    setExamSyncStatus("idle");
    if (accountKey && !writeActivePracticeSession(null, accountKey, sessionNamespace)) {
      setNotice("目前無法捨棄本輪；內容仍保留，請稍後再試。");
      return;
    }
    setEndDialogOpen(false);
    setSession(null);
  };

  useDialogFocus(dialogOpen, decisionDialogRef, () => {
    if (launchConflictOpen) resolvePendingLaunch(false);
    else setEndDialogOpen(false);
  });

  const advance = () => {
    if (!session) return;
    if (session.cursor < session.ids.length - 1) setSession({ ...session, cursor: session.cursor + 1 });
    else if (session.mode === "exam") openExamReview();
    else setSession({ ...session, completed: true, completedAt: new Date().toISOString() });
  };

  useEffect(() => {
    if (!session || !current || session.completed || dialogOpen) return;
    const keyHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      const key = event.key.toUpperCase();
      const optionShortcut = current.options.some((option) => option.key === key);
      const answerLocked = session.mode === "study" && session.submitted.includes(current.id);
      if (optionShortcut && !answerLocked && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.shiftKey) {
          event.preventDefault();
          if (!event.repeat) toggleEliminatedOption(key);
        } else {
          if (!event.repeat) updateAnswer(key);
        }
      }
      if (event.key === "ArrowRight" && (session.submitted.includes(current.id) || (session.mode === "exam" && (session.answers[current.id]?.length ?? 0) > 0))) advance();
      if (event.key === "ArrowLeft" && session.cursor > 0) setSession({ ...session, cursor: session.cursor - 1 });
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  });

  const sessionDialogs = <>
    {launchConflictOpen && launch && session && !session.completed && (
      <div className="practice-dialog-backdrop" role="presentation">
        <section ref={decisionDialogRef} tabIndex={-1} className="practice-decision-dialog overlay-panel" role="dialog" aria-modal="true" aria-labelledby="launch-conflict-title">
          <div className="practice-dialog-icon"><ListChecks size={23} /></div>
          <div>
            <p className="eyebrow"><span />已有未完成進度</p>
            <h2 id="launch-conflict-title">要繼續目前這輪嗎？</h2>
            <p>新的練習清單共有 {launch.ids.length.toLocaleString("zh-TW")} 題。替換後，目前尚未完成的本輪會被捨棄。</p>
          </div>
          <div className="practice-dialog-actions">
            <button className="outline-button" autoFocus onClick={() => resolvePendingLaunch(false)}><Play size={17} />繼續目前本輪</button>
            <button className="danger-button" onClick={() => resolvePendingLaunch(true)}>捨棄並開始新題組</button>
          </div>
        </section>
      </div>
    )}
    {endDialogOpen && !launchConflictOpen && session && !session.completed && (
      <div className="practice-dialog-backdrop" role="presentation" onClick={() => setEndDialogOpen(false)}>
        <section ref={decisionDialogRef} tabIndex={-1} className="practice-decision-dialog overlay-panel" role="dialog" aria-modal="true" aria-labelledby="end-session-title" onClick={(event) => event.stopPropagation()}>
          <button className="practice-dialog-close" aria-label="取消並關閉" onClick={() => setEndDialogOpen(false)}><X size={18} /></button>
          <div className="practice-dialog-icon"><Pause size={23} /></div>
          <div>
            <p className="eyebrow"><span />本輪作答</p>
            <h2 id="end-session-title">{session.pausedAt ? "確定捨棄這一輪？" : "要暫停還是捨棄本輪？"}</h2>
            <p>{session.pausedAt ? "捨棄後會刪除這輪進度。" : "暫停後可從目前位置繼續；捨棄會刪除這輪進度。"}</p>
            {notice && <p className="form-notice" role="alert">{notice}</p>}
          </div>
          <div className="practice-dialog-actions">
            {!session.pausedAt && <button className="primary-button" autoFocus onClick={pauseSession}><Pause size={17} />暫停</button>}
            <button className="danger-button" autoFocus={Boolean(session.pausedAt)} onClick={discardSession}>捨棄本輪</button>
            <button className="text-action" onClick={() => setEndDialogOpen(false)}>取消</button>
          </div>
        </section>
      </div>
    )}
  </>;

  if (!sessionReady) return <main className="workspace-page"><QuestionLoading label="正在恢復上一輪進度…" /></main>;

  if (!session) {
    return (
      <main className="workspace-page practice-setup-page">
        <header className="page-intro">
          <p className="eyebrow"><span />{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          {headerActions}
        </header>
        {showStudyPlan && plan && planSettings && onUpdatePlanSettings && <StudyPlanPanel compact plan={plan} settings={planSettings} ready={planReady} onStartQuestions={startSpecificSession} onUpdateSettings={onUpdatePlanSettings} />}
        <section className="practice-quick-start" aria-labelledby="practice-quick-heading">
          <div className="practice-quick-heading">
            <div><h2 id="practice-quick-heading">三種常用練習</h2><p>直接開始隨機學習、錯題複習或快速模擬考。</p></div>
          </div>
          <div className="practice-quick-grid quick-start">
            <button className="practice-quick-card" onClick={() => startSession({ mode: "study", count: 10, exam: "all", category: "all", source: "all", order: "random" })}>
              <span>10</span><div><h3>隨機學習</h3><p>交錯抽取主要領域，提交後看詳解。</p></div><CheckCircle2 size={21} />
            </button>
            <button
              className="practice-quick-card"
              disabled={pendingWrongCount === 0}
              aria-describedby={pendingWrongCount === 0 ? "practice-wrong-empty" : undefined}
              onClick={() => startSession({ mode: "study", count: 20, exam: "all", category: "all", source: "wrong", order: "random" })}
            >
              <span>20</span><div><h3>錯題複習</h3><p>從 {pendingWrongCount.toLocaleString("zh-TW")} 個待釐清觀念抽取。</p></div><RotateCcw size={21} />
            </button>
            <button className="practice-quick-card" onClick={() => startSession({ mode: "exam", count: 50, exam: "all", category: "all", source: "all", order: "random" })}>
              <span>50</span><div><h3>快速模擬考</h3><p>完成整輪後公布答案與成績。</p></div><Clock3 size={21} />
            </button>
          </div>
          {pendingWrongCount === 0 && <p id="practice-wrong-empty" className="form-notice" role="status">目前沒有待釐清錯題；答錯的題目之後會自動收進這裡。</p>}
        </section>
        <details className="practice-custom-settings setup-grid">
          <summary className="outline-button">
            <strong>自訂練習設定</strong>
            <span>調整題數、卷別、領域、狀態與順序</span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <section aria-label="自訂練習設定">
            <div className="setup-panel paper-card">
              <div className="setup-section">
                <h2>作答方式</h2>
                <div className="mode-cards">
                  <button aria-pressed={filters.mode === "study"} className={filters.mode === "study" ? "active" : ""} onClick={() => setFilters({ ...filters, mode: "study" })}><CheckCircle2 /><span><strong>學習模式</strong><small>每題提交後立即看答案與核心理由</small></span></button>
                  <button aria-pressed={filters.mode === "exam"} className={filters.mode === "exam" ? "active" : ""} onClick={() => setFilters({ ...filters, mode: "exam" })}><Clock3 /><span><strong>模擬考模式</strong><small>完成整輪後才揭曉答案與成績</small></span></button>
                </div>
              </div>
              <div className="filter-form-grid">
                <label>題數<select value={filters.count} onChange={(event) => setFilters({ ...filters, count: Number(event.target.value) })}><option value={10}>10 題</option><option value={20}>20 題</option><option value={50}>50 題</option><option value={100}>100 題</option></select></label>
                {showExamFilter && <label>年度／卷別<select value={filters.exam} onChange={(event) => setFilters({ ...filters, exam: event.target.value })}><option value="all">全部年度</option>{manifest.groups.map((group) => <option key={group.id} value={group.id}>{group.label}（{group.count}）</option>)}</select></label>}
                <label>{copy.categoryLabel}<select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="all">{copy.allCategoriesLabel}</option>{manifest.categories.map((category) => <option key={category.id} value={category.id}>{category.id}（{category.count}）</option>)}</select></label>
                <label>學習狀態<select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value as PracticeFilters["source"] })}><option value="all">全部可用題目</option><option value="new">尚未作答</option><option value="wrong">待釐清錯題</option><option value="due">今日到期</option><option value="bookmarked">我的收藏</option></select></label>
                <label>題目順序<select value={filters.order} onChange={(event) => setFilters({ ...filters, order: event.target.value as PracticeFilters["order"] })}><option value="random">固定隨機順序</option><option value="sequential">依題號順序</option></select></label>
                <label className="timer-setting">
                  <input type="checkbox" checked={filters.timerEnabled} onChange={(event) => setFilters({ ...filters, timerEnabled: event.target.checked })} />
                  <span><strong>模擬考顯示作答時間</strong><small>使用開始與暫停時間計算；不設定倒數壓力。</small></span>
                </label>
              </div>
              {showExamFilter && selectedGroup && (
                <div className="full-paper-callout">
                  <div className="full-paper-copy">
                    <strong>{selectedGroup.label}・整份試卷模擬考</strong>
                    <span>依原題號完成全 {selectedPaperCount.toLocaleString("zh-TW")} 題。</span>
                  </div>
                  <button className="outline-button full-paper-button" onClick={() => startSession({ exam: selectedGroup.id }, true)}>開始整份試卷<Trophy size={18} /></button>
                </div>
              )}
              {notice && <p className="form-notice" role="status">{notice}</p>}
              <button className="primary-button start-session" onClick={() => startSession()}>開始這一輪<ArrowRight size={18} /></button>
            </div>
          </section>
        </details>
      </main>
    );
  }

  if (session.pausedAt && !session.completed) {
    return (
      <main className="workspace-page paused-session-page">
        <section className="paused-session-card paper-card">
          <div className="paused-session-icon"><Pause size={30} /></div>
          <p className="eyebrow"><span />作答進度</p>
          <h1>本輪已暫停</h1>
          <p>{session.mode === "exam" ? "模擬考" : "學習模式"}・已完成 {completedCount} / {session.ids.length} 題{session.timerEnabled ? `・作答時間 ${elapsedLabel}` : ""}</p>
          <div className="paused-session-progress" role="progressbar" aria-label="已完成題數" aria-valuemin={0} aria-valuemax={session.ids.length} aria-valuenow={completedCount}><i style={{ width: `${session.ids.length ? completedCount / session.ids.length * 100 : 0}%` }} /></div>
          <div className="paused-session-actions">
            <button className="primary-button" onClick={resumeSession}><Play size={18} />從第 {session.cursor + 1} 題繼續</button>
            <button className="outline-button" onClick={() => setEndDialogOpen(true)}>捨棄這一輪</button>
          </div>
          {notice && <p className="form-notice" role="status">{notice}</p>}
        </section>
        {sessionDialogs}
      </main>
    );
  }

  if (session.completed) {
    const scored = session.ids.map((id) => indexMap.get(id)).filter((question): question is QuestionIndex => Boolean(question) && !question!.allCredit);
    const correctCount = scored.filter((question) => sameAnswer(session.answers[question.id] ?? [], question.answerKeys)).length;
    const percent = scored.length ? Math.round(correctCount / scored.length * 100) : 0;
    const evaluation = evaluateSession({
      questions: session.ids.map((id) => indexMap.get(id)).filter((question): question is QuestionIndex => Boolean(question)),
      answers: session.answers,
      confidence: session.confidence,
      mode: session.mode,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      accumulatedPausedMs: session.accumulatedPausedMs,
    });
    const firstReviewId = evaluation.wrongIds[0] ?? session.ids[0];
    return (
      <main className="workspace-page result-page">
        <section className="result-card paper-card">
          <Trophy size={42} />
          <p>本輪完成</p>
          <h1
            ref={resultHeadingRef}
            tabIndex={-1}
            aria-label={`本輪成績：答對 ${correctCount} 題，共 ${scored.length} 題，正確率 ${percent}%`}
          >
            {correctCount}<span> / {scored.length}</span>
          </h1>
          <strong>{percent}%</strong>
          {session.mode === "exam" && examSyncStatus === "error" && <p className="result-sync-status error" role="status">部分作答紀錄尚未更新。</p>}
          <div className="result-actions"><button className="primary-button" onClick={() => { syncRunRef.current += 1; submittingRef.current = false; setExamSyncStatus("idle"); if (accountKey) writeActivePracticeSession(null, accountKey, sessionNamespace); setSession(null); }}>建立下一輪<RotateCcw size={18} /></button><button className="outline-button" onClick={() => onOpenReader(firstReviewId)}>{evaluation.wrongIds.length ? "閱讀錯題詳解" : "閱讀本輪詳解"}<ArrowRight size={18} /></button></div>
        </section>
        <section className="result-review paper-card">
          <header><div><p className="eyebrow"><span />本輪明細</p><h2>逐題回看答案與詳解</h2></div><small>全部給分題不列入正確率</small></header>
          <div className="result-review-list">
            {session.ids.map((id, position) => {
              const question = indexMap.get(id);
              if (!question) return null;
              const isCorrect = question.allCredit ? null : sameAnswer(session.answers[id] ?? [], question.answerKeys);
              return <button key={id} onClick={() => onOpenReader(id)}><span>{String(position + 1).padStart(2, "0")}</span><div><strong>{id}・{question.title}</strong><small>你的答案：{(session.answers[id] ?? []).join("、") || "—"}　官方答案：{question.answerKeys.join("、") || "全部給分"}</small></div><i className={isCorrect === null ? "neutral" : isCorrect ? "correct" : "wrong"}>{isCorrect === null ? "給分" : isCorrect ? "答對" : "答錯"}</i><ArrowRight size={17} /></button>;
            })}
          </div>
        </section>
        {onOpenAnalytics && <SessionEvaluationPanel
          evaluation={evaluation}
          mode={session.mode}
          onRetryWrong={() => startSpecificSession(evaluation.wrongIds)}
          onPracticeTopic={(category) => startSession({ mode: "study", count: 10, exam: "all", category, source: "all", order: "random" })}
          onOpenGuide={onOpenGuide}
          onOpenAnalytics={onOpenAnalytics}
        />}
      </main>
    );
  }

  if (session.mode === "exam" && session.reviewing) {
    const flaggedIds = session.ids.filter((id) => flaggedSet.has(id));
    return (
      <main className="workspace-page exam-review-page">
        <header className="exam-review-header">
          <div>
            <p className="eyebrow"><span />交卷前檢查</p>
            <h1>確認沒有漏掉重要題目</h1>
            <p>答案尚未送出；點選題號可返回修改。確認交卷後才會公布成績與詳解。</p>
          </div>
          {session.timerEnabled && <div className="exam-review-time"><Clock3 size={18} /><span>作答時間</span><strong>{elapsedLabel}</strong></div>}
        </header>

        <section className="exam-review-summary" aria-label="作答狀態摘要">
          <article className="paper-card"><span>已作答</span><strong>{answeredCount}</strong><small>共 {session.ids.length} 題</small></article>
          <article className={`paper-card ${unansweredIds.length ? "attention" : ""}`}><span>未作答</span><strong>{unansweredIds.length}</strong><small>{unansweredIds.length ? "交卷後將記為空白" : "已全部作答"}</small></article>
          <article className={`paper-card ${flaggedIds.length ? "flagged" : ""}`}><span>待檢查</span><strong>{flaggedIds.length}</strong><small>{flaggedIds.length ? "你標記的題目" : "沒有標記題"}</small></article>
        </section>

        <section className="exam-review-lists paper-card">
          <div>
            <header><CircleAlert size={19} /><span><strong>未作答題目</strong><small>建議交卷前逐題確認</small></span></header>
            {unansweredIds.length ? <div className="exam-review-question-grid">{unansweredIds.map((id) => {
              const position = session.ids.indexOf(id);
              return <button key={id} onClick={() => jumpToQuestion(id)}><span>{position + 1}</span><small>{id}</small></button>;
            })}</div> : <p className="exam-review-empty"><CheckCircle2 size={18} />所有題目都已有答案。</p>}
          </div>
          <div>
            <header><Flag size={19} /><span><strong>標記待檢查</strong><small>標記不影響作答與計分</small></span></header>
            {flaggedIds.length ? <div className="exam-review-question-grid flagged">{flaggedIds.map((id) => {
              const position = session.ids.indexOf(id);
              return <button key={id} onClick={() => jumpToQuestion(id)}><span>{position + 1}</span><small>{id}</small></button>;
            })}</div> : <p className="exam-review-empty">目前沒有標記待檢查的題目。</p>}
          </div>
        </section>

        {unansweredIds.length > 0 && <p className="exam-submit-warning" role="status"><CircleAlert size={17} />仍有 {unansweredIds.length} 題未作答；你仍可明確確認後交卷。</p>}
        {notice && <p className="form-notice" role="alert">{notice}</p>}
        <div className="exam-review-actions">
          <button className="outline-button" onClick={() => setSession({ ...session, reviewing: false })}><ArrowLeft size={18} />返回作答</button>
          <button className="primary-button" disabled={submitting} onClick={finishExam}>{submitting ? "正在交卷…" : "確認交卷並查看成績"}<Trophy size={18} /></button>
        </div>
        {sessionDialogs}
      </main>
    );
  }

  const activeLoadError = questionLoadError?.id === currentId ? questionLoadError : null;
  if (activeLoadError) {
    return (
      <main className="workspace-page practice-session-page">
        <div className="empty-state" role="alert">
          <CircleAlert size={32} />
          <h2>題目載入失敗</h2>
          <p>{activeLoadError.message}</p>
          <button
            className="outline-button"
            onClick={() => {
              setQuestionLoadError(null);
              setLoadedQuestion((question) => question?.id === currentId ? null : question);
              setLoadRetry((value) => value + 1);
            }}
          >
            <RefreshCw size={17} />重新載入
          </button>
        </div>
        {sessionDialogs}
      </main>
    );
  }

  if (!current) return <main className="workspace-page"><QuestionLoading />{sessionDialogs}</main>;
  const selected = session.answers[current.id] ?? [];
  const submitted = session.submitted.includes(current.id);
  const progress = progressMap.get(current.id);
  const bookmarked = currentConcept?.progress.bookmarked ?? (progress?.bookmarked === 1);
  const displayProgress = currentConcept?.progress.latestRecord
    ? { ...currentConcept.progress.latestRecord, questionId: current.id, wrongState: currentConcept.progress.wrongState }
    : progress;
  const eliminatedOptions = session.eliminatedOptions[current.id] ?? [];
  const scratchpad = session.scratchpads[current.id] ?? "";
  const toolsLocked = session.mode === "study" && submitted;
  const eliminatedClasses = current.options
    .map((option, index) => eliminatedOptions.includes(option.key) ? `option-eliminated-${index + 1}` : "")
    .filter(Boolean)
    .join(" ");
  const scratchpadId = `practice-scratchpad-${current.id}`;
  const handleOptionContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (toolsLocked) return;
    const target = event.target instanceof Element ? event.target : null;
    const optionButton = target?.closest<HTMLButtonElement>(".answer-options > button");
    const key = optionButton?.querySelector<HTMLElement>(".option-key")?.textContent?.trim();
    if (!key || !current.options.some((option) => option.key === key)) return;
    event.preventDefault();
    toggleEliminatedOption(key);
  };

  return (
    <main className="workspace-page practice-session-page">
      <div className="session-toolbar">
        <div><span>{session.mode === "study" ? "學習模式" : "模擬考模式"}</span><strong>{session.cursor + 1} / {session.ids.length}</strong>{session.timerEnabled && <time aria-label={`已作答 ${elapsedLabel}`}><Clock3 size={15} />{elapsedLabel}</time>}</div>
        <div className="session-progress" role="progressbar" aria-label="本輪作答進度" aria-valuemin={1} aria-valuemax={session.ids.length} aria-valuenow={session.cursor + 1}><i style={{ width: `${((session.cursor + 1) / session.ids.length) * 100}%` }} /></div>
        <button className="text-action" disabled={submitting} onClick={() => setEndDialogOpen(true)}><Pause size={17} />暫停／結束</button>
      </div>
      {notice && <p className="form-notice practice-session-notice" role="status">{notice}</p>}
      {session.mode === "exam" && (
        <section className="exam-session-console paper-card" aria-label="模擬考題號導覽">
          <header>
            <div className="exam-session-counts">
              <span><i className="answered" />已作答 <strong>{answeredCount}</strong></span>
              <span><i className="unanswered" />未作答 <strong>{unansweredIds.length}</strong></span>
              <span><i className="flagged" />待檢查 <strong>{session.flaggedIds.length}</strong></span>
            </div>
            <button className={`exam-flag-button ${flaggedSet.has(current.id) ? "active" : ""}`} aria-pressed={flaggedSet.has(current.id)} onClick={toggleCurrentFlag}><Flag size={16} fill={flaggedSet.has(current.id) ? "currentColor" : "none"} />{flaggedSet.has(current.id) ? "取消待檢查" : "標記待檢查"}</button>
          </header>
          <details open={navigatorOpen} onToggle={(event) => setNavigatorOpen(event.currentTarget.open)}>
            <summary><ListChecks size={17} />題號總覽 <small>可直接跳題</small></summary>
            <div className="exam-question-grid">
              {session.ids.map((id, position) => {
                const answered = !unansweredIds.includes(id);
                const flagged = flaggedSet.has(id);
                const active = position === session.cursor;
                const state = [answered ? "answered" : "unanswered", flagged ? "flagged" : "", active ? "current" : ""].filter(Boolean).join(" ");
                return <button key={id} className={state} aria-current={active ? "step" : undefined} aria-label={`第 ${position + 1} 題，${answered ? "已作答" : "未作答"}${flagged ? "，已標記待檢查" : ""}`} onClick={() => jumpToQuestion(id)}><span>{position + 1}</span>{flagged && <Flag size={9} fill="currentColor" />}</button>;
              })}
            </div>
          </details>
        </section>
      )}
      {currentExplanation?.fallback && <p className="reader-notice" role="status" aria-live="polite">精要詳解暫不可用，已顯示詳細版。</p>}
      <div className="practice-question-workspace">
        <div
          className={`practice-question-surface ${toolsLocked ? "tools-locked" : ""} ${eliminatedClasses}`}
          onContextMenuCapture={handleOptionContextMenu}
        >
          <QuestionSheet
            question={current}
            selectedKeys={selected}
            submitted={session.mode === "study" && submitted}
            confidence={session.confidence[current.id] ?? "normal"}
            bookmarked={bookmarked}
            progress={displayProgress}
            showFullExplanation={expandedQuestionId === current.id}
            explanationMarkdown={currentExplanation ? explanationForMode(currentExplanation.markdown, explanationMode) : undefined}
            explanationRaw={explanationMode === "raw"}
            explanationLoading={session.mode === "study" && !currentExplanation}
            busy={submitting}
            onSelect={updateAnswer}
            onConfidence={updateConfidence}
            onSubmit={session.mode === "study" ? submitStudyAnswer : advance}
            onBookmark={toggleConceptBookmark}
            onShowExplanation={() => setExpandedQuestionId(current.id)}
            onOpenGuide={onOpenGuide}
            submitLabel={session.mode === "exam" ? session.cursor === session.ids.length - 1 ? "前往交卷檢查" : "下一題" : "提交答案"}
          />
        </div>

        <aside className="practice-question-tools paper-card" aria-label={`${current.id} 作答工具`}>
          <section className="practice-elimination-tool" aria-labelledby="practice-elimination-heading">
            <header>
              <div className="practice-tool-title"><Eraser size={18} /><span><strong id="practice-elimination-heading">刪去選項</strong><small id="practice-elimination-help">只留下判斷記號，不會取消已選答案，也不影響提交與計分。</small></span></div>
              <p className="practice-tool-shortcuts" aria-hidden="true"><kbd>Shift</kbd>＋<kbd>A–E</kbd>，或在選項上按右鍵</p>
            </header>
            <div className="practice-elimination-buttons" role="group" aria-labelledby="practice-elimination-heading" aria-describedby="practice-elimination-help">
              {current.options.map((option) => {
                const eliminated = eliminatedOptions.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    className="quiet-button"
                    aria-pressed={eliminated}
                    aria-keyshortcuts={`Shift+${option.key}`}
                    aria-label={`${eliminated ? "復原" : "刪去"}選項 ${option.key}；不會改變目前答案`}
                    disabled={toolsLocked}
                    onClick={() => toggleEliminatedOption(option.key)}
                  >
                    <span>{option.key}</span>{eliminated ? "已刪去" : "刪去"}
                  </button>
                );
              })}
            </div>
            {toolsLocked && <p className="practice-tool-locked" role="status">答案已公布；本題的刪去記號已保留至本輪結束。</p>}
          </section>

          <section className={`practice-scratchpad-tool ${scratchpadOpen ? "open" : ""}`}>
            <button
              type="button"
              className="practice-scratchpad-toggle"
              aria-expanded={scratchpadOpen}
              aria-controls={scratchpadId}
              onClick={() => setScratchpadOpen((open) => !open)}
            >
              <FileText size={18} /><span><strong>臨時草稿紙</strong><small>{scratchpad ? `這題已有 ${scratchpad.length.toLocaleString("zh-TW")} 字` : "計算、整理線索或記下排除理由"}</small></span><ChevronDown size={18} />
            </button>
            <div id={scratchpadId} className="practice-scratchpad-editor" hidden={!scratchpadOpen} role="region" aria-label={`${current.id} 臨時草稿紙`}>
              <label htmlFor={`${scratchpadId}-input`}>這題的臨時草稿</label>
              <textarea
                className="field-control"
                id={`${scratchpadId}-input`}
                value={scratchpad}
                maxLength={4000}
                spellCheck={false}
                placeholder="例如：先排除 C；AG = Na − Cl − HCO₃⁻…"
                onChange={(event) => updateScratchpad(event.target.value)}
              />
              <footer><small>{scratchpad.length.toLocaleString("zh-TW")} / 4,000</small><button type="button" className="text-action" disabled={!scratchpad} onClick={() => updateScratchpad("")}><Trash2 size={15} />清除這題草稿</button></footer>
            </div>
          </section>
        </aside>
      </div>
      <nav className="question-navigation" aria-label="題目導覽">
        <button className="quiet-button" disabled={session.cursor === 0} onClick={() => setSession({ ...session, cursor: session.cursor - 1 })}><ArrowLeft size={18} />上一題</button>
        {session.mode === "study" && submitted && <button className="primary-button" onClick={advance}>{session.cursor === session.ids.length - 1 ? "完成本輪" : "下一題"}<ArrowRight size={18} /></button>}
        {session.mode === "exam" && <button className="quiet-button" onClick={openExamReview}><ListChecks size={18} />檢查並交卷</button>}
      </nav>
      {sessionDialogs}
    </main>
  );
}
