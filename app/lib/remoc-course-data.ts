export const DISASTER_COURSES_ENDPOINT = "/api/disaster-courses";
export const REMOC_STATIC_SCHEDULE_ROC_YEAR = 115;
export const REMOC_115_ANNOUNCEMENT_URL = "https://www.sem.org.tw/News/Details/1538";
export const REMOC_115_SCHEDULE_URL = "https://tsem.blob.core.windows.net/newscontainer/115%E5%B9%B4%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E7%9B%B8%E9%97%9C%E8%AA%B2%E7%A8%8B%E8%BE%A6%E7%90%86%E6%99%82%E9%96%93%E6%B8%85%E5%96%AE.pdf";
export const REMOC_114_CENTRAL_SCHEDULE_URL = "https://tsem.blob.core.windows.net/newscontainer/114%E5%B9%B4%E6%B4%BB%E5%8B%95%E6%97%A5%E7%A8%8B%E8%A1%A8%28REMOC%E8%88%87DMEC%E6%95%99%E8%82%B2%E8%A8%93%E7%B7%B4%E5%90%88%E4%BD%9C%29.pdf";
export const DISASTER_COURSE_RECOGNITION_FORMS_URL = "https://www.sem.org.tw/Doc/%E5%90%84%E9%A1%9E%E8%A1%A8%E5%96%AE";
export const DISASTER_COURSE_RECOGNITION_SNAPSHOT_URL = "https://tsem.blob.core.windows.net/docfilecontainer/%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E6%99%82%E6%95%B8%E8%AA%8D%E8%AD%89%E6%B8%85%E5%96%AE%281150715%E6%9B%B4%E6%96%B0%29.xlsx";
export const DISASTER_COURSE_RECOGNITION_SNAPSHOT_UPDATED_AT = "2026-07-15";

export type RemocRegion = "north" | "central" | "south";
export type RemocCategory = "hazmat" | "nuclear" | "other";
export type DisasterRecognitionKind = "intro" | RemocCategory | "exercise-dmat" | "exercise-hospital" | "exercise-special";
export type DisasterChecklistItemId =
  | "disaster.intro"
  | "disaster.hazmat-6h"
  | "disaster.nuclear-6h"
  | "disaster.other-6h"
  | "disaster.drills-3";

export type DisasterCourseRecognition = {
  kind: DisasterRecognitionKind;
  label: string;
  hoursText: string;
  checklistItemId: DisasterChecklistItemId;
};

export type DisasterCourseApiCourse = {
  id: string;
  title: string;
  dateLabel: string;
  startDate: string;
  endDate: string;
  location: string;
  regions: RemocRegion[];
  recognitions: DisasterCourseRecognition[];
  sourceUrl: string;
};

export type DisasterCourseApiPayload = {
  status: "live" | "snapshot";
  updatedAt: string;
  sourceUrl: string;
  courses: DisasterCourseApiCourse[];
};

export type RegionalDisasterCourse = DisasterCourseApiCourse & {
  recognitionStatus: "recognized" | "pending";
  dateCertainty?: "confirmed" | "tentative";
  matchHints?: string[];
  listing?: {
    registrationLabel: string;
    status: "open" | "full" | "closed" | "unknown";
    sourceName: string;
    sourceUrl: string;
    detailUrl: string;
    brochureUrl?: string;
    deadline?: string;
  };
};

export const REMOC_REGION_OPTIONS: { id: RemocRegion; label: string; description: string }[] = [
  { id: "north", label: "北部", description: "台北、北區與全區線上場次" },
  { id: "central", label: "中部", description: "中區與全區線上場次" },
  { id: "south", label: "南部", description: "南區、高屏與全區線上場次" },
];

export const REMOC_CATEGORY_OPTIONS: { id: "all" | RemocCategory; label: string }[] = [
  { id: "all", label: "全部課程" },
  { id: "hazmat", label: "毒化災" },
  { id: "nuclear", label: "核災" },
  { id: "other", label: "HICS／DMAT／其他" },
];

