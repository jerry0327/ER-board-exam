export const SEM_RECOGNITION_FORMS_URL = "https://www.sem.org.tw/Doc/%E5%90%84%E9%A1%9E%E8%A1%A8%E5%96%AE";
export const SEM_RECOGNITION_CURRENT_FILE_URL = "https://tsem.blob.core.windows.net/docfilecontainer/%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E6%99%82%E6%95%B8%E8%AA%8D%E8%AD%89%E6%B8%85%E5%96%AE%281150715%E6%9B%B4%E6%96%B0%29.xlsx";

export type RecognitionCategory = "intro" | "hazmat" | "nuclear" | "other";
export type ExerciseCategory = "dmat" | "hospital" | "special";

export type RecognitionHours = Record<RecognitionCategory, number>;
export type ExerciseHours = Record<ExerciseCategory, number>;

export type SemRecognizedCourse = {
  id: string;
  sheet: string;
  rocYear: number;
  dateRaw: string;
  startDate: string;
  endDate: string;
  location: string;
  title: string;
  hours: RecognitionHours;
  exerciseHours: ExerciseHours;
  exerciseKinds: ExerciseCategory[];
  rawRecognition: Record<RecognitionCategory | ExerciseCategory, string>;
  sourceUrl: string;
  sourceRevision: string;
};

export type SemRecognitionFeed = {
  status: "live" | "partial" | "snapshot";
  updatedAt: string;
  sourceUrl: string;
  sourceRevision: string;
  courses: SemRecognizedCourse[];
};

export type RecognizedCourseCompletion = {
  courseId: string;
  completedAt: string;
  certificateNumber: string;
  note: string;
  snapshot: SemRecognizedCourse;
  updatedAt: string;
};

export const recognitionLabels: Record<RecognitionCategory, string> = {
  intro: "初階災難",
  hazmat: "毒化災",
  nuclear: "核災",
  other: "其他認列",
};

export const exerciseLabels: Record<ExerciseCategory, string> = {
  dmat: "災難醫療隊／大量傷患",
  hospital: "醫院緊急應變",
  special: "特殊災害",
};

const emptyHours = (): RecognitionHours => ({ intro: 0, hazmat: 0, nuclear: 0, other: 0 });
const emptyExerciseHours = (): ExerciseHours => ({ dmat: 0, hospital: 0, special: 0 });

export function normalizeCourseSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function parseRecognizedHours(value: string) {
  if (!value || /不予認列|不認列/u.test(value)) return 0;
  let total = 0;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*小時/gu)) total += Number(match[1]);
  if (!total && /^\s*\d+(?:\.\d+)?\s*$/u.test(value)) total = Number(value.trim());
  return Number(total.toFixed(2));
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isoDate(rocYear: number, month: number, day: number) {
  const year = rocYear + 1911;
  return validDate(year, month, day)
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : "";
}

export function parseRocDateRange(value: string) {
  const cleaned = value.normalize("NFKC").replace(/\/+/gu, "/");
  const rescheduled = /改期\s*(\d{2,3})\/(\d{1,2})\/(\d{1,2})/u.exec(cleaned);
  if (rescheduled) {
    const startDate = isoDate(Number(rescheduled[1]), Number(rescheduled[2]), Number(rescheduled[3]));
    return { startDate, endDate: startDate };
  }
  const start = /(\d{2,3})\/(\d{1,2})\/(\d{1,2})/u.exec(cleaned);
  if (!start) return { startDate: "", endDate: "" };
  const rocYear = Number(start[1]);
  const month = Number(start[2]);
  const day = Number(start[3]);
  const startDate = isoDate(rocYear, month, day);
  const remainder = cleaned.slice((start.index ?? 0) + start[0].length);
  const fullEnd = /-\s*(\d{2,3})\/(\d{1,2})\/(\d{1,2})/u.exec(remainder);
  const shortEnd = /-\s*(\d{1,2})\/(\d{1,2})/u.exec(remainder);
  const endDate = fullEnd
    ? isoDate(Number(fullEnd[1]), Number(fullEnd[2]), Number(fullEnd[3]))
    : shortEnd
      ? isoDate(rocYear, Number(shortEnd[1]), Number(shortEnd[2]))
      : startDate;
  return { startDate, endDate: endDate || startDate };
}

