"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpenText, Bookmark, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Filter, Play, Search, X } from "lucide-react";
import { useMinuteClock } from "../hooks/use-minute-clock";
import { buildCanonicalConcepts, dedupeCanonicalQuestionIds } from "../lib/canonical-concepts";
import { loadSearchCatalog, matchesSearch, prefetchQuestion } from "../lib/question-data";
import type { BrowsePreset, Manifest, ProgressRecord, QuestionIndex } from "../lib/types";

type Props = {
  manifest: Manifest;
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  preset?: BrowsePreset | null;
  onOpenReader: (id: string) => void;
  onStartQuestions: (ids: string[]) => void;
  selectionStorageKey?: string;
  searchCatalogLoader?: (() => Promise<void>) | null;
  questionPrefetcher?: (question: QuestionIndex) => void;
  canonicalizeSelection?: boolean;
  showExamFilter?: boolean;
  showSourceSectionFilter?: boolean;
  headerActions?: ReactNode;
  copy?: Partial<{
    eyebrow: string;
    title: string;
    searchAriaLabel: string;
    searchPlaceholder: string;
    categoryLabel: string;
    allCategoriesLabel: string;
    resultsNoun: string;
    selectionNoun: string;
    selectionDetail: string;
    startLabel: string;
  }>;
};

const PAGE_SIZE = 40;
const BROWSE_SELECTION_KEY = "em-board-browse-selection-v1";

const defaultCopy = {
  eyebrow: "題庫瀏覽",
  title: "搜尋與篩選題庫",
  searchAriaLabel: "搜尋題號、題幹、選項或關鍵字",
  searchPlaceholder: "搜尋：115B-Q200、主動脈剝離、methemoglobinemia…",
  categoryLabel: "主要領域",
  allCategoriesLabel: "全部領域",
  resultsNoun: "題符合條件",
  selectionNoun: "個觀念",
  selectionDetail: "",
  startLabel: "開始練習",
};