const allowedRegions = new Set<RemocRegion>(REMOC_REGION_OPTIONS.map((region) => region.id));
const allowedKinds = new Set<DisasterRecognitionKind>(["intro", "hazmat", "nuclear", "other", "exercise-dmat", "exercise-hospital", "exercise-special"]);
const allowedChecklistItems = new Set<DisasterChecklistItemId>([
  "disaster.intro",
  "disaster.hazmat-6h",
  "disaster.nuclear-6h",
  "disaster.other-6h",
  "disaster.drills-3",
]);

function safeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeIsoDate(value: unknown) {
  const text = safeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : "";
}

function safeSemUrl(value: unknown) {
  const text = safeText(value, 1000);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "www.sem.org.tw" && url.hostname !== "sem.org.tw" && url.hostname !== "tsem.blob.core.windows.net") return "";
    return url.href;
  } catch {
    return "";
  }
}

export function normalizeDisasterCoursePayload(value: unknown): DisasterCourseApiPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<DisasterCourseApiPayload>;
  const status = input.status === "live" || input.status === "snapshot" ? input.status : null;
  const updatedAt = safeIsoDate(input.updatedAt);
  const sourceUrl = safeSemUrl(input.sourceUrl);
  if (!status || !updatedAt || !sourceUrl || !Array.isArray(input.courses)) return null;

  const courses = input.courses.slice(0, 500).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<DisasterCourseApiCourse>;
    const id = safeText(item.id, 160);
    const title = safeText(item.title);
    const dateLabel = safeText(item.dateLabel, 100);
    const startDate = safeIsoDate(item.startDate);
    const endDate = safeIsoDate(item.endDate);
    const location = safeText(item.location);
    const courseSourceUrl = safeSemUrl(item.sourceUrl);
    const regions = Array.isArray(item.regions)
      ? [...new Set(item.regions.filter((region): region is RemocRegion => allowedRegions.has(region as RemocRegion)))]
      : [];
    const recognitions = Array.isArray(item.recognitions) ? item.recognitions.flatMap((candidateRecognition) => {
      if (!candidateRecognition || typeof candidateRecognition !== "object") return [];
      const recognition = candidateRecognition as Partial<DisasterCourseRecognition>;
      if (!allowedKinds.has(recognition.kind as DisasterRecognitionKind) || !allowedChecklistItems.has(recognition.checklistItemId as DisasterChecklistItemId)) return [];
      const label = safeText(recognition.label, 160);
      const hoursText = safeText(recognition.hoursText, 80);
      if (!label || !hoursText) return [];
      return [{
        kind: recognition.kind as DisasterRecognitionKind,
        label,
        hoursText,
        checklistItemId: recognition.checklistItemId as DisasterChecklistItemId,
      }];
    }) : [];
    if (!id || !title || !dateLabel || !startDate || !endDate || !location || !courseSourceUrl || !regions.length || !recognitions.length) return [];
    return [{ id, title, dateLabel, startDate, endDate, location, regions, recognitions, sourceUrl: courseSourceUrl }];
  });

  return { status, updatedAt, sourceUrl, courses };
}

const recognized = (
  id: string,
  title: string,
  dateLabel: string,
  startDate: string,
  endDate: string,
  location: string,
  regions: RemocRegion[],
  recognitions: DisasterCourseRecognition[],
): RegionalDisasterCourse => ({
  id,
  title,
  dateLabel,
  startDate,
  endDate,
  location,
  regions,
  recognitions,
  sourceUrl: DISASTER_COURSE_RECOGNITION_SNAPSHOT_URL,
  recognitionStatus: "recognized",
});

const courseRecognition = (kind: RemocCategory, hoursText: string): DisasterCourseRecognition => ({
  kind,
  label: kind === "hazmat" ? "毒化災課程" : kind === "nuclear" ? "核災課程" : "其他認證課程",
  hoursText,
  checklistItemId: kind === "hazmat" ? "disaster.hazmat-6h" : kind === "nuclear" ? "disaster.nuclear-6h" : "disaster.other-6h",
});

