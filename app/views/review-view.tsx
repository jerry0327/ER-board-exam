"use client";

import { useMemo, useState } from "react";
import { ArrowRight, BookCheck, Bookmark, CheckCircle2, Clock3, Play, RotateCcw, Search } from "lucide-react";
import { useMinuteClock } from "../hooks/use-minute-clock";
import { buildCanonicalConcepts } from "../lib/canonical-concepts";
import { prefetchQuestion } from "../lib/question-data";
import type { ProgressRecord, QuestionIndex } from "../lib/types";

type ReviewTab = "pending" | "due" | "mastered" | "bookmarked";

type Props = {
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  onOpenReader: (id: string) => void;
  onMastery: (id: string, value: "pending" | "mastered" | "none") => Promise<unknown>;
  onStartQuestions: (ids: string[]) => void;
};

const REVIEW_PAGE_SIZE = 100;

const tabs: { id: ReviewTab; label: string; icon: typeof RotateCcw }[] = [
  { id: "pending", label: "待釐清", icon: RotateCcw },
  { id: "due", label: "今日到期", icon: Clock3 },
  { id: "mastered", label: "已掌握", icon: CheckCircle2 },
  { id: "bookmarked", label: "收藏題", icon: Bookmark },
];

export default function ReviewView({ questions, progressMap, onOpenReader, onMastery, onStartQuestions }: Props) {
  const [tab, setTab] = useState<ReviewTab>("pending");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(REVIEW_PAGE_SIZE);
  const now = useMinuteClock();
  const concepts = useMemo(() => buildCanonicalConcepts(questions, progressMap, now), [now, progressMap, questions]);
  const counts = useMemo(() => ({
    pending: concepts.filter((concept) => concept.progress.pending).length,
    due: concepts.filter((concept) => concept.progress.due).length,
    mastered: concepts.filter((concept) => concept.progress.mastered).length,
    bookmarked: concepts.filter((concept) => concept.progress.bookmarked).length,
  }), [concepts]);
  const results = useMemo(() => concepts.filter((concept) => {
    const progress = concept.progress;
    const needle = query.toLocaleLowerCase();
    const match = !query || concept.members.some((question) => `${question.id} ${question.title} ${question.stem}`.toLocaleLowerCase().includes(needle));
    if (!match) return false;
    if (tab === "pending") return progress.pending;
    if (tab === "due") return progress.due;
    if (tab === "mastered") return progress.mastered;
    return progress.bookmarked;
  }), [concepts, query, tab]);
  const practiceIds = results.map((concept) => {
    const bookmarkedMember = tab === "bookmarked" ? concept.members.find((question) => !question.excludedFromPractice && !question.allCredit && progressMap.get(question.id)?.bookmarked === 1) : undefined;
    const representative = bookmarkedMember ?? (concept.representative.excludedFromPractice || concept.representative.allCredit
      ? concept.members.find((question) => !question.excludedFromPractice && !question.allCredit)
      : concept.representative);
    return representative?.id;
  }).filter((id): id is string => Boolean(id));
  const visibleResults = results.slice(0, visibleCount);

  const updateConceptMastery = (memberIds: string[], value: "pending" | "mastered") => {
    const targets = memberIds.filter((id) => {
      const state = progressMap.get(id)?.wrongState;
      return value === "mastered" ? state === "pending" : state === "mastered";
    });
    void Promise.all(targets.map((id) => onMastery(id, value)));
  };

  return (
    <main className="workspace-page review-page">
      <header className="page-intro compact-intro">
        <p className="eyebrow"><span />錯題本</p>
        <h1>集中複習錯題與收藏</h1>
        <p>答錯後會列入待釐清；連續答對兩次後移至已掌握。同一觀念集中呈現。</p>
      </header>
      <nav className="review-tabs" aria-label="錯題分類">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setVisibleCount(REVIEW_PAGE_SIZE); }}><Icon size={18} /><span>{label}</span><strong>{counts[id]}</strong></button>)}
      </nav>
      <div className="review-tools">
        <label className="review-search"><Search size={18} aria-hidden="true" /><input aria-label="搜尋目前錯題分類" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(REVIEW_PAGE_SIZE); }} placeholder="在目前分類中搜尋" /></label>
        <div><span>目前共有 {results.length} 個觀念</span><button className="primary-button" disabled={!practiceIds.length} onClick={() => onStartQuestions(practiceIds)}><Play size={17} fill="currentColor" />開始練習（{practiceIds.length} 題）</button></div>
      </div>
      <section className="review-list">
        {visibleResults.map((concept) => {
          const question = tab === "bookmarked"
            ? concept.members.find((member) => progressMap.get(member.id)?.bookmarked === 1) ?? concept.representative
            : concept.representative;
          const progress = concept.progress;
          return <article className="review-card" key={concept.id} onPointerEnter={() => prefetchQuestion(question)} onPointerDown={() => prefetchQuestion(question)} onFocusCapture={() => prefetchQuestion(question)}><div className="review-status-mark">{tab === "mastered" ? <CheckCircle2 /> : tab === "bookmarked" ? <Bookmark fill="currentColor" /> : <RotateCcw />}</div><div className="review-card-copy"><span>{question.id}・{question.category}{concept.members.length > 1 ? `・同一觀念 ${concept.members.length} 題` : ""}</span><h2>{question.title}</h2><p>{question.stem}</p><small>{progress.attempts ? `作答 ${progress.attempts} 次・答對 ${progress.correctAttempts} 次` : "尚未作答"}{progress.dueAt ? `・下次複習 ${new Date(progress.dueAt).toLocaleDateString("zh-TW")}` : ""}</small></div><div className="review-card-actions"><button className="outline-button" onClick={() => onOpenReader(question.id)}><BookCheck size={17} />閱讀詳解<ArrowRight size={16} /></button>{progress.pending && <button className="text-action" onClick={() => updateConceptMastery(concept.memberIds, "mastered")}>標記為已掌握</button>}{progress.mastered && <button className="text-action" onClick={() => updateConceptMastery(concept.memberIds, "pending")}>移回待釐清</button>}</div></article>;
        })}
        {!results.length && <div className="empty-state"><BookCheck size={32} /><h2>{tab === "pending" ? "目前沒有待釐清錯題" : tab === "due" ? "今天沒有到期題" : tab === "mastered" ? "連續答對兩次後，題目會出現在這裡" : "還沒有收藏題目"}</h2></div>}
      </section>
      {visibleCount < results.length && <div className="review-load-more"><span>已顯示 {visibleResults.length} / {results.length} 個觀念</span><button className="outline-button" onClick={() => setVisibleCount((value) => value + REVIEW_PAGE_SIZE)}>載入更多（剩餘 {results.length - visibleResults.length} 個）</button></div>}
    </main>
  );
}
