"use client";

import { ArrowRight, CheckCircle2, Clock3, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import type { DailyStudyPlan, StudyPlanSettings } from "../lib/study-plan";

type ContinueItem = { title: string; detail: string; actionLabel?: string; primary?: boolean; onOpen: () => void } | null;

type Props = {
  plan: DailyStudyPlan;
  settings: StudyPlanSettings;
  ready: boolean;
  compact?: boolean;
  continueItem?: ContinueItem;
  onUpdateSettings: (value: StudyPlanSettings) => boolean;
  onStartQuestions: (ids: string[]) => void;
};

const taskIcons = { due: RotateCcw, weak: Sparkles, new: CheckCircle2 } as const;

export default function StudyPlanPanel({ plan, settings, ready, compact = false, continueItem = null, onUpdateSettings, onStartQuestions }: Props) {
  const completed = Math.min(plan.completedToday, plan.goal);
  const percent = plan.goal ? Math.round(completed / plan.goal * 100) : 0;
  return (
    <section className={`daily-plan-board paper-card ${compact ? "compact" : ""}`} aria-labelledby="daily-plan-heading">
      <header>
        <div>
          <p className="eyebrow"><span />今日任務</p>
          <h2 id="daily-plan-heading">今天的複習安排</h2>
          <p>先完成到期複習，再練習近期較常答錯的主題。</p>
        </div>
        <div className="daily-plan-progress" role="progressbar" aria-label="今日學習計畫完成度" aria-valuemin={0} aria-valuemax={plan.goal} aria-valuenow={completed}>
          <strong>{completed}<small> / {plan.goal}</small></strong>
          <span><i style={{ width: `${percent}%` }} /></span>
          <small>{plan.remaining ? `尚餘 ${plan.remaining} 個概念` : "今日目標已完成"}</small>
        </div>
      </header>

      <ol className="daily-plan-tasks">
        {plan.tasks.map((task) => {
          const Icon = taskIcons[task.id];
          return <li key={task.id}><Icon /><div><strong>{task.title}</strong><span>{task.detail}</span></div><button className="outline-button" onClick={() => onStartQuestions(task.questionIds)}>開始 {task.questionIds.length} 題<ArrowRight /></button></li>;
        })}
        {continueItem && <li className="continue-task"><Clock3 /><div><strong>{continueItem.title}</strong><span>{continueItem.detail}</span></div><button className="outline-button" onClick={continueItem.onOpen}>{continueItem.actionLabel ?? "繼續閱讀"}<ArrowRight /></button></li>}
        {!plan.tasks.length && !continueItem && <li className="daily-plan-complete"><CheckCircle2 /><div><strong>今日計畫已完成</strong><span>可繼續閱讀詳解或學習指引。</span></div></li>}
      </ol>

      {!compact && <div className="daily-plan-settings" aria-label="今日計畫偏好">
        <SlidersHorizontal />
        <label>每日目標<select disabled={!ready} value={settings.dailyGoal} onChange={(event) => onUpdateSettings({ ...settings, dailyGoal: Number(event.target.value) })}><option value={10}>10 題</option><option value={20}>20 題</option><option value={30}>30 題</option><option value={50}>50 題</option><option value={100}>100 題</option></select></label>
        <label>每日最多新題<select disabled={!ready} value={settings.maxNewPerDay} onChange={(event) => onUpdateSettings({ ...settings, maxNewPerDay: Number(event.target.value) })}><option value={5}>5 題</option><option value={10}>10 題</option><option value={20}>20 題</option><option value={30}>30 題</option><option value={50}>50 題</option></select></label>
        <label>單輪題數<select disabled={!ready} value={settings.sessionSize} onChange={(event) => onUpdateSettings({ ...settings, sessionSize: Number(event.target.value) })}><option value={5}>5 題</option><option value={10}>10 題</option><option value={20}>20 題</option><option value={30}>30 題</option></select></label>
        <small>{ready ? "選擇適合自己的題數。" : "請稍候…"}</small>
      </div>}
    </section>
  );
}
