"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Activity, ArrowRight, BarChart3, BookCheck, BookOpenText, CalendarDays, CheckCircle2, GitBranch, PieChart, Play, Target } from "lucide-react";
import { buildCanonicalConcepts } from "../lib/canonical-concepts";
import type { AttemptRecord, Manifest, ProgressRecord, QuestionIndex } from "../lib/types";
import { layoutTreemap } from "../lib/treemap";

const EXAM_ERAS = [
  { label: "94–99", from: 94, to: 99 },
  { label: "100–104", from: 100, to: 104 },
  { label: "105–109", from: 105, to: 109 },
  { label: "110–115", from: 110, to: 115 },
] as const;

type Props = {
  questions: QuestionIndex[];
  manifest: Manifest;
  records: ProgressRecord[];
  attempts: AttemptRecord[];
  onBrowseCategory: (category: string, status?: "all" | "unanswered" | "wrong") => void;
  onBrowseSourceSection: (sourceSection: number) => void;
  onStartQuestions: (ids: string[]) => void;
};

function localDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export default function AnalyticsView({ questions, manifest, records, attempts, onBrowseCategory, onBrowseSourceSection, onStartQuestions }: Props) {
  const [selectedMapCategory, setSelectedMapCategory] = useState("");
  const analysis = useMemo(() => {
    const index = new Map(questions.map((question) => [question.id, question]));
    const recordMap = new Map(records.map((record) => [record.questionId, record]));
    const validQuestions = questions.filter((question) => !question.allCredit && !question.excludedFromPractice);
    const concepts = buildCanonicalConcepts(validQuestions, recordMap);
    const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
    const canonicalTotal = concepts.length;
    const attemptedCanonical = concepts.filter((concept) => concept.progress.attempts > 0).length;
    const recent = attempts.filter((attempt) => attempt.correct !== null).slice(0, 50);
    const recentAccuracy = recent.length ? Math.round(recent.filter((attempt) => attempt.correct === 1).length / recent.length * 100) : null;
    const highWrong = attempts.filter((attempt) => attempt.confidence === "high" && attempt.correct === 0).length;

    const canonicalQuestions = new Map(concepts.map((concept) => [concept.id, concept.anchor]));
    const canonicalSections = new Map<string, Set<number>>();
    for (const question of validQuestions) {
      const canonicalId = question.canonicalId ?? question.id;
      const sections = canonicalSections.get(canonicalId) ?? new Set<number>();
      question.sourceSections.forEach((section) => sections.add(section));
      canonicalSections.set(canonicalId, sections);
    }
    const canonicalRecords = new Map<string, ProgressRecord[]>();
    for (const record of records) {
      const source = index.get(record.questionId);
      if (!source || source.allCredit || source.excludedFromPractice) continue;
      const canonicalId = source.canonicalId ?? source.id;
      const values = canonicalRecords.get(canonicalId) ?? [];
      values.push(record);
      canonicalRecords.set(canonicalId, values);
    }
    const firstConceptScores = concepts.map((concept) => concept.progress.latestRecord?.firstAttemptCorrect).filter((score): score is number => score !== null && score !== undefined);
    const firstAccuracy = firstConceptScores.length ? Math.round(firstConceptScores.filter((score) => score === 1).length / firstConceptScores.length * 100) : null;
    const eraTotals = EXAM_ERAS.map((era) => validQuestions.filter((question) => question.year >= era.from && question.year <= era.to).length);
    const blueprint = manifest.categories.map((category) => {
      const bankIds = [...canonicalQuestions.entries()].filter(([, question]) => question.category === category.id).map(([id]) => id);
      const attempted = bankIds.filter((id) => (conceptById.get(id)?.progress.attempts ?? 0) > 0);
      const firstScored = bankIds.filter((id) => conceptById.get(id)?.progress.latestRecord?.firstAttemptCorrect !== null && conceptById.get(id)?.progress.latestRecord?.firstAttemptCorrect !== undefined);
      const firstWrong = firstScored.filter((id) => conceptById.get(id)?.progress.latestRecord?.firstAttemptCorrect === 0);
      const pending = bankIds.filter((id) => conceptById.get(id)?.progress.pending);
      const unansweredConceptIds = bankIds.filter((id) => !(conceptById.get(id)?.progress.attempts ?? 0));
      const allIds = bankIds.flatMap((id) => conceptById.get(id)?.memberIds ?? []);
      const unansweredIds = unansweredConceptIds.flatMap((id) => conceptById.get(id)?.memberIds ?? []);
      const pendingIds = pending.flatMap((id) => conceptById.get(id)?.memberIds ?? []);
      const events = validQuestions.filter((question) => question.category === category.id);
      const years = events.map((question) => question.year);
      return {
        name: category.id,
        total: bankIds.length,
        totalEvents: events.length,
        share: canonicalTotal ? Math.round(bankIds.length / canonicalTotal * 1000) / 10 : 0,
        yearStart: years.length ? Math.min(...years) : null,
        yearEnd: years.length ? Math.max(...years) : null,
        eras: EXAM_ERAS.map((era, index) => {
          const count = events.filter((question) => question.year >= era.from && question.year <= era.to).length;
          return { label: era.label, count, share: eraTotals[index] ? Math.round(count / eraTotals[index] * 1000) / 10 : 0 };
        }),
        attempted: attempted.length,
        unanswered: bankIds.length - attempted.length,
        firstWrong: firstWrong.length,
        pending: pending.length,
        allCount: bankIds.length,
        unansweredCount: unansweredConceptIds.length,
        pendingCount: pending.length,
        coverage: bankIds.length ? Math.round(attempted.length / bankIds.length * 100) : 0,
        errorRate: firstScored.length ? Math.round(firstWrong.length / firstScored.length * 100) : null,
        firstScored: firstScored.length,
        allIds,
        unansweredIds,
        pendingIds,
      };
    }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);

    const sectionRows = manifest.sourceSections.map((section) => {
      const bankIds = [...canonicalQuestions.entries()]
        .filter(([canonicalId]) => canonicalSections.get(canonicalId)?.has(section.id))
        .map(([id]) => id);
      const attempted = bankIds.filter((id) => (conceptById.get(id)?.progress.attempts ?? 0) > 0);
      const read = bankIds.filter((id) => canonicalRecords.get(id)?.some((record) => record.readState === "done"));
      const pending = bankIds.filter((id) => conceptById.get(id)?.progress.pending);
      return {
        id: section.id,
        label: section.label,
        total: bankIds.length,
        attempted: attempted.length,
        read: read.length,
        pending: pending.length,
        coverage: bankIds.length ? Math.round(attempted.length / bankIds.length * 100) : 0,
        readRate: bankIds.length ? Math.round(read.length / bankIds.length * 100) : 0,
      };
    }).filter((row) => row.total > 0).sort((left, right) => right.total - left.total);

    const sectionLabels = new Map(manifest.sourceSections.map((section) => [section.id, section.label]));
    const overlapCounts = new Map<string, number>();
    for (const sections of canonicalSections.values()) {
      const ordered = [...sections].sort((left, right) => left - right);
      for (let left = 0; left < ordered.length; left += 1) {
        for (let right = left + 1; right < ordered.length; right += 1) {
          const key = `${ordered[left]}-${ordered[right]}`;
          overlapCounts.set(key, (overlapCounts.get(key) ?? 0) + 1);
        }
      }
    }
    const overlapRows = [...overlapCounts.entries()].map(([key, count]) => {
      const [left, right] = key.split("-").map(Number);
      return { key, count, left, right, leftLabel: sectionLabels.get(left) ?? `Section ${left}`, rightLabel: sectionLabels.get(right) ?? `Section ${right}` };
    }).sort((left, right) => right.count - left.count).slice(0, 10);
    const crossDomainTotal = [...canonicalSections.values()].filter((sections) => sections.size >= 2).length;

    const confidence = (["low", "normal", "high"] as const).map((level) => {
      const values = attempts.filter((attempt) => attempt.confidence === level && attempt.correct !== null);
      return { level, total: values.length, correct: values.filter((attempt) => attempt.correct === 1).length, accuracy: values.length ? Math.round(values.filter((attempt) => attempt.correct === 1).length / values.length * 100) : 0 };
    });

    const activity = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(); date.setDate(date.getDate() - (6 - offset));
      const key = localDateKey(date);
      return { key, label: date.toLocaleDateString("zh-TW", { weekday: "short" }), count: attempts.filter((attempt) => attempt.correct !== null && localDateKey(attempt.createdAt) === key).length };
    });
    const examRows = manifest.groups.map((group) => {
      const groupQuestions = validQuestions.filter((question) => question.exam === group.id);
      const answered = groupQuestions.map((question) => recordMap.get(question.id)).filter((record): record is ProgressRecord => Boolean(record?.attempts));
      const scored = answered.filter((record) => record.firstAttemptCorrect !== null);
      return {
        id: group.id,
        label: group.label,
        total: groupQuestions.length,
        answered: answered.length,
        coverage: groupQuestions.length ? Math.round(answered.length / groupQuestions.length * 100) : 0,
        accuracy: scored.length ? Math.round(scored.filter((record) => record.firstAttemptCorrect === 1).length / scored.length * 100) : null,
      };
    });
    const validAttempts = attempts.filter((attempt) => attempt.correct !== null);
    const correctAttempts = validAttempts.filter((attempt) => attempt.correct === 1).length;
    const outcome = {
      correct: correctAttempts,
      wrong: validAttempts.length - correctAttempts,
      accuracy: validAttempts.length ? Math.round(correctAttempts / validAttempts.length * 100) : 0,
    };
    const conceptRecordGroups = [...canonicalRecords.values()];
    const reading = {
      done: conceptRecordGroups.filter((values) => values.some((record) => record.readState === "done")).length,
      later: conceptRecordGroups.filter((values) => !values.some((record) => record.readState === "done") && values.some((record) => record.readState === "later")).length,
      bookmarked: concepts.filter((concept) => concept.progress.bookmarked).length,
      pendingWrong: concepts.filter((concept) => concept.progress.pending).length,
    };
    const heatmap = Array.from({ length: 28 }, (_, offset) => {
      const date = new Date(); date.setDate(date.getDate() - (27 - offset));
      const key = localDateKey(date);
      const count = attempts.filter((attempt) => attempt.correct !== null && localDateKey(attempt.createdAt) === key).length;
      return { key, count, label: date.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) };
    });
    return { canonicalTotal, attemptedCanonical, firstAccuracy, firstScoredTotal: firstConceptScores.length, recentAccuracy, highWrong, blueprint, sectionRows, overlapRows, crossDomainTotal, confidence, activity, examRows, outcome, reading, heatmap };
  }, [attempts, manifest.categories, manifest.groups, manifest.sourceSections, questions, records]);

  const maxActivity = Math.max(1, ...analysis.activity.map((day) => day.count));
  const topicTiles = useMemo(() => layoutTreemap(analysis.blueprint.map((row) => ({ id: row.name, value: row.total, data: row }))), [analysis.blueprint]);
  const selectedTopic = analysis.blueprint.find((row) => row.name === selectedMapCategory) ?? analysis.blueprint[0];

  return (
    <main className="workspace-page analytics-page">
      <header className="page-intro compact-intro analytics-intro">
        <div><p className="eyebrow"><span />學習分析</p><h1>學習進度與作答表現</h1><p>查看各領域的完成度、正確率與待複習題目。</p></div>
      </header>

      <section className="metric-grid">
        <article><Target /><span>題庫完成度</span><strong>{analysis.attemptedCanonical}<small> / {analysis.canonicalTotal}</small></strong><p>{Math.round(analysis.attemptedCanonical / analysis.canonicalTotal * 100)}%</p></article>
        <article><CheckCircle2 /><span>首次作答正確率</span><strong>{analysis.firstAccuracy === null ? "—" : `${analysis.firstAccuracy}%`}</strong><p>{analysis.firstScoredTotal} 個觀念，每個觀念計一次</p></article>
        <article><Activity /><span>近期正確率</span><strong>{analysis.recentAccuracy === null ? "—" : `${analysis.recentAccuracy}%`}</strong><p>最近 50 次計分作答</p></article>
        <article><BarChart3 /><span>近期有把握但答錯</span><strong>{analysis.highWrong}</strong><p>優先回看</p></article>
      </section>

      <section className="analytics-grid">
        <article className="analytics-card paper-card topic-map-card">
          <header><div><h2>歷屆考點地圖</h2><p>方塊越大代表歷屆題目越多；選取領域可查看各時期分布</p></div><PieChart /></header>
          <div className="topic-map-layout">
            <div className="topic-treemap paper-card" role="group" aria-label="急診各領域考點分布圖">
              {topicTiles.map((tile, index) => (
                <button
                  key={tile.id}
                  data-tone={index % 5}
                  data-compact={tile.width < 12 || tile.height < 12 ? "true" : undefined}
                  aria-pressed={selectedTopic?.name === tile.id}
                  aria-label={`${tile.id}，${tile.value} 個觀念，占題庫 ${tile.data.share}%`}
                  onClick={() => setSelectedMapCategory(tile.id)}
                  style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%` } as CSSProperties}
                >
                  <span>{tile.id}</span><strong>{tile.value}</strong><small>{tile.data.share}%</small>
                  <i style={{ width: `${tile.data.coverage}%` }} aria-hidden="true" />
                </button>
              ))}
            </div>
            {selectedTopic && (
              <aside className="topic-map-detail paper-card" aria-live="polite">
                <p>目前選取</p><h3>{selectedTopic.name}</h3>
                <dl><div><dt>觀念數</dt><dd>{selectedTopic.total}</dd></div><div><dt>歷屆題次</dt><dd>{selectedTopic.totalEvents}</dd></div><div><dt>完成度</dt><dd>{selectedTopic.coverage}%</dd></div><div><dt>待複習</dt><dd>{selectedTopic.pending}</dd></div></dl>
                <div className="topic-era-bars">
                  {selectedTopic.eras.map((era) => <div key={era.label}><span>{era.label}</span><i><b style={{ width: `${Math.min(100, era.share * 5)}%` }} /></i><strong>{era.share}%</strong></div>)}
                </div>
                <small>各時期比率可看出這個領域在歷屆試題中的占比。</small>
                <div className="topic-practice-actions" aria-label={`${selectedTopic.name}直接練習`}>
                  <button className="quiet-button" disabled={!selectedTopic.pendingIds.length} onClick={() => onStartQuestions(selectedTopic.pendingIds)}><Play size={14} />待複習 {selectedTopic.pendingCount}</button>
                  <button className="quiet-button" disabled={!selectedTopic.unansweredIds.length} onClick={() => onStartQuestions(selectedTopic.unansweredIds)}><Play size={14} />未作答 {selectedTopic.unansweredCount}</button>
                  <button className="quiet-button" disabled={!selectedTopic.allIds.length} onClick={() => onStartQuestions(selectedTopic.allIds)}><Play size={14} />全部 {selectedTopic.allCount}</button>
                </div>
                <button className="topic-browse-action primary-button" onClick={() => onBrowseCategory(selectedTopic.name)}>查看此領域題目<ArrowRight size={15} /></button>
              </aside>
            )}
          </div>
          <div className="topic-mobile-ranking" role="group" aria-label="急診領域題量排名">
            {analysis.blueprint.map((row, index) => <button className="quiet-button" key={row.name} onClick={() => onBrowseCategory(row.name)}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{row.name}</strong><i><em style={{ width: `${row.total / Math.max(analysis.blueprint[0]?.total ?? 1, 1) * 100}%` }} /></i></span><small>{row.total}<em>觀念</em></small><small>{row.coverage}%<em>完成</em></small></button>)}
          </div>
          {selectedTopic && <div className="topic-mobile-practice paper-card"><label><span>直接練習領域</span><select className="field-control" value={selectedTopic.name} onChange={(event) => setSelectedMapCategory(event.target.value)}>{analysis.blueprint.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label><div><button className="quiet-button" disabled={!selectedTopic.pendingIds.length} onClick={() => onStartQuestions(selectedTopic.pendingIds)}><Play size={14} />待複習 {selectedTopic.pendingCount}</button><button className="quiet-button" disabled={!selectedTopic.unansweredIds.length} onClick={() => onStartQuestions(selectedTopic.unansweredIds)}><Play size={14} />未作答 {selectedTopic.unansweredCount}</button><button className="quiet-button" disabled={!selectedTopic.allIds.length} onClick={() => onStartQuestions(selectedTopic.allIds)}><Play size={14} />全部 {selectedTopic.allCount}</button></div><button className="topic-mobile-browse text-action" onClick={() => onBrowseCategory(selectedTopic.name)}>查看此領域題目<ArrowRight size={15} /></button></div>}
        </article>

        <article className="analytics-card paper-card blueprint-performance">
          <header><div><h2>各領域作答進度</h2><p>完成至少 5 個觀念後，會顯示首次作答錯誤率</p></div><BarChart3 /></header>
          <div className="blueprint-legend"><span><i />已作答</span><span><i />未作答</span></div>
          <div className="blueprint-rows">{analysis.blueprint.map((row) => <button key={row.name} onClick={() => onBrowseCategory(row.name)}><span>{row.name}</span><div className="blueprint-track"><i style={{ width: `${row.coverage}%` }} /></div><strong>{row.coverage}%</strong><small>{row.attempted}/{row.total}</small><b>{row.firstScored < 5 || row.errorRate === null ? "錯誤率 —" : `首錯 ${row.errorRate}%`}</b><em className={row.pending ? "has-pending" : ""}>{row.pending} 待複習</em></button>)}</div>
        </article>

        <article className="analytics-card paper-card section-performance">
          <header><div><h2>Tintinalli 章節進度</h2><p>查看各章完成度、詳解閱讀進度與待複習題目</p></div><BookOpenText /></header>
          <div className="section-performance-head" aria-hidden="true"><span>章節</span><span>完成度</span><span>詳解已讀</span><span>待複習</span></div>
          <div className="section-performance-list">
            {analysis.sectionRows.map((row) => (
              <button key={row.id} onClick={() => onBrowseSourceSection(row.id)} aria-label={`Section ${row.id} ${row.label}，完成度 ${row.coverage}%，詳解已讀 ${row.readRate}%，${row.pending} 題待複習`}>
                <span><small>Section {row.id}</small><strong>{row.label}</strong></span>
                <span><i style={{ width: `${row.coverage}%` }} /><b>{row.coverage}%</b></span>
                <span><i style={{ width: `${row.readRate}%` }} /><b>{row.readRate}%</b></span>
                <em className={row.pending ? "has-pending" : ""}>{row.pending}</em>
              </button>
            ))}
          </div>
        </article>

        <article className="analytics-card paper-card overlap-performance">
          <header><div><h2>跨領域題目</h2><p>{analysis.crossDomainTotal.toLocaleString("zh-TW")} 個觀念同時涵蓋兩個以上章節</p></div><GitBranch /></header>
          <div className="overlap-list">
            {analysis.overlapRows.map((row) => <div className="paper-card" key={row.key}><span><b>Section {row.left}</b>{row.leftLabel}</span><i aria-hidden="true"><em style={{ width: `${row.count / Math.max(analysis.overlapRows[0]?.count ?? 1, 1) * 100}%` }} /></i><strong>{row.count}</strong><span><b>Section {row.right}</b>{row.rightLabel}</span></div>)}
          </div>
        </article>

        <article className="analytics-card paper-card confidence-chart">
          <header><div><h2>信心校準</h2><p>作答前信心與實際正確率</p></div><Target /></header>
          <div className="confidence-bars">{analysis.confidence.map((row) => <div key={row.level}><div className="vertical-bar"><i style={{ height: `${row.accuracy}%` }} /></div><strong>{row.total ? `${row.accuracy}%` : "—"}</strong><span>{row.level === "low" ? "不確定" : row.level === "high" ? "有把握" : "普通"}</span><small>{row.total} 次</small></div>)}</div>
        </article>

        <article className="analytics-card paper-card weekly-activity">
          <header><div><h2>最近 7 天</h2></div><CalendarDays /></header>
          <div className="activity-bars">{analysis.activity.map((day) => <div key={day.key}><strong>{day.count || ""}</strong><i style={{ height: `${Math.max(day.count ? 12 : 3, day.count / maxActivity * 100)}%` }} /><span>{day.label}</span></div>)}</div>
        </article>

        <article className="analytics-card paper-card exam-performance">
          <header><div><h2>年度／卷別成績</h2><p>分別查看作答進度與首次作答成績</p></div><BarChart3 /></header>
          <div className="exam-performance-list">
            {analysis.examRows.map((row) => <div key={row.id}><strong>{row.label}</strong><div className="exam-progress-track" aria-label={`${row.label}覆蓋率 ${row.coverage}%`}><i style={{ width: `${row.coverage}%` }} /></div><span>{row.answered} / {row.total}</span><b>{row.accuracy === null ? "—" : `${row.accuracy}%`}</b></div>)}
          </div>
        </article>

        <article className="analytics-card paper-card outcome-overview">
          <header><div><h2>作答結果分布</h2></div><PieChart /></header>
          <div className="outcome-layout">
            <div className="outcome-donut" role="img" aria-label={`答對 ${analysis.outcome.correct} 次，答錯 ${analysis.outcome.wrong} 次`}>
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <circle className="outcome-donut-track" cx="24" cy="24" r="20" pathLength="100" />
                <circle className="outcome-donut-value" cx="24" cy="24" r="20" pathLength="100" strokeDasharray={`${analysis.outcome.accuracy} ${100 - analysis.outcome.accuracy}`} />
              </svg>
              <span><strong>{analysis.outcome.accuracy || "—"}{analysis.outcome.correct + analysis.outcome.wrong ? "%" : ""}</strong><small>總正確率</small></span>
            </div>
            <dl><div><dt>答對</dt><dd>{analysis.outcome.correct}</dd></div><div><dt>答錯</dt><dd>{analysis.outcome.wrong}</dd></div><div><dt>待釐清錯題</dt><dd>{analysis.reading.pendingWrong}</dd></div></dl>
          </div>
        </article>

        <article className="analytics-card paper-card reading-overview">
          <header><div><h2>閱讀與收藏</h2></div><BookCheck /></header>
          <div className="reading-stats"><div><strong>{analysis.reading.done}</strong><span>已讀完</span></div><div><strong>{analysis.reading.later}</strong><span>稍後閱讀</span></div><div><strong>{analysis.reading.bookmarked}</strong><span>收藏題目</span></div></div>
          <div className="study-heatmap" aria-label="最近 28 天作答熱度">{analysis.heatmap.map((day) => <i key={day.key} title={`${day.label}：${day.count} 題`} data-level={day.count === 0 ? 0 : day.count < 10 ? 1 : day.count < 30 ? 2 : 3} />)}</div>
          <small className="heatmap-caption">最近 28 天作答紀錄・顏色越深代表當日題數越多</small>
        </article>

      </section>
    </main>
  );
}