export function recognizedCourseFromRow(
  sheet: string,
  row: unknown[],
  sourceUrl: string,
  sourceRevision: string,
): SemRecognizedCourse | null {
  const cells = Array.from({ length: 10 }, (_, index) => String(row[index] ?? "").trim());
  const [dateRaw, location, title, intro, hazmat, nuclear, other, dmat, hospital, special] = cells;
  if (!dateRaw || !title || /課程取消/u.test(`${dateRaw} ${title}`) || /課程日期/u.test(dateRaw)) return null;
  const rawRecognition = { intro, hazmat, nuclear, other, dmat, hospital, special };
  const hours: RecognitionHours = {
    intro: parseRecognizedHours(intro),
    hazmat: parseRecognizedHours(hazmat),
    nuclear: parseRecognizedHours(nuclear),
    other: parseRecognizedHours(other),
  };
  const exerciseHours: ExerciseHours = {
    dmat: parseRecognizedHours(dmat),
    hospital: parseRecognizedHours(hospital),
    special: parseRecognizedHours(special),
  };
  const exerciseKinds = (["dmat", "hospital", "special"] as ExerciseCategory[])
    .filter((kind) => Boolean(rawRecognition[kind]) && !/不予認列|不認列/u.test(rawRecognition[kind]));
  if (!Object.values(hours).some((value) => value > 0) && !exerciseKinds.length) return null;
  const { startDate, endDate } = parseRocDateRange(dateRaw);
  const sheetYear = Number(/\d{2,3}/u.exec(sheet)?.[0] ?? "0");
  const rocYear = startDate ? Number(startDate.slice(0, 4)) - 1911 : sheetYear;
  // The workbook can list different sessions with the same course title and
  // date.  Include the venue so those sessions remain separate records.
  const identity = [startDate || dateRaw, normalizeCourseSearchText(title), normalizeCourseSearchText(location)].join("|");
  return {
    id: `sem-course-${stableHash(identity)}`,
    sheet,
    rocYear,
    dateRaw,
    startDate,
    endDate,
    location,
    title,
    hours,
    exerciseHours,
    exerciseKinds,
    rawRecognition,
    sourceUrl,
    sourceRevision,
  };
}

export function groupRecognizedCourses(courses: SemRecognizedCourse[]) {
  const grouped = new Map<string, SemRecognizedCourse>();
  const seenRows = new Map<string, Set<string>>();
  for (const course of courses) {
    const rowSignature = [
      course.startDate || normalizeCourseSearchText(course.dateRaw),
      course.endDate,
      normalizeCourseSearchText(course.location),
      normalizeCourseSearchText(course.title),
      ...(["intro", "hazmat", "nuclear", "other", "dmat", "hospital", "special"] as const)
        .map((key) => normalizeCourseSearchText(course.rawRecognition[key])),
    ].join("|");
    const signatures = seenRows.get(course.id) ?? new Set<string>();
    if (signatures.has(rowSignature)) continue;
    signatures.add(rowSignature);
    seenRows.set(course.id, signatures);
    const current = grouped.get(course.id);
    if (!current) {
      grouped.set(course.id, course);
      continue;
    }
    const hours = { ...current.hours };
    const exerciseHours = { ...current.exerciseHours };
    const rawRecognition = { ...current.rawRecognition };
    for (const key of ["intro", "hazmat", "nuclear", "other"] as RecognitionCategory[]) {
      hours[key] = Number((hours[key] + course.hours[key]).toFixed(2));
      rawRecognition[key] = [rawRecognition[key], course.rawRecognition[key]].filter(Boolean).join("；");
    }
    for (const key of ["dmat", "hospital", "special"] as ExerciseCategory[]) {
      exerciseHours[key] = Number((exerciseHours[key] + course.exerciseHours[key]).toFixed(2));
      rawRecognition[key] = [rawRecognition[key], course.rawRecognition[key]].filter(Boolean).join("；");
    }
    grouped.set(course.id, {
      ...current,
      endDate: [current.endDate, course.endDate].filter(Boolean).sort().at(-1) ?? current.endDate,
      location: current.location || course.location,
      hours,
      exerciseHours,
      exerciseKinds: [...new Set([...current.exerciseKinds, ...course.exerciseKinds])],
      rawRecognition,
    });
  }
  return mergeRecognizedCourses([...grouped.values()]);
}

