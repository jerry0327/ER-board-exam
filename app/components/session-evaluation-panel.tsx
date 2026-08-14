"use client";

import { ArrowRight, BarChart3, BookOpenText, Brain, CheckCircle2, Clock3, RefreshCw, Target } from "lucide-react";
import type { SessionEvaluation } from "../lib/session-evaluation";
import type { PracticeMode } from "../lib/types";

type Props = {
  evaluation: SessionEvaluation;
  mode: PracticeMode;
  onRetryWrong: () => void;
  onPracticeTopic: (category: string) => void;
  onOpenGuide: (chapter: number) => void;
  onOpenAnalytics: () => void;
};

function durationLabel(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}

export default function SessionEvaluationPanel({ evaluation, mode, onRetryWrong, onPracticeTopic, onOpenGuide, onOpenAnalytics }: Props) {
  const visibleTopics = evaluation.topics.slice(0, 6);
  const chapterGuides = evaluation.recommendedGuides.filter((guide) => guide.kind === "chapter");

  return (
    <section className="session-evaluation paper-card" aria-labelledby="session-evaluation-heading">
      <header>
        <div><p className="eyebrow"><span />作答評估</p><h2 id="session-evaluation-heading">本輪作答結果</h2><p>整理本輪正確率、答題信心與各領域表現。</p></div>
        <span className="evaluation-band" data-band={evaluation.band}><Brain size={16} /><strong>{evaluation.bandLabel}</strong></span>
      </header>

      <div className="evaluation-metrics">
        <article><Target /><span>本輪正確率</span><strong>{evaluation.accuracy}%</strong><small>{evaluation.correct} / {evaluation.scored} 題</small></article>
        <article><CheckCircle2 /><span>作答完成度</span><strong>{evaluation.completion}%</strong><small>{evaluation.unanswered ? `${evaluation.unanswered} 題未作答` : "全部完成"}</small></article>
        <article><Clock3 /><span>{mode === "study" ? "本輪用時" : "模擬考用時"}</span><strong>{durationLabel(evaluation.durationSeconds)}</strong><small>{mode === "study" ? "包含詳解閱讀時間" : evaluation.averageSeconds ? `平均每題 ${durationLabel(evaluation.averageSeconds)}` : "尚無作答時間"}</small></article>
        <article><Brain /><span>高信心答錯</span><strong>{evaluation.highConfidenceWrong}</strong><small>{evaluation.lowConfidenceCorrect} 題低信心答對</small></article>
      </div>

      <div className="evaluation-layout">
        <section className="evaluation-topics" aria-labelledby="evaluation-topics-heading">
          <header><div><h3 id="evaluation-topics-heading">主題表現</h3><p>依本輪各主題正確率排列。</p></div><BarChart3 /></header>
          {visibleTopics.length ? <div>{visibleTopics.map((topic) => <div key={topic.category}>
            <span><strong>{topic.category}</strong><small>{topic.correct}/{topic.total} 題答對</small></span>
            <div className="evaluation-topic-track" role="progressbar" aria-label={`${topic.category}本輪正確率 ${topic.accuracy}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={topic.accuracy}><i style={{ width: `${topic.accuracy}%` }} /></div>
            <b>{topic.accuracy}%</b>
          </div>)}</div> : <p className="evaluation-empty">本輪沒有可計分題目。</p>}
        </section>

        <aside className="evaluation-plan">
          <p>下一步建議</p>
          <h3>{evaluation.recommendationTitle}</h3>
          <p>{evaluation.recommendationDetail}</p>
          <small>{evaluation.bandDetail}</small>
          {chapterGuides.length > 0 && <div className="evaluation-guide-links"><span><BookOpenText size={15} />建議搭配學習指引</span>{chapterGuides.map((guide) => <button key={guide.id} onClick={() => onOpenGuide(guide.id)}>Chapter {guide.id}<small>{guide.wrongCount} 題相關失分</small></button>)}</div>}
          <div className="evaluation-actions">
            {evaluation.wrongIds.length > 0 && <button className="primary-button" onClick={onRetryWrong}><RefreshCw size={16} />只練本輪錯題</button>}
            {evaluation.weakestTopic && <button className="outline-button" onClick={() => onPracticeTopic(evaluation.weakestTopic!.category)}>練習「{evaluation.weakestTopic.category}」<ArrowRight size={16} /></button>}
            <button className="quiet-button" onClick={onOpenAnalytics}><BarChart3 size={16} />查看完整學習分析</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
