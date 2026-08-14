"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import StudyPlanPanel from "../components/study-plan-panel";
import { useMinuteClock } from "../hooks/use-minute-clock";
import { buildCanonicalConcepts } from "../lib/canonical-concepts";
import {
  formatExamEstimateDate,
  nextEmergencyBoardEstimate,
} from "../lib/exam-date-estimate";
import { questionBankArchiveRange } from "../lib/question-bank-summary";
import type { DailyStudyPlan, StudyPlanSettings } from "../lib/study-plan";
import { taiwanDateKey } from "../lib/taiwan-date";
import type { AttemptRecord, Manifest, NavView, ProgressRecord, QuestionIndex } from "../lib/types";

type Props = {
  manifest: Manifest;
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  attempts: AttemptRecord[];
  plan: DailyStudyPlan;
  planSettings: StudyPlanSettings;
  planReady: boolean;
  continueItem: { title: string; detail: string; actionLabel?: string; primary?: boolean; onOpen: () => void } | null;
  onNavigate: (view: NavView) => void;
  onBrowseCategory: (category: string) => void;
  onStartQuestions: (ids: string[]) => void;
  onUpdatePlanSettings: (value: StudyPlanSettings) => boolean;
};

const DASHBOARD_HEADLINES = [
  { lead: "整理今日進度，", accent: "安排下一輪複習" },
  { lead: "接上上次進度，", accent: "今天再往前一點" },
  { lead: "先處理到期觀念，", accent: "再挑一組新題" },
  { lead: "回到還沒釐清的地方，", accent: "把觀念慢慢補齊" },
  { lead: "從一題開始，", accent: "找出今天要讀的重點" },
  { lead: "題目、詳解與章節，", accent: "照自己的節奏接續" },
  { lead: "先看哪裡卡住，", accent: "再決定今天怎麼練" },
  { lead: "把錯題放回脈絡，", accent: "下一次就更好判斷" },
  { lead: "不急著刷完，", accent: "先把這一題真正讀懂" },
  { lead: "從最近的失分開始，", accent: "把弱點一個個收回來" },
  { lead: "今天先完成一小段，", accent: "進度就會繼續累積" },
  { lead: "先複習昨天忘的，", accent: "再學今天新的" },
  { lead: "找一個最需要補的主題，", accent: "從這裡繼續" },
  { lead: "重新看一次理由，", accent: "答案就不只是答案" },
  { lead: "把零散題目串起來，", accent: "看見同一個觀念" },
  { lead: "先做幾題暖身，", accent: "再進入今天的節奏" },
  { lead: "從年度試卷切入，", accent: "看看考點怎麼出現" },
  { lead: "打開最近讀過的章節，", accent: "把上下文接回來" },
  { lead: "留意反覆答錯的地方，", accent: "那就是今天的線索" },
  { lead: "讀完一題詳解，", accent: "順手補上一塊拼圖" },
  { lead: "今天不求讀很多，", accent: "只求下一步夠清楚" },
  { lead: "把待複習清單縮短一點，", accent: "就從最前面開始" },
  { lead: "先選一條學習路徑，", accent: "其他的留到下一輪" },
  { lead: "讓今天的練習，", accent: "替明天省下一點力氣" },
] as const;
const DASHBOARD_HEADLINE_STORAGE_KEY = "em-board-dashboard-headline-v1";

const workflowGroups: {
  id: string;
  index: string;
  title: string;
  detail: string;
  actions: {
    title: string;
    detail: string;
    view: NavView;
  }[];
}[] = [
  {
    id: "questions",
    index: "01",
    title: "題庫訓練",
    detail: "依目標選擇完整作答，或直接進入逐題詳解。",
    actions: [
      { title: "依年度完整作答", detail: "保留原試卷順序", view: "開始作答" as NavView },
      { title: "只閱讀逐題詳解", detail: "先選卷別，再選題目", view: "詳解閱讀" as NavView },
    ],
  },
  {
    id: "review",
    index: "02",
    title: "重點複習",
    detail: "集中處理待釐清觀念，再用主題分析確認弱項。",
    actions: [
      { title: "複習錯題與到期題", detail: "集中處理待釐清題目", view: "錯題本" as NavView },
      { title: "查看主題分析", detail: "掌握題庫分布與弱項", view: "學習分析" as NavView },
    ],
  },
  {
    id: "preparation",
    index: "03",
    title: "長程準備",
    detail: "串連章節脈絡、完訓課程與甄審進度。",
    actions: [
      { title: "章節學習指引", detail: "依章節建立臨床脈絡", view: "學習指引" as NavView },
      { title: "完訓與甄審", detail: "核對課程、證書與表單", view: "備考中心" as NavView },
    ],
  },
];

