import { buildCanonicalConcepts } from "./canonical-concepts.ts";
import type { AttemptRecord, ProgressRecord, QuestionIndex } from "./types";

export type StudyPlanSettings = {
  schemaVersion: 1;
  dailyGoal: number;
  maxNewPerDay: number;
  sessionSize: number;
  categoryIds: string[];
};

export type DailyStudyTask = {
  id: "due" | "weak" | "new";
  title: string;
  detail: string;
  questionIds: string[];
  category: string | null;
};

export type DailyStudyPlan = {
  dateKey: string;
  completedToday: number;
  goal: number;
  remaining: number;
  dueBacklog: number;
  pendingWrong: number;
  newIntroducedToday: number;
  weakestCategory: { name: string; accuracy: number; sample: number } | null;
  tasks: DailyStudyTask[];
  questionIds: string[];
};

export const DEFAULT_STUDY_PLAN_SETTINGS: StudyPlanSettings = {
  schemaVersion: 1,
  dailyGoal: 30,
  maxNewPerDay: 10,
  sessionSize: 10,
  categoryIds: [],
};

export function normalizeStudyPlanSettings(value: unknown, categories: string[] = []): StudyPlanSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_STUDY_PLAN_SETTINGS };
  const input = value as Partial<StudyPlanSettings>;
  const allowed = new Set(categories);
  const clamp = (candidate: unknown, minimum: number, maximum: number, fallback: number) => {
    const number = Number(candidate);
    return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  };
  return {
    schemaVersion: 1,
    dailyGoal: clamp(input.dailyGoal, 5, 100, DEFAULT_STUDY_PLAN_SETTINGS.dailyGoal),
    maxNewPerDay: clamp(input.maxNewPerDay, 0, 50, DEFAULT_STUDY_PLAN_SETTINGS.maxNewPerDay),
    sessionSize: clamp(input.sessionSize, 5, 30, DEFAULT_STUDY_PLAN_SETTINGS.sessionSize),
    categoryIds: Array.isArray(input.categoryIds)
      ? [...new Set(input.categoryIds.filter((item): item is string => typeof item === "string" && allowed.has(item)))].sort((left, right) => left.localeCompare(right, "zh-Hant"))
      : [],
  };
}