const drillRecognition = (kind: "exercise-dmat" | "exercise-hospital" | "exercise-special", hoursText: string): DisasterCourseRecognition => ({
  kind,
  label: kind === "exercise-dmat" ? "災難醫療隊演習" : kind === "exercise-hospital" ? "醫院緊急應變演習" : "特殊災害演習",
  hoursText,
  checklistItemId: "disaster.drills-3",
});

/**
 * Used only when the newest official recognition workbook cannot be reached.
 * Dates and hours follow the SEM 115/07/15 recognition list.
 */
export const DISASTER_COURSE_RECOGNIZED_FALLBACK: RegionalDisasterCourse[] = [
  recognized("recognized-115-0722-kaohsiung-trauma", "115 年度醫療整備計畫（非外科系）醫事人員外傷照護訓練課程【高屏區】", "115/7/22", "2026-07-22", "2026-07-22", "高雄醫學大學附設中和紀念醫院", ["south"], [courseRecognition("other", "1.5 小時")]),
  recognized("recognized-115-0729-hsinchu-hazmat", "化學災害醫療應變醫護人員進階教育訓練", "115/07/29", "2026-07-29", "2026-07-29", "新竹市六樓多媒體會議室", ["north"], [courseRecognition("hazmat", "6 小時"), drillRecognition("exercise-special", "桌上模擬演習 2 小時（毒化災）")]),
  recognized("recognized-115-0731-kuang-tien-trauma", "115 年度醫療整備計畫（非外科系）醫事人員外傷照護訓練課程【中區】", "115/7/31", "2026-07-31", "2026-07-31", "光田綜合醫院向上院區", ["central"], [courseRecognition("other", "1.5 小時")]),
  recognized("recognized-115-0804-kaoping-hazmat", "115 年度高屏區毒化災醫療進階課程", "115/8/4", "2026-08-04", "2026-08-04", "高雄醫學大學附設中和紀念醫院", ["south"], [courseRecognition("hazmat", "7 小時")]),
  recognized("recognized-115-0811-cross-region-dmat", "115 年度中區與北區災難醫療救護隊（DMAT）聯合演練", "115/8/11–115/8/13", "2026-08-11", "2026-08-13", "苗栗縣", ["north", "central"], [courseRecognition("other", "8/13：2 小時（DMAT 演練）"), drillRecognition("exercise-dmat", "8/11：6 小時；8/12：8.5 小時")]),
  recognized("recognized-115-0811-tainan-dmat", "115 年度災難醫療救護隊訓練（第二類）通識課程", "115/8/11", "2026-08-11", "2026-08-11", "國立成功大學醫學院第一講堂", ["south"], [courseRecognition("other", "3 小時（DMAT）"), drillRecognition("exercise-dmat", "4 小時（DMAT）")]),
  recognized("recognized-115-0820-kaohsiung-hics", "115 年度醫院安全及緊急應變訓練課程", "115/8/20", "2026-08-20", "2026-08-20", "高雄榮民總醫院", ["south"], [courseRecognition("other", "6 小時")]),
  recognized("recognized-115-0831-csh-hazmat", "115 年度化學物質緊急事件醫療應變訓練通識課程", "115/8/31", "2026-08-31", "2026-08-31", "中山醫學大學誠愛樓臨床技能中心", ["central"], [courseRecognition("hazmat", "6 小時"), drillRecognition("exercise-special", "2.5 小時")]),
  recognized("recognized-115-1002-beitou-ems", "緊急醫療救護", "115/10/2–115/10/3", "2026-10-02", "2026-10-03", "北投會館", ["north"], [courseRecognition("other", "10/2：1 小時")]),
  recognized("recognized-115-1003-taipei-trauma", "115 年度醫療整備計畫（非外科系）醫事人員外傷照護訓練課程【台北區】", "115/10/3", "2026-10-03", "2026-10-03", "台北慈濟醫院", ["north"], [courseRecognition("other", "1.5 小時")]),
];