export function mergeRecognizedCourses(...groups: SemRecognizedCourse[][]) {
  const merged = new Map<string, SemRecognizedCourse>();
  for (const group of groups) for (const course of group) merged.set(course.id, course);
  return [...merged.values()].sort((left, right) => (
    (right.startDate || right.dateRaw).localeCompare(left.startDate || left.dateRaw)
    || left.title.localeCompare(right.title, "zh-Hant")
  ));
}

export function normalizeRecognizedCourseCompletion(value: unknown): RecognizedCourseCompletion | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<RecognizedCourseCompletion>;
  if (typeof input.courseId !== "string" || !input.courseId.startsWith("sem-course-") || !input.snapshot) return null;
  return {
    courseId: input.courseId,
    completedAt: typeof input.completedAt === "string" ? input.completedAt.slice(0, 10) : "",
    certificateNumber: typeof input.certificateNumber === "string" ? input.certificateNumber.slice(0, 200) : "",
    note: typeof input.note === "string" ? input.note.slice(0, 2000) : "",
    snapshot: input.snapshot,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
  };
}

export function effectiveCompletedCourses(completions: RecognizedCourseCompletion[], catalog: SemRecognizedCourse[]) {
  const current = new Map(catalog.map((course) => [course.id, course]));
  const unique = new Map<string, SemRecognizedCourse>();
  for (const completion of completions) unique.set(completion.courseId, current.get(completion.courseId) ?? completion.snapshot);
  return [...unique.values()];
}

export function recognizedCourseSummary(
  completions: RecognizedCourseCompletion[],
  catalog: SemRecognizedCourse[],
  quotaYear: number,
) {
  const courses = effectiveCompletedCourses(completions, catalog);
  const hours = courses.reduce((total, course) => ({
    intro: total.intro + course.hours.intro,
    hazmat: total.hazmat + course.hours.hazmat,
    nuclear: total.nuclear + course.hours.nuclear,
    other: total.other + course.hours.other,
  }), emptyHours());
  const exerciseHours = courses.reduce((total, course) => ({
    dmat: total.dmat + course.exerciseHours.dmat,
    hospital: total.hospital + course.exerciseHours.hospital,
    special: total.special + course.exerciseHours.special,
  }), emptyExerciseHours());
  const exerciseKinds = new Set(courses.flatMap((course) => course.exerciseKinds));
  const jointDiscussions = courses.filter((course) => /災難應變與醫療聯合討論會/u.test(course.title)).length;
  const targets = quotaYear <= 107
    ? { intro: 14, hazmat: 0, nuclear: 0, other: 0, exercises: 0, exerciseHours: 8, jointDiscussions: 0 }
    : quotaYear <= 111
      ? { intro: 16, hazmat: 8, nuclear: 8, other: 8, exercises: 3, exerciseHours: 0, jointDiscussions: 0 }
      : { intro: 16, hazmat: 6, nuclear: 6, other: 6, exercises: 3, exerciseHours: 0, jointDiscussions: 3 };
  return {
    courses,
    hours: Object.fromEntries(Object.entries(hours).map(([key, value]) => [key, Number(value.toFixed(2))])) as RecognitionHours,
    exerciseHours: Object.fromEntries(Object.entries(exerciseHours).map(([key, value]) => [key, Number(value.toFixed(2))])) as ExerciseHours,
    exerciseKinds: [...exerciseKinds] as ExerciseCategory[],
    exerciseCount: exerciseKinds.size,
    jointDiscussions,
    targets,
  };
}

export type RecognizedCourseSummary = ReturnType<typeof recognizedCourseSummary>;

export function recognitionBadges(course: SemRecognizedCourse) {
  const result: { key: string; label: string }[] = [];
  for (const key of ["intro", "hazmat", "nuclear", "other"] as RecognitionCategory[]) {
    if (course.hours[key] > 0) result.push({ key, label: `${recognitionLabels[key]} ${course.hours[key]} 小時` });
  }
  for (const key of course.exerciseKinds) {
    const hours = course.exerciseHours[key];
    result.push({ key: `exercise-${key}`, label: `${exerciseLabels[key]}${hours > 0 ? ` ${hours} 小時` : ""}` });
  }
  return result;
}
