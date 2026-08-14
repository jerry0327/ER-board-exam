import type {
  DisasterCourseRecognition,
  DisasterRecognitionKind,
  RegionalDisasterCourse,
} from "./remoc-course-data.ts";

export type RemocCourseCompletionRecord = {
  key: string;
  title: string;
  dateLabel: string;
  startDate: string;
  location: string;
  sourceUrl: string;
  completedAt: string;
  recognitions: DisasterCourseRecognition[];
};

export type RemocCourseProgress = {
  introHours: number;
  hazmatHours: number;
  nuclearHours: number;
  otherHours: number;
  exerciseHours: number;
  exerciseCount: number;
  exerciseKinds: Array<"exercise-dmat" | "exercise-hospital" | "exercise-special">;
  courseCount: number;
};

const allowedKinds = new Set<DisasterRecognitionKind>([
  "intro",
  "hazmat",
  "nuclear",
  "other",
  "exercise-dmat",
  "exercise-hospital",
  "exercise-special",
]);

const checklistItemByKind: Record<DisasterRecognitionKind, DisasterCourseRecognition["checklistItemId"]> = {
  intro: "disaster.intro",
  hazmat: "disaster.hazmat-6h",
  nuclear: "disaster.nuclear-6h",
  other: "disaster.other-6h",
  "exercise-dmat": "disaster.drills-3",
  "exercise-hospital": "disaster.drills-3",
  "exercise-special": "disaster.drills-3",
};

function safeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeIsoDate(value: unknown) {
  const text = safeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : "";
}

function safeCourseUrl(value: unknown) {
  const text = safeText(value, 1000);
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizedCourseIdentity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/\b(?:19|20)\d{2}\b/gu, "")
    .replace(/\d{3}\s*年度?/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 220);
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function remocCourseCompletionKey(course: Pick<RegionalDisasterCourse, "title" | "startDate" | "location">) {
  return `remoc-course-${simpleHash(`${course.startDate}|${normalizedCourseIdentity(course.title)}`)}`;
}

export function recognizedHoursFromText(value: string) {
  const normalized = value.normalize("NFKC");
  const explicitTotal = /(?:總計|合計|共計|共)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:小時|時數|hours?|hrs?|hr)/iu.exec(normalized);
  if (explicitTotal) return Number(explicitTotal[1]);
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:小時|時數|hours?|hrs?|hr)/giu)];
  const total = matches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0);
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
}

export function buildRemocCourseCompletionRecord(course: RegionalDisasterCourse, completedAt: string): RemocCourseCompletionRecord | null {
  if (course.recognitionStatus !== "recognized") return null;
  const date = safeIsoDate(completedAt);
  const sourceUrl = safeCourseUrl(course.sourceUrl);
  if (!date || !sourceUrl || !course.recognitions.length) return null;
  return {
    key: remocCourseCompletionKey(course),
    title: safeText(course.title),
    dateLabel: safeText(course.dateLabel, 100),
    startDate: safeIsoDate(course.startDate),
    location: safeText(course.location),
    sourceUrl,
    completedAt: date,
    recognitions: course.recognitions.map((recognition) => ({ ...recognition })),
  };
}

function normalizeRecognition(value: unknown): DisasterCourseRecognition | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<DisasterCourseRecognition>;
  const kind = allowedKinds.has(input.kind as DisasterRecognitionKind) ? input.kind as DisasterRecognitionKind : null;
  const label = safeText(input.label, 160);
  const hoursText = safeText(input.hoursText, 120);
  if (!kind || !label || !hoursText || input.checklistItemId !== checklistItemByKind[kind]) return null;
  return { kind, label, hoursText, checklistItemId: input.checklistItemId };
}

export function normalizeRemocCourseCompletionRecords(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, RemocCourseCompletionRecord>;
  const records: Record<string, RemocCourseCompletionRecord> = {};
  for (const candidate of Object.values(value).slice(0, 250)) {
    if (!candidate || typeof candidate !== "object") continue;
    const input = candidate as Partial<RemocCourseCompletionRecord>;
    const title = safeText(input.title);
    const dateLabel = safeText(input.dateLabel, 100);
    const startDate = safeIsoDate(input.startDate);
    const location = safeText(input.location);
    const sourceUrl = safeCourseUrl(input.sourceUrl);
    const completedAt = safeIsoDate(input.completedAt);
    const recognitions = Array.isArray(input.recognitions)
      ? input.recognitions.slice(0, 12).map(normalizeRecognition).filter((entry): entry is DisasterCourseRecognition => entry !== null)
      : [];
    if (!title || !dateLabel || !startDate || !location || !sourceUrl || !completedAt || !recognitions.length) continue;
    const key = remocCourseCompletionKey({ title, startDate, location });
    records[key] = { key, title, dateLabel, startDate, location, sourceUrl, completedAt, recognitions };
  }
  return records;
}

export function summarizeRemocCourseProgress(records: Iterable<RemocCourseCompletionRecord>): RemocCourseProgress {
  const summary: RemocCourseProgress = {
    introHours: 0,
    hazmatHours: 0,
    nuclearHours: 0,
    otherHours: 0,
    exerciseHours: 0,
    exerciseCount: 0,
    exerciseKinds: [],
    courseCount: 0,
  };
  const exerciseKinds = new Set<"exercise-dmat" | "exercise-hospital" | "exercise-special">();
  for (const record of records) {
    summary.courseCount += 1;
    for (const recognition of record.recognitions) {
      const hours = recognizedHoursFromText(recognition.hoursText);
      if (recognition.kind === "intro") summary.introHours += hours;
      else if (recognition.kind === "hazmat") summary.hazmatHours += hours;
      else if (recognition.kind === "nuclear") summary.nuclearHours += hours;
      else if (recognition.kind === "other") summary.otherHours += hours;
      else {
        summary.exerciseHours += hours;
        exerciseKinds.add(recognition.kind);
      }
    }
  }
  summary.exerciseKinds = [...exerciseKinds].sort();
  summary.exerciseCount = summary.exerciseKinds.length;
  for (const key of ["introHours", "hazmatHours", "nuclearHours", "otherHours", "exerciseHours"] as const) {
    summary[key] = Math.round(summary[key] * 100) / 100;
  }
  return summary;
}

export function remocCourseProgressTargets(quotaYear: number) {
  if (quotaYear >= 112) return { mode: "modern", introHours: 16, hazmatHours: 6, nuclearHours: 6, otherHours: 6, exerciseCount: 3 } as const;
  if (quotaYear >= 108) return { mode: "special-24h", introHours: 16, hazmatHours: 8, nuclearHours: 8, otherHours: 8, specialHours: 24, exerciseCount: 3 } as const;
  return { mode: "basic-14h", courseHours: 14, exerciseHours: 8 } as const;
}

export function completedExerciseEntries(records: Iterable<RemocCourseCompletionRecord>) {
  const entries = new Map<"exercise-dmat" | "exercise-hospital" | "exercise-special", { kind: "exercise-dmat" | "exercise-hospital" | "exercise-special"; label: string; title: string; completedAt: string }>();
  for (const record of records) {
    for (const recognition of record.recognitions) {
      if (recognition.kind !== "exercise-dmat" && recognition.kind !== "exercise-hospital" && recognition.kind !== "exercise-special") continue;
      if (!entries.has(recognition.kind)) entries.set(recognition.kind, { kind: recognition.kind, label: recognition.label, title: record.title, completedAt: record.completedAt });
    }
  }
  return [...entries.values()];
}
