import { strFromU8, unzipSync } from "fflate";

export const SEM_DISASTER_FORMS_URL = "https://www.sem.org.tw/Doc/%E5%90%84%E9%A1%9E%E8%A1%A8%E5%96%AE";
export const SEM_DISASTER_RECOGNITION_FALLBACK_URL = "https://tsem.blob.core.windows.net/docfilecontainer/%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E6%99%82%E6%95%B8%E8%AA%8D%E8%AD%89%E6%B8%85%E5%96%AE%281150715%E6%9B%B4%E6%96%B0%29.xlsx";

export type SemDisasterCourseRegion = "north" | "central" | "south";
export type SemDisasterRecognitionKind =
  | "intro"
  | "hazmat"
  | "nuclear"
  | "other"
  | "exercise-dmat"
  | "exercise-hospital"
  | "exercise-special";

export type SemDisasterCourseRecognition = {
  kind: SemDisasterRecognitionKind;
  label: string;
  hoursText: string;
  checklistItemId: string;
};

export type SemDisasterCourse = {
  id: string;
  title: string;
  dateLabel: string;
  startDate: string;
  endDate: string;
  location: string;
  regions: SemDisasterCourseRegion[];
  recognitions: SemDisasterCourseRecognition[];
  sourceUrl: string;
};

export type SemDisasterCourseFeed = {
  status: "live" | "snapshot";
  updatedAt: string;
  sourceUrl: string;
  courses: SemDisasterCourse[];
};

export type SemRecognitionWorkbookLink = {
  url: string;
  updatedAt: string;
  version: string;
};

const SEM_ORIGIN = "https://www.sem.org.tw";
const SEM_BLOB_ORIGIN = "https://tsem.blob.core.windows.net";
const MAX_UNZIPPED_BYTES = 30_000_000;
const MAX_EXTRACTED_FILES = 512;

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeXml(value: string) {
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith("#")) {
      const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
      const raw = radix === 16 ? code.slice(2) : code.slice(1);
      const point = Number.parseInt(raw, radix);
      const valid = Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
      return valid ? String.fromCodePoint(point) : entity;
    }
    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