export default function BrowseView({
  manifest,
  questions,
  progressMap,
  preset,
  onOpenReader,
  onStartQuestions,
  selectionStorageKey = BROWSE_SELECTION_KEY,
  searchCatalogLoader = loadSearchCatalog,
  questionPrefetcher = prefetchQuestion,
  canonicalizeSelection = true,
  showExamFilter = manifest.groups.length > 1,
  showSourceSectionFilter = manifest.sourceSections.length > 0,
  headerActions,
  copy: copyOverrides,
}: Props) {
  const copy = { ...defaultCopy, ...copyOverrides };
  const [query, setQuery] = useState("");
  const [exam, setExam] = useState("all");
  const [category, setCategory] = useState(preset?.category ?? "all");
  const [sourceSection, setSourceSection] = useState(preset?.sourceSection ? String(preset.sourceSection) : "all");
  const [status, setStatus] = useState(preset?.status ?? "all");
  const [sort, setSort] = useState("id-asc");
  const [page, setPage] = useState(1);
  const [searchVersion, setSearchVersion] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionReady, setSelectionReady] = useState(false);
  const now = useMinuteClock();

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(selectionStorageKey) ?? "[]") as unknown;
        if (Array.isArray(stored)) setSelectedIds(new Set(stored.filter((id): id is string => typeof id === "string")));
      } catch {
        // A blocked tab store simply starts with an empty selection.
      }
      setSelectionReady(true);
    });
    return () => { active = false; };
  }, [selectionStorageKey]);

  useEffect(() => {
    if (!selectionReady) return;
    try {
      if (selectedIds.size) window.sessionStorage.setItem(selectionStorageKey, JSON.stringify([...selectedIds]));
      else window.sessionStorage.removeItem(selectionStorageKey);
    } catch {
      // The in-memory cross-page selection remains usable for this visit.
    }
  }, [selectedIds, selectionReady, selectionStorageKey]);

  const conceptStateByQuestion = useMemo(() => {
    const state = new Map<string, { progress: ReturnType<typeof buildCanonicalConcepts>[number]["progress"]; read: boolean }>();
    for (const concept of buildCanonicalConcepts(questions, progressMap, now)) {
      const value = {
        progress: concept.progress,
        read: concept.members.some((question) => progressMap.get(question.id)?.readState === "done"),
      };
      for (const question of concept.members) state.set(question.id, value);
    }
    return state;
  }, [now, progressMap, questions]);

  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    if (!searchCatalogLoader) return;
    void searchCatalogLoader().then(() => { if (active) setSearchVersion(1); }).catch(() => undefined);
    return () => { active = false; };
  }, [query, searchCatalogLoader]);

  const results = useMemo(() => {
    const filtered = questions.filter((question) => {
      if (exam !== "all" && question.exam !== exam) return false;
      if (category !== "all" && question.category !== category) return false;
      if (sourceSection !== "all" && !question.sourceSections.includes(Number(sourceSection))) return false;
      if (!matchesSearch(question, query, searchVersion)) return false;
      const concept = conceptStateByQuestion.get(question.id);
      if (status === "unanswered" && concept?.progress.attempts) return false;
      if (status === "wrong" && !concept?.progress.pending) return false;
      if (status === "bookmarked" && !concept?.progress.bookmarked) return false;
      if (status === "due" && !concept?.progress.due) return false;
      if (status === "read" && !concept?.read) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "id-desc") return b.id.localeCompare(a.id, "zh-Hant", { numeric: true });
      if (sort === "title") return a.title.localeCompare(b.title, "zh-Hant");
      return a.id.localeCompare(b.id, "zh-Hant", { numeric: true });
    });
  }, [category, conceptStateByQuestion, exam, query, questions, searchVersion, sort, sourceSection, status]);

  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const visiblePracticeIds = visible.filter((question) => !question.excludedFromPractice && !question.allCredit).map((question) => question.id);
  const allVisibleSelected = visiblePracticeIds.length > 0 && visiblePracticeIds.every((id) => selectedIds.has(id));
  const practiceEligibleIds = useMemo(() => new Set(questions.filter((question) => !question.excludedFromPractice && !question.allCredit).map((question) => question.id)), [questions]);
  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const selectedEligibleIds = [...selectedIds].filter((id) => practiceEligibleIds.has(id));
  const selectedPracticeIds = canonicalizeSelection
    ? dedupeCanonicalQuestionIds(selectedEligibleIds, questionById, { progressMap })
    : selectedEligibleIds;
  const hasFilters = Boolean(query || exam !== "all" || category !== "all" || sourceSection !== "all" || status !== "all");

  const clearFilters = () => {
    setQuery(""); setExam("all"); setCategory("all"); setSourceSection("all"); setStatus("all"); setPage(1);
  };

  const toggleQuestion = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      visiblePracticeIds.forEach((id) => { if (allVisibleSelected) next.delete(id); else next.add(id); });
      return next;
    });
  };

  return (
    <main className="workspace-page browse-page">
      <header className="page-intro compact-intro">
        <p className="eyebrow"><span />{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        {headerActions}
      </header>

      <section className="search-panel paper-card">
        <label className="main-search"><Search size={20} /><input aria-label={copy.searchAriaLabel} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={copy.searchPlaceholder} />{query && <button aria-label="清除搜尋" onClick={() => { setQuery(""); setPage(1); }}><X size={17} /></button>}</label>
        <div className="browse-filters">
          {showExamFilter && <label><span>年度</span><select value={exam} onChange={(event) => { setExam(event.target.value); setPage(1); }}><option value="all">全部年度</option>{manifest.groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>}
          <label><span>{copy.categoryLabel}</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="all">{copy.allCategoriesLabel}</option>{manifest.categories.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
          {showSourceSectionFilter && <label><span>Tintinalli 章節</span><select value={sourceSection} onChange={(event) => { setSourceSection(event.target.value); setPage(1); }}><option value="all">全部章節</option>{manifest.sourceSections.map((item) => <option key={item.id} value={item.id}>Section {item.id}・{item.label}（{item.count}）</option>)}</select></label>}
          <label><span>狀態</span><select value={status} onChange={(event) => { setStatus(event.target.value as NonNullable<BrowsePreset["status"]>); setPage(1); }}><option value="all">全部狀態</option><option value="unanswered">尚未作答</option><option value="wrong">待釐清錯題</option><option value="due">今日到期</option><option value="bookmarked">我的收藏</option><option value="read">已讀完詳解</option></select></label>
          <label><span>排序</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="id-asc">題號由舊到新</option><option value="id-desc">題號由新到舊</option><option value="title">依標題排序</option></select></label>
        </div>
      </section>

      <div className="results-heading">
        <div><Filter size={17} /><strong>{results.length.toLocaleString("zh-TW")}</strong><span>{copy.resultsNoun}</span></div>
        <div className="results-heading-actions">
          {visiblePracticeIds.length > 0 && <button className="text-action" aria-pressed={allVisibleSelected} onClick={toggleVisible}>{allVisibleSelected ? "取消本頁選取" : `選取本頁 ${visiblePracticeIds.length} 題`}</button>}
          {hasFilters && <button className="text-action" onClick={clearFilters}>清除全部篩選</button>}
        </div>
      </div>

      <section className="question-results" aria-label="題目搜尋結果">
        {visible.map((question) => {
          const conceptProgress = conceptStateByQuestion.get(question.id)?.progress;
          const progress = conceptProgress?.latestRecord;
          const selected = selectedIds.has(question.id);
          const practiceEligible = !question.excludedFromPractice && !question.allCredit;
          return (
            <article key={question.id} className="question-result-card" data-selected={selected || undefined} onPointerEnter={() => questionPrefetcher(question)} onPointerDown={() => questionPrefetcher(question)} onFocusCapture={() => questionPrefetcher(question)}>
              <label className="result-select" title={question.excludedFromPractice || question.allCredit ? "此題不納入練習" : "加入練習清單"}>
                <input type="checkbox" checked={selected} disabled={question.excludedFromPractice || question.allCredit} onChange={() => toggleQuestion(question.id)} aria-label={`選取 ${question.id} 加入練習`} />
                <span aria-hidden="true" />
              </label>
              <button
                className="question-result-open"
                onFocus={() => questionPrefetcher(question)}
                onClick={() => practiceEligible ? onStartQuestions([question.id]) : onOpenReader(question.id)}
                aria-label={practiceEligible ? `作答 ${question.id}` : `閱讀 ${question.id} 詳解`}
              >
                <div className="result-id"><strong>{question.id}</strong><span>{question.category}</span></div>
                <div className="result-copy"><h2>{question.title}</h2><p>{question.stem}</p><div className="result-tags"><span>{question.questionType}</span>{question.images.length > 0 && <span>{question.images.length} 張原題圖片</span>}{(question.excludedFromPractice || question.allCredit) && <span>不納入練習</span>}{question.qualityStatus && <span className="warning-tag"><AlertTriangle size={12} />暫不納入練習</span>}</div></div>
                <div className="result-state">
                  {conceptProgress?.bookmarked && <Bookmark size={17} fill="currentColor" />}
                  {conceptProgress?.pending ? <span className="wrong-dot">待釐清</span> : conceptProgress?.attempts ? <span className={progress?.lastCorrect === 1 ? "correct-dot" : "wrong-dot"}>{progress?.lastCorrect === 1 ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}{progress?.lastCorrect === 1 ? "最近答對" : "最近答錯"}</span> : <span>未作答</span>}
                </div>
              </button>
              <div className="question-result-actions">
                <button
                  type="button"
                  className="question-result-practice primary-button"
                  onFocus={() => questionPrefetcher(question)}
                  onClick={() => practiceEligible ? onStartQuestions([question.id]) : onOpenReader(question.id)}
                  aria-label={practiceEligible ? `開始作答 ${question.id}` : `閱讀 ${question.id}`}
                >
                  {practiceEligible ? <><Play size={15} />開始作答</> : <><BookOpenText size={15} />閱讀題目</>}
                </button>
                <button
                  type="button"
                  className="question-result-reader quiet-button"
                  onFocus={() => questionPrefetcher(question)}
                  onClick={() => onOpenReader(question.id)}
                  aria-label={`直接閱讀 ${question.id} 詳解`}
                >
                  <BookOpenText size={16} /><span>閱讀詳解</span>
                </button>
              </div>
            </article>
          );
        })}
        {!visible.length && <div className="empty-state"><Search size={30} /><h2>沒有符合條件的題目</h2><p>可以移除一個篩選條件，或改用較短的關鍵字。</p><button className="outline-button" onClick={clearFilters}>清除篩選</button></div>}
      </section>

      {pages > 1 && <nav className="pagination" aria-label="搜尋結果分頁"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft />上一頁</button><span>第 {currentPage} / {pages} 頁</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一頁<ChevronRight /></button></nav>}

      {selectedPracticeIds.length > 0 && <aside className="browse-selection-bar floating-action-bar" aria-live="polite" aria-label="已選題目練習清單"><div><strong>已選 {selectedPracticeIds.length} {copy.selectionNoun}</strong>{copy.selectionDetail && <span>{copy.selectionDetail}</span>}</div><button className="text-action" onClick={() => setSelectedIds(new Set())}>清除</button><button className="primary-button" onClick={() => onStartQuestions(selectedPracticeIds)}><Play size={17} fill="currentColor" />{copy.startLabel}</button></aside>}
    </main>
  );
}
