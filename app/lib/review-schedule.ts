import type { Confidence } from "./types";

export type ReviewScheduleState = {
  streak: number;
  dueAt: string | null;
  wrongState: "none" | "pending" | "mastered";
};

export function isChronologicallyOlder(lastAttemptAt: string | null, answeredAt: string) {
  if (!lastAttemptAt) return false;
  const previousTime = Date.parse(lastAttemptAt);
  const answeredTime = Date.parse(answeredAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(answeredTime)) throw new Error("invalid attempt timestamp");
  return answeredTime < previousTime;
}

type ScheduleReviewInput = {
  previous: ReviewScheduleState;
  correct: boolean | null;
  confidence: Confidence;
  answeredAt: string;
};

function addUtcDays(iso: string, days: number) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid answeredAt");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function scheduleReview({ previous, correct, confidence, answeredAt }: ScheduleReviewInput): ReviewScheduleState & { intervalDays: number | null } {
  if (correct === null) return { ...previous, intervalDays: null };

  const streak = correct ? Math.max(0, previous.streak) + 1 : 0;
  const baseDays = confidence === "low" ? 3 : confidence === "high" ? 14 : 7;
  const intervalDays = correct
    ? Math.min(baseDays * Math.max(1, 2 ** Math.max(0, streak - 1)), 120)
    : 1;
  const wrongState = !correct
    ? "pending" as const
    : previous.wrongState === "pending" && streak >= 2
      ? "mastered" as const
      : previous.wrongState;

  return {
    streak,
    wrongState,
    dueAt: addUtcDays(answeredAt, intervalDays),
    intervalDays,
  };
}