function cleanHtml(value: string) {
  return decodeXml(value.replace(/<!--[^]*?-->/gu, " ").replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function attribute(attributes: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return decodeXml(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*["']([^"']*)["']`, "iu").exec(attributes)?.[1] ?? "");
}

function decodedUrlText(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function versionDate(version: string) {
  const match = /^(\d{3})(\d{2})(\d{2})$/u.exec(version);
  if (!match) return "";
  const year = Number(match[1]) + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseLatestRecognitionWorkbookLink(html: string): SemRecognitionWorkbookLink | null {
  const candidates: SemRecognitionWorkbookLink[] = [];
  const anchorPattern = /<a\b([^>]*)>([^]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    const href = attribute(match[1] ?? "", "href");
    const label = cleanHtml(match[2] ?? "");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, SEM_ORIGIN);
    } catch {
      continue;
    }
    const searchable = `${decodedUrlText(url.href)} ${label}`;
    if (!searchable.includes("住院醫師災難醫學訓練課程時數認證清單")) continue;
    if (url.origin !== SEM_BLOB_ORIGIN || !url.pathname.startsWith("/docfilecontainer/") || !url.pathname.toLowerCase().endsWith(".xlsx")) continue;
    const versions = [...searchable.matchAll(/(?<!\d)(\d{7})(?!\d)/gu)].map((entry) => entry[1] ?? "");
    const version = versions.sort().at(-1) ?? "";
    const updatedAt = versionDate(version);
    if (!updatedAt) continue;
    url.hash = "";
    candidates.push({ url: url.toString(), updatedAt, version });
  }
  return candidates.sort((left, right) => right.version.localeCompare(left.version))[0] ?? null;
}

function xmlText(value: Uint8Array | undefined, label: string) {
  if (!value) throw new Error(`missing ${label}`);
  return strFromU8(value);
}

function normalizedZipPath(value: string) {
  const parts: string[] = [];
  for (const part of value.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function sharedStringsFromXml(xml: string) {
  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([^]*?)<\/si>/giu;
  let item: RegExpExecArray | null;
  while ((item = itemPattern.exec(xml))) {
    const parts = [...(item[1] ?? "").matchAll(/<t\b[^>]*>([^]*?)<\/t>/giu)].map((entry) => decodeXml(entry[1] ?? ""));
    strings.push(parts.join(""));
  }
  return strings;
}

function worksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  const rowPattern = /<row\b[^>]*>([^]*?)<\/row>/giu;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(xml))) {
    const values = Array<string>(10).fill("");
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([^]*?)<\/c>)/giu;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(rowMatch[1] ?? ""))) {
      const ref = attribute(cellMatch[1] ?? "", "r");
      const column = /^[A-Z]+/u.exec(ref)?.[0] ?? "";
      let index = 0;
      for (const character of column) index = index * 26 + character.charCodeAt(0) - 64;
      index -= 1;
      if (index < 0 || index >= values.length) continue;
      const type = attribute(cellMatch[1] ?? "", "t");
      const body = cellMatch[2] ?? "";
      const raw = /<v\b[^>]*>([^]*?)<\/v>/iu.exec(body)?.[1] ?? "";
      if (type === "s") values[index] = sharedStrings[Number.parseInt(raw, 10)] ?? "";
      else if (type === "inlineStr") values[index] = [...body.matchAll(/<t\b[^>]*>([^]*?)<\/t>/giu)].map((entry) => decodeXml(entry[1] ?? "")).join("");
      else values[index] = decodeXml(raw);
    }
    rows.push(values);
  }
  return rows;
}

function simpleHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function isoRocDate(year: number, month: number, day: number) {
  const gregorianYear = year + 1911;
  const date = new Date(Date.UTC(gregorianYear, month - 1, day));
  if (date.getUTCFullYear() !== gregorianYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${gregorianYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function courseDateRange(value: string, defaultRocYear: number) {
  const normalized = value.replace(/\/{2,}/gu, "/").replace(/[～~至]/gu, "-").trim();
  const [startPart = "", endPart = ""] = normalized.split("-", 2);
  const startMatch = /(\d{3})\/(\d{1,2})\/(\d{1,2})/u.exec(startPart);
  const startDate = startMatch ? isoRocDate(Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3])) : "";
  if (!startDate) return { startDate: "", endDate: "" };
  const fullEnd = /(\d{3})\/(\d{1,2})\/(\d{1,2})/u.exec(endPart);
  const shortEnd = /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\D|$)/u.exec(endPart);
  const endDate = fullEnd
    ? isoRocDate(Number(fullEnd[1]), Number(fullEnd[2]), Number(fullEnd[3]))
    : shortEnd
      ? isoRocDate(defaultRocYear, Number(shortEnd[1]), Number(shortEnd[2]))
      : startDate;
  return { startDate, endDate: endDate || startDate };
}

const DISPLAYED_REGIONS: SemDisasterCourseRegion[] = ["north", "central", "south"];

function regionsForCourse(title: string, location: string): SemDisasterCourseRegion[] {
  const text = `${title} ${location}`.normalize("NFKC");
  const regions = new Set<SemDisasterCourseRegion>();

  // Official REMOC boundaries place Yilan and Miaoli in the north, and
  // Yunlin in the south. Explicit place/region names take precedence over a
  // hospital brand so, for example, NTUH Yunlin is not also filed as north.
  if (/(?:臺北|台北)區|北區|臺北|台北|新北|基隆|桃園|新竹|苗栗|宜蘭|林口|淡水|亞東|北投/u.test(text)) regions.add("north");
  if (/中區|臺中|台中|彰化|南投|光田|中山醫|中榮/u.test(text)) regions.add("central");
  if (/南區|高屏區|雲林|虎尾|斗六|嘉義|臺南|台南|高雄|屏東|澎湖|成大|成功大學|奇美|高榮|高醫/u.test(text)) regions.add("south");

  if (!regions.size) {
    if (/臺大醫院|台大醫院|萬芳|新光醫院|輔仁大學附設醫院|輔大醫院|淡馬/u.test(text)) regions.add("north");
    if (/中國醫藥大學附設醫院|中國附醫|大里仁愛/u.test(text)) regions.add("central");
    if (/高長(?:場)?|高雄長庚/u.test(text)) regions.add("south");
  }

  // Hualien and Taitung courses belong to the east region. The product only
  // has the three requested regional pages, so placing them in another region
  // would be misleading; keep them out until an east page exists.
  if (!regions.size && /花蓮|臺東|台東|部東場|慈濟大學/u.test(text)) return [];

  // A course explicitly delivered online with no regional host is available
  // to residents in every displayed region. Host-labelled Webex sessions are
  // already assigned above (for example, Wan Fang, Kaohsiung Chang Gung, and
  // Tamsui Mackay).
  if (!regions.size && /線上課程|Webex視訊軟體|Webex|網路課程|遠距課程/iu.test(text)) {
    return [...DISPLAYED_REGIONS];
  }
  return [...regions];
}

const recognitionColumns: Array<{
  index: number;
  kind: SemDisasterRecognitionKind;
  label: string;
  checklistItemId: string;
}> = [
  { index: 3, kind: "intro", label: "初階災難訓練", checklistItemId: "disaster.intro" },
  { index: 4, kind: "hazmat", label: "毒化災課程", checklistItemId: "disaster.hazmat-6h" },
  { index: 5, kind: "nuclear", label: "核災課程", checklistItemId: "disaster.nuclear-6h" },
  { index: 6, kind: "other", label: "其他認證課程", checklistItemId: "disaster.other-6h" },
  { index: 7, kind: "exercise-dmat", label: "災難醫療隊／大量傷患演習", checklistItemId: "disaster.drills-3" },
  { index: 8, kind: "exercise-hospital", label: "醫院緊急應變演習", checklistItemId: "disaster.drills-3" },
  { index: 9, kind: "exercise-special", label: "特殊災害演習", checklistItemId: "disaster.drills-3" },
];

function recognitionText(value: string) {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (!cleaned || cleaned === "-" || /(?:未認列|不予認列)/u.test(cleaned)) return "";
  return cleaned;
}

export function parseSemDisasterCourseWorkbook(bytes: Uint8Array, source: SemRecognitionWorkbookLink): SemDisasterCourse[] {
  let declaredBytes = 0;
  let extractedFiles = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      const path = normalizedZipPath(file.name);
      const required = path === "xl/workbook.xml"
        || path === "xl/_rels/workbook.xml.rels"
        || path === "xl/sharedStrings.xml"
        || path.startsWith("xl/worksheets/");
      if (!required) return false;
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error("invalid workbook entry size");
      declaredBytes += file.originalSize;
      extractedFiles += 1;
      if (declaredBytes > MAX_UNZIPPED_BYTES || extractedFiles > MAX_EXTRACTED_FILES) throw new Error("workbook too large");
      return true;
    },
  });
  const totalBytes = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
  if (totalBytes > MAX_UNZIPPED_BYTES) throw new Error("workbook too large");
  const workbookXml = xmlText(files["xl/workbook.xml"], "workbook");
  const relationshipsXml = xmlText(files["xl/_rels/workbook.xml.rels"], "workbook relationships");
  const sharedStrings = files["xl/sharedStrings.xml"] ? sharedStringsFromXml(xmlText(files["xl/sharedStrings.xml"], "shared strings")) : [];

  const relationshipMap = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/giu)) {
    const id = attribute(match[1] ?? "", "Id");
    const target = attribute(match[1] ?? "", "Target");
    if (id && target) relationshipMap.set(id, target);
  }

  const sheets: Array<{ rocYear: number; relationId: string }> = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/giu)) {
    const name = attribute(match[1] ?? "", "name");
    const relationId = attribute(match[1] ?? "", "r:id");
    const yearMatch = /^\s*(\d{3})\s*年?\s*$/u.exec(name);
    if (yearMatch && relationId) sheets.push({ rocYear: Number(yearMatch[1]), relationId });
  }
  const latestSheet = sheets.sort((left, right) => right.rocYear - left.rocYear)[0];
  if (!latestSheet) throw new Error("latest annual sheet not found");
  const target = relationshipMap.get(latestSheet.relationId);
  if (!target) throw new Error("annual sheet relationship not found");
  const sheetPath = normalizedZipPath(target.startsWith("/") ? target : `xl/${target}`);
  if (!sheetPath.startsWith("xl/worksheets/")) throw new Error("unexpected worksheet path");
  const rows = worksheetRows(xmlText(files[sheetPath], "annual worksheet"), sharedStrings);

  const courses: SemDisasterCourse[] = [];
  for (const row of rows.slice(2)) {
    const dateLabel = row[0]?.replace(/\s+/gu, " ").trim() ?? "";
    const location = row[1]?.replace(/\s+/gu, " ").trim() ?? "";
    const title = row[2]?.replace(/\s+/gu, " ").trim() ?? "";
    if (!dateLabel || !title) continue;
    const recognitions = recognitionColumns.flatMap((definition) => {
      const hoursText = recognitionText(row[definition.index] ?? "");
      return hoursText ? [{ kind: definition.kind, label: definition.label, hoursText, checklistItemId: definition.checklistItemId }] : [];
    });
    if (!recognitions.length) continue;
    const regions = regionsForCourse(title, location);
    if (!regions.length) continue;
    const { startDate, endDate } = courseDateRange(dateLabel, latestSheet.rocYear);
    if (!startDate) continue;
    courses.push({
      id: `sem-disaster-${simpleHash(`${dateLabel}|${location}|${title}`)}`,
      title,
      dateLabel,
      startDate,
      endDate,
      location,
      regions,
      recognitions,
      sourceUrl: source.url,
    });
  }
  return courses.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title, "zh-Hant"));
}

const fallbackRecognizedCourses: SemDisasterCourse[] = [
  { id: "fallback-south-0722", title: "115年度醫療整備計畫（非外科系）醫事人員外傷照護訓練課程【高屏區】", dateLabel: "115/7/22", startDate: "2026-07-22", endDate: "2026-07-22", location: "高雄醫學大學附設中和紀念醫院", regions: ["south"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "1.5 小時", checklistItemId: "disaster.other-6h" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-north-0729", title: "化學災害醫療應變醫護人員進階教育訓練", dateLabel: "115/07/29", startDate: "2026-07-29", endDate: "2026-07-29", location: "新竹市六樓多媒體會議室", regions: ["north"], recognitions: [{ kind: "hazmat", label: "毒化災課程", hoursText: "6 小時", checklistItemId: "disaster.hazmat-6h" }, { kind: "exercise-special", label: "特殊災害演習", hoursText: "桌上模擬演習 2 小時（毒化災）", checklistItemId: "disaster.drills-3" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-central-0731", title: "115年度醫療整備計畫（非外科系）醫事人員外傷照護訓練課程【中區】", dateLabel: "115/7/31", startDate: "2026-07-31", endDate: "2026-07-31", location: "光田綜合醫院向上院區", regions: ["central"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "1.5 小時", checklistItemId: "disaster.other-6h" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-south-0804", title: "115年度高屏區毒化災醫療進階課程", dateLabel: "115/8/4", startDate: "2026-08-04", endDate: "2026-08-04", location: "高雄醫學大學附設中和紀念醫院", regions: ["south"], recognitions: [{ kind: "hazmat", label: "毒化災課程", hoursText: "7 小時", checklistItemId: "disaster.hazmat-6h" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-shared-0811", title: "115年度中區與北區災難醫療救護隊（DMAT）聯合演練", dateLabel: "115/8/11-115/8/13", startDate: "2026-08-11", endDate: "2026-08-13", location: "苗栗縣", regions: ["north", "central"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "8/13 2 小時（DMAT 演練）", checklistItemId: "disaster.other-6h" }, { kind: "exercise-dmat", label: "災難醫療隊／大量傷患演習", hoursText: "8/11 6 小時、8/12 8.5 小時", checklistItemId: "disaster.drills-3" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-south-0811", title: "115年度災難醫療救護隊訓練（第二類）通識課程", dateLabel: "115/8/11", startDate: "2026-08-11", endDate: "2026-08-11", location: "國立成功大學醫學院第一講堂", regions: ["south"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "3 小時（DMAT）", checklistItemId: "disaster.other-6h" }, { kind: "exercise-dmat", label: "災難醫療隊／大量傷患演習", hoursText: "4 小時（DMAT）", checklistItemId: "disaster.drills-3" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-south-0820", title: "115年度醫院安全及緊急應變訓練課程", dateLabel: "115/8/20", startDate: "2026-08-20", endDate: "2026-08-20", location: "高雄榮民總醫院", regions: ["south"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "6 小時", checklistItemId: "disaster.other-6h" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-central-0831", title: "115年度化學物質緊急事件醫療應變訓練通識課程", dateLabel: "115/8/31", startDate: "2026-08-31", endDate: "2026-08-31", location: "中山醫學大學誠愛樓臨床技能中心", regions: ["central"], recognitions: [{ kind: "hazmat", label: "毒化災課程", hoursText: "6 小時", checklistItemId: "disaster.hazmat-6h" }, { kind: "exercise-special", label: "特殊災害演習", hoursText: "2.5 小時", checklistItemId: "disaster.drills-3" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-north-1002", title: "緊急醫療救護", dateLabel: "115/10/2-115/10/3", startDate: "2026-10-02", endDate: "2026-10-03", location: "北投會館", regions: ["north"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "10/2 1 小時", checklistItemId: "disaster.other-6h" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
  { id: "fallback-north-1003", title: "115年度醫療整備計畫（非外科系）醫事人員外傷照護訓練課程【台北區】", dateLabel: "115/10/3", startDate: "2026-10-03", endDate: "2026-10-03", location: "台北慈濟醫院", regions: ["north"], recognitions: [{ kind: "other", label: "其他認證課程", hoursText: "1.5 小時", checklistItemId: "disaster.other-6h" }], sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL },
];

export function fallbackSemDisasterCourseFeed(): SemDisasterCourseFeed {
  return {
    status: "snapshot",
    updatedAt: "2026-07-15",
    sourceUrl: SEM_DISASTER_RECOGNITION_FALLBACK_URL,
    courses: fallbackRecognizedCourses.map((course) => ({ ...course, regions: [...course.regions], recognitions: course.recognitions.map((recognition) => ({ ...recognition })) })),
  };
}

type TextLoader = (url: string) => Promise<string>;
type WorkbookLoader = (url: string) => Promise<Uint8Array>;

export async function refreshSemDisasterCourseFeed(loadFormsPage: TextLoader, loadWorkbook: WorkbookLoader): Promise<SemDisasterCourseFeed> {
  const workbookLink = parseLatestRecognitionWorkbookLink(await loadFormsPage(SEM_DISASTER_FORMS_URL));
  if (!workbookLink) throw new Error("recognition workbook link not found");
  const courses = parseSemDisasterCourseWorkbook(await loadWorkbook(workbookLink.url), workbookLink);
  if (!courses.length) throw new Error("recognition workbook has no regional courses");
  return { status: "live", updatedAt: workbookLink.updatedAt, sourceUrl: workbookLink.url, courses };
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

export function disasterCourseCacheControl(status: SemDisasterCourseFeed["status"]) {
  return status === "live"
    ? "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=86400"
    : "public, max-age=0, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400";
}

export function createSemDisasterCourseFeedLoader(
  refresh: () => Promise<SemDisasterCourseFeed>,
  clock: () => number = Date.now,
) {
  let cached: SemDisasterCourseFeed | null = null;
  let expiresAt = 0;
  let inFlight: Promise<SemDisasterCourseFeed> | null = null;
  return async function loadSemDisasterCourseFeed() {
    const requestedAt = clock();
    if (cached && requestedAt < expiresAt) return cached;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(refresh)
      .catch(() => cached ?? fallbackSemDisasterCourseFeed())
      .then((feed) => {
        cached = feed;
        expiresAt = requestedAt + (feed.status === "live" ? SIX_HOURS : FIVE_MINUTES);
        return feed;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