const pending = (
  id: string,
  title: string,
  dateLabel: string,
  startDate: string,
  endDate: string,
  location: string,
  regions: RemocRegion[],
  requirement: RemocCategory,
  matchHints: string[],
): RegionalDisasterCourse => ({
  id,
  title,
  dateLabel,
  startDate,
  endDate,
  location,
  regions,
  recognitions: [courseRecognition(requirement, "尚待認列")],
  sourceUrl: REMOC_115_SCHEDULE_URL,
  recognitionStatus: "pending",
  dateCertainty: "tentative",
  matchHints,
});

/** Future REMOC dates announced for 115 that are not present in the 115/07/15 recognition list. */
export const REMOC_115_PENDING_COURSES: RegionalDisasterCourse[] = [
  pending("remoc-115-0901-north-radiation", "輻傷事件緊急醫療應變人員教育訓練模組實體課程", "115/9/1", "2026-09-01", "2026-09-01", "林口長庚紀念醫院", ["north"], "nuclear", ["林口長庚", "輻傷"]),
  pending("remoc-115-10-south-radiation-drill", "輻傷演習", "115/10 月", "2026-10-01", "2026-10-31", "成大醫院", ["south"], "nuclear", ["成大", "輻傷"]),
];

export function disasterCourseCategories(course: Pick<RegionalDisasterCourse, "recognitions">): RemocCategory[] {
  const categories = course.recognitions.flatMap((recognition): RemocCategory[] => {
    if (recognition.kind === "hazmat" || recognition.kind === "nuclear" || recognition.kind === "other") return [recognition.kind];
    if (recognition.kind.startsWith("exercise-")) return ["other"];
    return [];
  });
  return [...new Set(categories)];
}

export function disasterCourseTiming(course: Pick<RegionalDisasterCourse, "startDate" | "endDate" | "dateCertainty">, taiwanToday: string) {
  if (course.endDate < taiwanToday) return "completed" as const;
  if (course.startDate <= taiwanToday && course.endDate >= taiwanToday) return "ongoing" as const;
  if (course.dateCertainty === "tentative") return "tentative" as const;
  return "upcoming" as const;
}

export function rocYearFromIsoDate(value: string) {
  const match = /^(\d{4})-\d{2}-\d{2}$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]) - 1911;
  return Number.isInteger(year) && year > 0 ? year : null;
}

export function formatRocDateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const year = rocYearFromIsoDate(value);
  return match && year ? `${year}/${match[2]}/${match[3]}` : value;
}

export function resolveDisasterChecklistTarget(requestedItemId: DisasterChecklistItemId, availableItemIds: Iterable<string>) {
  const available = new Set(availableItemIds);
  if (available.has(requestedItemId)) return requestedItemId;
  if (requestedItemId === "disaster.intro") {
    if (available.has("disaster.intro-16h")) return "disaster.intro-16h";
    if (available.has("disaster.basic-14h")) return "disaster.basic-14h";
  }
  if (["disaster.hazmat-6h", "disaster.nuclear-6h", "disaster.other-6h"].includes(requestedItemId) && available.has("disaster.special-24h")) {
    return "disaster.special-24h";
  }
  if (requestedItemId === "disaster.drills-3" && available.has("disaster.exercise-8h")) return "disaster.exercise-8h";
  return requestedItemId;
}

export function pendingCourseHasRecognition(pendingCourse: RegionalDisasterCourse, recognizedCourses: RegionalDisasterCourse[]) {
  const hints = pendingCourse.matchHints ?? [];
  const pendingKinds = new Set(pendingCourse.recognitions.map((recognition) => recognition.kind));
  return recognizedCourses.some((course) => {
    if (course.recognitionStatus !== "recognized") return false;
    if (!course.regions.some((region) => pendingCourse.regions.includes(region))) return false;
    if (!course.recognitions.some((recognition) => pendingKinds.has(recognition.kind))) return false;
    const searchable = `${course.title} ${course.location}`.replace(/\s+/gu, "");
    return hints.length > 0 && hints.every((hint) => searchable.includes(hint.replace(/\s+/gu, "")));
  });
}