export function localDateKey(value: string | Date, timeZone = "Asia/Taipei") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function stableScore(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function canonicalConcepts(questions: QuestionIndex[], progressMap: Map<string, ProgressRecord>, now: string) {
  return buildCanonicalConcepts(
    questions.filter((question) => !question.excludedFromPractice && !question.allCredit),
    progressMap,
    now,
  ).map((concept) => ({
    key: concept.id,
    question: concept.representative,
    category: concept.anchor.category,
    progress: concept.progress.latestRecord ?? undefined,
    canonicalProgress: concept.progress,
    memberIds: concept.memberIds,
    lifetimeAttempts: concept.progress.attempts,
  }));
}

function weakestCategory(concepts: ReturnType<typeof canonicalConcepts>) {
  const rows = new Map<string, { correct: number; total: number }>();
  for (const concept of concepts) {
    const first = concept.progress?.firstAttemptCorrect;
    if (first === null || first === undefined) continue;
    const row = rows.get(concept.category) ?? { correct: 0, total: 0 };
    row.total += 1;
    row.correct += first;
    rows.set(concept.category, row);
  }
  return [...rows.entries()]
    .filter(([, row]) => row.total >= 5)
    .map(([name, row]) => ({ name, accuracy: Math.round(row.correct / row.total * 100), sample: row.total }))
    .sort((left, right) => left.accuracy - right.accuracy || right.sample - left.sample || left.name.localeCompare(right.name, "zh-Hant"))[0] ?? null;
}

export function buildDailyStudyPlan({
  questions,
  progressMap,
  attempts,
  settings,
  now,
  timeZone = "Asia/Taipei",
}: {
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  attempts: AttemptRecord[];
  settings: StudyPlanSettings;
  now: string;
  timeZone?: string;
}): DailyStudyPlan {
  const normalized = normalizeStudyPlanSettings(settings, [...new Set(questions.map((question) => question.category))]);
  const dateKey = localDateKey(now, timeZone);
  const concepts = canonicalConcepts(questions, progressMap, now);
  const conceptByQuestion = new Map<string, string>();
  for (const concept of concepts) {
    for (const questionId of concept.memberIds) conceptByQuestion.set(questionId, concept.key);
  }
  const todayAttemptCounts = new Map<string, number>();
  for (const attempt of attempts) {
    if (typeof attempt.createdAt !== "string" || !Number.isFinite(Date.parse(attempt.createdAt))) continue;
    if (localDateKey(attempt.createdAt, timeZone) !== dateKey) continue;
    const key = conceptByQuestion.get(attempt.questionId);
    if (key) todayAttemptCounts.set(key, (todayAttemptCounts.get(key) ?? 0) + 1);
  }
  const completedKeys = new Set(todayAttemptCounts.keys());
  const newIntroducedToday = concepts.filter((concept) => {
    const todayCount = todayAttemptCounts.get(concept.key) ?? 0;
    return todayCount > 0 && concept.lifetimeAttempts <= todayCount;
  }).length;
  const remaining = Math.max(0, normalized.dailyGoal - completedKeys.size);
  const eligible = concepts.filter((concept) => !completedKeys.has(concept.key));
  const due = eligible.filter((concept) => concept.canonicalProgress.due);
  const dueOrder = (left: typeof due[number], right: typeof due[number]) => {
    const leftHighWrong = left.progress?.lastCorrect === 0 && left.progress.lastConfidence === "high" ? 0 : 1;
    const rightHighWrong = right.progress?.lastCorrect === 0 && right.progress.lastConfidence === "high" ? 0 : 1;
    const leftPending = left.progress?.wrongState === "pending" ? 0 : 1;
    const rightPending = right.progress?.wrongState === "pending" ? 0 : 1;
    return leftHighWrong - rightHighWrong
      || leftPending - rightPending
      || (Date.parse(left.progress?.dueAt ?? "") || 0) - (Date.parse(right.progress?.dueAt ?? "") || 0)
      || left.question.id.localeCompare(right.question.id);
  };
  due.sort(dueOrder);

  // The daily goal can span several rounds. Build only the next bounded round
  // so the primary CTA and every task respect the user's session-size choice.
  const roundCapacity = Math.min(remaining, normalized.sessionSize);
  const selectedDue = due.slice(0, roundCapacity);
  const selectedKeys = new Set(selectedDue.map((concept) => concept.key));
  let capacity = Math.max(0, roundCapacity - selectedDue.length);
  const weak = weakestCategory(concepts);
  const weakCandidates = weak
    ? eligible.filter((concept) => !selectedKeys.has(concept.key) && concept.category === weak.name && concept.lifetimeAttempts === 0)
    : [];
  weakCandidates.sort((left, right) => stableScore(`${dateKey}:${left.key}`) - stableScore(`${dateKey}:${right.key}`) || left.question.id.localeCompare(right.question.id));
  const newBudget = Math.max(0, normalized.maxNewPerDay - newIntroducedToday);
  const selectedWeak = weakCandidates.slice(0, Math.min(capacity, normalized.sessionSize, newBudget));
  for (const concept of selectedWeak) selectedKeys.add(concept.key);
  capacity -= selectedWeak.length;

  const allowedCategories = normalized.categoryIds.length ? new Set(normalized.categoryIds) : null;
  const newCandidates = eligible.filter((concept) => (
    concept.lifetimeAttempts === 0
    && !selectedKeys.has(concept.key)
    && (!allowedCategories || allowedCategories.has(concept.category))
  ));
  newCandidates.sort((left, right) => stableScore(`${dateKey}:new:${left.key}`) - stableScore(`${dateKey}:new:${right.key}`) || left.question.id.localeCompare(right.question.id));
  const remainingNewBudget = Math.max(0, newBudget - selectedWeak.length);
  const selectedNew = newCandidates.slice(0, Math.min(capacity, remainingNewBudget));

  const tasks: DailyStudyTask[] = [];
  if (selectedDue.length) tasks.push({
    id: "due",
    title: "到期複習",
    detail: `依逾期時間與高信心錯題優先，共 ${selectedDue.length} 題。`,
    questionIds: selectedDue.map((concept) => concept.question.id),
    category: null,
  });
  if (selectedWeak.length && weak) tasks.push({
    id: "weak",
    title: `補強「${weak.name}」`,
    detail: `目前基準 ${weak.accuracy}%（${weak.sample} 題），先用新題確認弱點。`,
    questionIds: selectedWeak.map((concept) => concept.question.id),
    category: weak.name,
  });
  if (selectedNew.length) tasks.push({
    id: "new",
    title: weak ? "擴大新題覆蓋" : "建立學習基準",
    detail: weak ? `今日再加入 ${selectedNew.length} 個未作答概念。` : `先完成 ${selectedNew.length} 題，累積足夠資料後再判讀弱項。`,
    questionIds: selectedNew.map((concept) => concept.question.id),
    category: null,
  });

  return {
    dateKey,
    completedToday: completedKeys.size,
    goal: normalized.dailyGoal,
    remaining,
    dueBacklog: due.length,
    pendingWrong: concepts.filter((concept) => concept.canonicalProgress.pending).length,
    newIntroducedToday,
    weakestCategory: weak,
    tasks,
    questionIds: tasks.flatMap((task) => task.questionIds),
  };
}