export default function DashboardView({
  manifest,
  questions,
  progressMap,
  attempts,
  plan,
  planSettings,
  planReady,
  continueItem,
  onNavigate,
  onBrowseCategory,
  onStartQuestions,
  onUpdatePlanSettings,
}: Props) {
  const [headline, setHeadline] = useState<(typeof DASHBOARD_HEADLINES)[number]>(DASHBOARD_HEADLINES[0]);
  const now = useMinuteClock();
  const examEstimate = useMemo(
    () => nextEmergencyBoardEstimate(taiwanDateKey(new Date(now))),
    [now],
  );
  const stats = useMemo(() => {
    const validRecent = attempts.filter((attempt) => attempt.correct !== null).slice(0, 50);
    const accuracy = validRecent.length
      ? Math.round(validRecent.filter((attempt) => attempt.correct === 1).length / validRecent.length * 100)
      : null;
    const byCategory = new Map<string, { correct: number; total: number }>();
    const concepts = buildCanonicalConcepts(
      questions.filter((question) => !question.excludedFromPractice),
      progressMap,
    );

    for (const concept of concepts) {
      const question = concept.anchor;
      const progress = concept.progress.latestRecord;
      if (progress?.firstAttemptCorrect === null || progress?.firstAttemptCorrect === undefined) continue;
      const current = byCategory.get(question.category) ?? { correct: 0, total: 0 };
      current.total += 1;
      current.correct += progress.firstAttemptCorrect;
      byCategory.set(question.category, current);
    }

    const weak = [...byCategory.entries()]
      .filter(([, value]) => value.total >= 5)
      .map(([name, value]) => ({
        name,
        count: value.total,
        accuracy: Math.round(value.correct / value.total * 100),
      }))
      .sort((left, right) => left.accuracy - right.accuracy)
      .slice(0, 3);

    return { accuracy, weak };
  }, [attempts, progressMap, questions]);

  const goal = Math.max(plan.goal, 1);
  const progressValue = Math.min(plan.completedToday, goal);
  const progressPercent = Math.round((progressValue / goal) * 100);
  const progressRadius = 72;
  const progressCircumference = 2 * Math.PI * progressRadius;
  const progressOffset = progressCircumference * (1 - progressPercent / 100);
  const categoryFallback = manifest.categories.slice(0, 3).map((category) => ({
    name: category.id,
    count: category.count,
    accuracy: null,
  }));
  const categories = stats.weak.length ? stats.weak : categoryFallback;
  const archiveRange = questionBankArchiveRange(manifest.groups);

  useEffect(() => {
    let previous = -1;
    try {
      previous = Number(window.localStorage.getItem(DASHBOARD_HEADLINE_STORAGE_KEY));
    } catch {
      // A fresh headline still works when storage is unavailable.
    }
    let next = (previous + 1) % DASHBOARD_HEADLINES.length;
    if (window.crypto?.getRandomValues) {
      const entropy = new Uint32Array(1);
      window.crypto.getRandomValues(entropy);
      next = entropy[0] % DASHBOARD_HEADLINES.length;
      if (next === previous) next = (next + 1) % DASHBOARD_HEADLINES.length;
    }
    const frame = window.requestAnimationFrame(() => setHeadline(DASHBOARD_HEADLINES[next]));
    try {
      window.localStorage.setItem(DASHBOARD_HEADLINE_STORAGE_KEY, String(next));
    } catch {
      // The selected copy can remain visit-only.
    }
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const startPrimary = () => {
    if (continueItem?.primary) {
      continueItem.onOpen();
      return;
    }
    if (plan.questionIds.length) {
      onStartQuestions(plan.questionIds);
      return;
    }
    onNavigate("開始作答");
  };

  return (
    <main className="dashboard-page instrument-dashboard">
      <section className="instrument-hero" aria-labelledby="instrument-dashboard-title">
        <div className="instrument-hero-copy">
          <p className="instrument-registration"><span>今日複習</span><b>DAILY STUDY / 01</b></p>
          <h1 id="instrument-dashboard-title">
            <span>{headline.lead}</span>
            <em>{headline.accent}</em>
          </h1>
          <p className="instrument-hero-lead">
            依作答紀錄安排下一輪練習，也可以直接按年度閱讀詳解。
          </p>
          {continueItem && (
            <p className="instrument-continuation">
              <span>CONTINUE</span>
              <strong>{continueItem.title}</strong>
              <small>{continueItem.detail}</small>
            </p>
          )}
          <div className="hero-actions instrument-hero-actions">
            <button className="primary-button" onClick={startPrimary}>
              {continueItem?.primary
                ? continueItem.actionLabel ?? "繼續作答"
                : plan.questionIds.length
                  ? `開始今日 ${plan.questionIds.length} 題`
                  : progressMap.size
                    ? "自由建立下一輪"
                    : "開始第一次複習"}
              <ArrowRight size={18} />
            </button>
          </div>
          <div className="instrument-archive-index" aria-label="題庫索引摘要">
            <span><b>{questions.length.toLocaleString("zh-TW")}</b><small>QUESTIONS</small></span>
            <span><b>{manifest.categories.length}</b><small>DISCIPLINES</small></span>
            <span><b>{archiveRange?.gregorianLabel ?? "歷屆"}</b><small>{archiveRange?.rocLabel ?? "BOARD ARCHIVE"}</small></span>
          </div>
        </div>

        <aside className="instrument-progress-plate" aria-label="今日學習狀態">
          <header>
            <span>STUDY STATUS</span>
            <small>今日進度</small>
          </header>
          <div
            className="instrument-progress-ring"
            role="progressbar"
            aria-label="今日作答目標"
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuenow={progressValue}
          >
            <svg viewBox="0 0 176 176" aria-hidden="true">
              <circle className="instrument-progress-ring-track" cx="88" cy="88" r={progressRadius} />
              <circle
                className="instrument-progress-ring-value"
                cx="88"
                cy="88"
                r={progressRadius}
                pathLength={progressCircumference}
                strokeDasharray={progressCircumference}
                strokeDashoffset={progressOffset}
              />
            </svg>
            <span><strong>{progressValue}</strong><small>/ {goal}</small></span>
          </div>
          <dl>
            <div><dt>今日到期</dt><dd>{plan.dueBacklog}<small>觀念</small></dd></div>
            <div><dt>近期正確率</dt><dd>{stats.accuracy === null ? "—" : `${stats.accuracy}%`}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="instrument-status-strip" aria-label="學習摘要">
        <article>
          <span>STATUS 01</span>
          <p>今日進度</p>
          <strong>{plan.remaining === 0 ? "目標已完成" : `尚餘 ${plan.remaining} 個概念`}</strong>
        </article>
        <article>
          <span>STATUS 02</span>
          <p>最近 50 次計分作答</p>
          <strong>{stats.accuracy === null ? "完成作答後開始統計" : `正確率 ${stats.accuracy}%`}</strong>
        </article>
        <article>
          <span>STATUS 03</span>
          <p>專科題庫範圍</p>
          <strong>{manifest.categories.length} 類 · {questions.length.toLocaleString("zh-TW")} 題</strong>
        </article>
      </section>

      <StudyPlanPanel
        plan={plan}
        settings={planSettings}
        ready={planReady}
        onStartQuestions={onStartQuestions}
        onUpdateSettings={onUpdatePlanSettings}
      />

      <section className="instrument-dashboard-lower">
        <article className="instrument-topic-index" aria-labelledby="instrument-topic-index-title">
          <header>
            <p><span>CLINICAL INDEX</span>主題索引</p>
            <h2 id="instrument-topic-index-title">{stats.weak.length ? "優先回看的主題" : "從一個主題開始"}</h2>
          </header>
          <div>
            {categories.map((category, index) => (
              <button key={category.name} onClick={() => onBrowseCategory(category.name)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{category.name}</strong>
                <small>{category.accuracy === null ? `${category.count} 題` : `${category.accuracy}%`}</small>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </article>

        <article className="instrument-exam-notice" aria-labelledby="instrument-exam-title">
          <p><span>OFFICIAL NOTICE</span>專科甄審</p>
          <h2 id="instrument-exam-title">最新甄審簡章與考試日期</h2>
          <div
            className="instrument-exam-countdown"
            role="status"
            aria-label={`${examEstimate.rocYear} 年度預估${examEstimate.milestone === "written" ? "筆試" : "口試"}倒數 ${examEstimate.daysRemaining} 天`}
          >
            <span>{examEstimate.rocYear} 年度預估</span>
            <strong>{examEstimate.daysRemaining}<small>天</small></strong>
            <small>距預估{examEstimate.milestone === "written" ? "筆試" : "口試"}</small>
          </div>
          <dl className="instrument-exam-dates">
            <div><dt>預估筆試</dt><dd>{formatExamEstimateDate(examEstimate.writtenDate)}</dd></div>
            <div><dt>預估口試</dt><dd>{formatExamEstimateDate(examEstimate.oralDate)}</dd></div>
          </dl>
          <p className="instrument-exam-method">推估依據：111–115 年公告日期規律。</p>
          <a href="https://www.sem.org.tw/News/7/Index" target="_blank" rel="noopener noreferrer">
            查看學會公告
            <ExternalLink size={15} />
          </a>
        </article>
      </section>

      <section className="quick-start instrument-route-index" aria-label="學習路徑">
        <header>
          <p><span>WORKFLOW INDEX</span>學習路徑</p>
          <h2>用三條工作流，找到下一步</h2>
        </header>
        <div>
          <div className="quick-start" aria-label="題庫訓練、重點複習與長程準備">
            {workflowGroups.map((group) => {
              const [primaryAction, secondaryAction] = group.actions;
              return (
                <article
                  className="setup-panel paper-card"
                  data-workflow={group.id}
                  aria-labelledby={`dashboard-workflow-${group.id}`}
                  key={group.id}
                >
                  <p className="eyebrow"><span />WORKFLOW {group.index}</p>
                  <h3 id={`dashboard-workflow-${group.id}`}>{group.title}</h3>
                  <p>{group.detail}</p>
                  <div className="hero-actions">
                    {primaryAction && (
                      <button type="button" className="primary-button" onClick={() => onNavigate(primaryAction.view)}>
                        {primaryAction.title}
                        <ArrowRight size={17} />
                      </button>
                    )}
                    {secondaryAction && (
                      <button type="button" className="text-action" onClick={() => onNavigate(secondaryAction.view)}>
                        {secondaryAction.title}
                        <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                  <small>{primaryAction?.detail} · {secondaryAction?.detail}</small>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
