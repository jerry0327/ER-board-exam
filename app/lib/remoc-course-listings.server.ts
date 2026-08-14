import {
  REMOC_CENTRAL_HOME_URL,
  REMOC_CENTRAL_POSTS_URL,
  REMOC_NORTH_COURSES_URL,
  REMOC_SOUTH_COURSES_URL,
  type RegionalCourseListing,
  type RegionalCourseListingRegion,
  type RegionalCourseListingsPayload,
  type RegionalCourseRegistrationStatus,
  type RegionalCourseSourceStatus,
} from "./remoc-course-listings.ts";

const NORTH_SOURCE_NAME = "北區緊急醫療應變中心";
const CENTRAL_SOURCE_NAME = "中區緊急醫療應變中心";
const SOUTH_SOURCE_NAME = "南區緊急醫療應變中心";
const NORTH_1028_REGISTRATION_URL = "https://www.beclass.com/rid=305264569e72b99a331a";
const MAX_CENTRAL_DETAILS = 12;
const MAX_COURSES = 100;

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lt: "<",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
};

function decodeHtml(value: string) {
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

function stripInactiveHtml(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ");
}

function cleanHtml(value: string) {
  return decodeHtml(stripInactiveHtml(value).replace(/<br\s*\/?\s*>/giu, " ").replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function htmlLines(value: string) {
  return decodeHtml(
    stripInactiveHtml(value)
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(/<\/(?:div|h\d|li|p|td|tr)>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  )
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function attribute(attributes: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return decodeHtml(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*["']([^"']*)["']`, "iu").exec(attributes)?.[1] ?? "");
}

function simpleHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function taiwanDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rocDateLabel(startDate: string, endDate: string) {
  const format = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    return match ? `${Number(match[1]) - 1911}/${match[2]}/${match[3]}` : value;
  };
  return startDate === endDate ? format(startDate) : `${format(startDate)}–${format(endDate)}`;
}

type DateRange = { startDate: string; endDate: string };

function monthDayRange(value: string, gregorianYear: number): DateRange | null {
  const match = /(\d{1,2})\s*[-/]\s*(\d{1,2})(?:\s*(?:~|～|–|—|至)\s*(?:(\d{1,2})\s*[-/]\s*)?(\d{1,2}))?/u.exec(value);
  if (!match) return null;
  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = match[3] ? Number(match[3]) : startMonth;
  const endDay = match[4] ? Number(match[4]) : startDay;
  const startDate = isoDate(gregorianYear, startMonth, startDay);
  const endDate = isoDate(gregorianYear, endMonth, endDay);
  return startDate && endDate && endDate >= startDate ? { startDate, endDate } : null;
}

export function parseCourseDateRange(value: string): DateRange | null {
  const normalized = value.normalize("NFKC");
  const gregorianChinese = /(?<!\d)(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(?:至|~|～|–|—)\s*(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日)?/u.exec(normalized);
  if (gregorianChinese) {
    const startYear = Number(gregorianChinese[1]);
    const startMonth = Number(gregorianChinese[2]);
    const startDate = isoDate(startYear, startMonth, Number(gregorianChinese[3]));
    const endYear = gregorianChinese[4] ? Number(gregorianChinese[4]) : startYear;
    const endMonth = gregorianChinese[5] ? Number(gregorianChinese[5]) : startMonth;
    const endDate = gregorianChinese[6] ? isoDate(endYear, endMonth, Number(gregorianChinese[6])) : startDate;
    return startDate && endDate && endDate >= startDate ? { startDate, endDate } : null;
  }

  const roc = /(?<!\d)(\d{3})(?!\d)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(?:至|~|～|–|—)\s*(?:(\d{3})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日)?/u.exec(normalized);
  if (roc) {
    const startYear = Number(roc[1]) + 1911;
    const startMonth = Number(roc[2]);
    const startDate = isoDate(startYear, startMonth, Number(roc[3]));
    const endYear = roc[4] ? Number(roc[4]) + 1911 : startYear;
    const endMonth = roc[5] ? Number(roc[5]) : startMonth;
    const endDate = roc[6] ? isoDate(endYear, endMonth, Number(roc[6])) : startDate;
    return startDate && endDate && endDate >= startDate ? { startDate, endDate } : null;
  }

  const slashRoc = /(?<!\d)(\d{3})(?!\d)\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*(?:至|~|～|–|—)\s*(?:(\d{3})\s*[/.])?\s*(?:(\d{1,2})\s*[/.])?\s*(\d{1,2}))?/u.exec(normalized);
  if (slashRoc) {
    const startYear = Number(slashRoc[1]) + 1911;
    const startMonth = Number(slashRoc[2]);
    const startDate = isoDate(startYear, startMonth, Number(slashRoc[3]));
    const endYear = slashRoc[4] ? Number(slashRoc[4]) + 1911 : startYear;
    const endMonth = slashRoc[5] ? Number(slashRoc[5]) : startMonth;
    const endDate = slashRoc[6] ? isoDate(endYear, endMonth, Number(slashRoc[6])) : startDate;
    return startDate && endDate && endDate >= startDate ? { startDate, endDate } : null;
  }

  const gregorianMatches = [...normalized.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/gu)]
    .map((match) => isoDate(Number(match[1]), Number(match[2]), Number(match[3])))
    .filter(Boolean);
  if (!gregorianMatches.length) return null;
  return { startDate: gregorianMatches[0], endDate: gregorianMatches.at(-1) ?? gregorianMatches[0] };
}

function officialUrl(value: string, base: string, allowedOrigin: string, allowedPath: RegExp) {
  try {
    const url = new URL(decodeHtml(value.trim()), base);
    if (url.protocol !== "https:" || url.origin !== allowedOrigin || !allowedPath.test(url.pathname)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function listingId(region: RegionalCourseListingRegion, startDate: string, title: string, location: string) {
  const key = `${startDate}|${title.normalize("NFKC").replace(/\s+/gu, "")}|${location.normalize("NFKC").replace(/\s+/gu, "")}`;
  return `remoc-${region}-${simpleHash(key)}`;
}

function isRelevantCourseTitle(value: string) {
  return /災難|災害|緊急應變|緊急醫療|化學物質|化災|毒化災|輻傷|輻射|核災|DMAT|HICS|大量傷患|醫療整備|外傷照護|韌性醫療/iu.test(value);
}

function registrationFromText(label: string, endDate: string, today: string): { status: RegionalCourseRegistrationStatus; label: string } {
  if (endDate < today) return { status: "closed", label: "課程已結束" };
  if (/已額滿|名額已滿|目前額滿|報名額滿(?!為止)/u.test(label) && !/未額滿/u.test(label)) return { status: "full", label: "已額滿" };
  if (/截止|結束|關閉/u.test(label)) return { status: "closed", label: "報名已截止" };
  if (/未額滿/u.test(label)) return { status: "open", label: "未額滿" };
  if (/報名中|開放報名|至額滿|額滿為止/u.test(label)) return { status: "open", label: "報名中" };
  return { status: "unknown", label: "報名狀態未標示" };
}

export type NorthCourseListingCandidate = RegionalCourseListing & { registrationCandidateUrl?: string };

function publicNorthCourse(candidate: NorthCourseListingCandidate): RegionalCourseListing {
  const course = { ...candidate };
  delete course.registrationCandidateUrl;
  return course;
}

export function parseNorthCourseListings(html: string, now = new Date()): NorthCourseListingCandidate[] {
  const lines = htmlLines(html);
  const text = lines.join("\n");
  const rocYear = Number(/(\d{3})\s*年度課程日期/u.exec(text)?.[1]);
  if (!Number.isInteger(rocYear) || rocYear < 100 || rocYear > 999) throw new Error("north course year not found");
  const today = taiwanDateKey(now);
  const courses: NorthCourseListingCandidate[] = [];
  const rowPattern = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*(?:-|~|～|–|—|、)\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2}))?\s*([^\n〖]{3,300}?)\s*〖\s*([^\n〗]{2,160}?)\s*〗\s*課程\s*(報名中|已結束)/gu;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(text)) && courses.length < 30) {
    const year = rocYear + 1911;
    const startMonth = Number(match[1]);
    const startDate = isoDate(year, startMonth, Number(match[2]));
    const endMonth = match[3] ? Number(match[3]) : startMonth;
    const endDate = isoDate(year, endMonth, match[4] ? Number(match[4]) : Number(match[2]));
    const title = (match[5] ?? "").replace(/^\s*\(轉分享\)\s*/u, "").trim();
    const location = (match[6] ?? "").trim();
    if (!startDate || !endDate || endDate < startDate || !title || !location || !isRelevantCourseTitle(title)) continue;
    const registration = endDate < today
      ? { status: "closed" as const, label: "課程已結束" }
      : { status: "unknown" as const, label: "報名狀態未標示" };
    const registrationCandidateUrl = startDate === "2026-10-28" && /輻傷/u.test(title) && /林口長庚/u.test(location)
      ? NORTH_1028_REGISTRATION_URL
      : undefined;
    courses.push({
      id: listingId("north", startDate, title, location),
      title,
      region: "north",
      startDate,
      endDate,
      dateLabel: rocDateLabel(startDate, endDate),
      location,
      registrationLabel: registration.label,
      status: registration.status,
      sourceName: NORTH_SOURCE_NAME,
      sourceUrl: REMOC_NORTH_COURSES_URL,
      detailUrl: REMOC_NORTH_COURSES_URL,
      recognitionStatus: "pending",
      ...(registrationCandidateUrl ? { registrationCandidateUrl } : {}),
    });
  }
  if (!courses.length) throw new Error("north course rows not found");
  return courses;
}

export function fallbackNorthCourseListings(now = new Date()): NorthCourseListingCandidate[] {
  const html = `
    <h1>115年度課程日期</h1>
    <p>6/23 北區區域級災難醫療救護隊初階訓練課程〖苗栗縣政府衛生局〗課程報名中</p>
    <p>7/13 化學物質緊急事件醫療應變訓練專業課程〖林口長庚紀念醫院〗課程報名中</p>
    <p>10/28 輻傷事件緊急醫療應變人員教育訓練模組實體訓練課程〖林口長庚紀念醫院〗課程報名中</p>`;
  return parseNorthCourseListings(html, now);
}

function comparableCourseTitle(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\d{3}年度?/gu, "")
    .replace(/事件|緊急|人員|教育|模組|實體|通識|專業|初階|進階|課程/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function applyVerifiedNorthRegistration(
  course: NorthCourseListingCandidate,
  registrationHtml: string,
  registrationUrl: string,
  now = new Date(),
): RegionalCourseListing {
  const fallback = publicNorthCourse(course);
  const detailUrl = officialUrl(registrationUrl, NORTH_1028_REGISTRATION_URL, "https://www.beclass.com", /^\/rid=[\da-f]+$/iu);
  if (!detailUrl) return fallback;
  const title = cleanHtml(/<h1\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu.exec(registrationHtml)?.[1] ?? "");
  const dateText = cleanHtml(/<h2\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/iu.exec(registrationHtml)?.[1] ?? "");
  const range = parseCourseDateRange(dateText);
  const pageText = cleanHtml(registrationHtml);
  const expectedTitle = comparableCourseTitle(course.title);
  const actualTitle = comparableCourseTitle(title);
  const titlesMatch = expectedTitle.length >= 6 && actualTitle.length >= 6
    && (expectedTitle.includes(actualTitle) || actualTitle.includes(expectedTitle));
  const dateMatches = range?.startDate === course.startDate && range.endDate === course.endDate;
  const locationMatches = pageText.replace(/\s+/gu, "").includes(course.location.replace(/\s+/gu, ""));
  if (!titlesMatch || !dateMatches || !locationMatches) return fallback;

  const today = taiwanDateKey(now);
  if (course.endDate < today) return { ...fallback, status: "closed", registrationLabel: "課程已結束" };
  const capacity = Number(/研習預定人數[：:]?\s*(?:每場)?\s*(\d{1,4})\s*人/u.exec(pageText)?.[1]);
  const registered = Number(/目前報名數[：:]\s*(\d{1,4})/u.exec(pageText)?.[1]);
  const hasRegistrationForm = /<input\b[^>]*type=["']?submit["']?[^>]*>/iu.test(registrationHtml);
  if (Number.isFinite(capacity) && Number.isFinite(registered) && registered >= capacity) {
    return { ...fallback, detailUrl, status: "full", registrationLabel: "已額滿" };
  }
  if (hasRegistrationForm) {
    const remaining = Number.isFinite(capacity) && Number.isFinite(registered) ? Math.max(0, capacity - registered) : null;
    return {
      ...fallback,
      detailUrl,
      status: "open",
      registrationLabel: remaining === null ? "報名中" : `報名中（尚餘 ${remaining} 名）`,
    };
  }
  return fallback;
}

type HtmlRow = { attributes: string; body: string; raw: string };

function tableRows(html: string) {
  const rows: HtmlRow[] = [];
  for (const match of stripInactiveHtml(html).matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/giu)) {
    rows.push({ attributes: match[1] ?? "", body: match[2] ?? "", raw: match[0] ?? "" });
  }
  return rows;
}

function tableCells(row: HtmlRow) {
  return [...row.body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/giu)].map((match) => cleanHtml(match[1] ?? ""));
}

function titleYear(title: string, now: Date) {
  const roc = /(?<!\d)(\d{3})\s*年/u.exec(title)?.[1];
  if (roc) return Number(roc) + 1911;
  const gregorian = /(?<!\d)(20\d{2})(?!\d)/u.exec(title)?.[1];
  return gregorian ? Number(gregorian) : Number(taiwanDateKey(now).slice(0, 4));
}

export function parseSouthCourseListings(html: string, now = new Date()): RegionalCourseListing[] {
  if (!/class=["'][^"']*\bcourse-table\b/iu.test(html)) throw new Error("south course table not found");
  const rows = tableRows(html);
  const today = taiwanDateKey(now);
  const courses: RegionalCourseListing[] = [];
  for (let index = 0; index < rows.length && courses.length < 50; index += 1) {
    const titleRow = rows[index];
    if (!/\bred-color-tr\b/iu.test(attribute(titleRow.attributes, "class"))) continue;
    const title = cleanHtml(titleRow.body).slice(0, 500);
    const valuesRow = rows[index + 2];
    if (!title || !valuesRow || !isRelevantCourseTitle(title)) continue;
    const cells = tableCells(valuesRow);
    if (cells.length < 4) continue;
    const year = titleYear(title, now);
    const range = monthDayRange(cells[1] ?? "", year);
    const registrationRange = monthDayRange(cells[0] ?? "", year);
    const location = (cells[2] ?? "").slice(0, 500);
    if (!range || !location) continue;
    const deadline = registrationRange?.endDate;
    const registration = deadline && deadline < today && range.endDate >= today
      ? { status: "closed" as const, label: "報名已截止" }
      : registrationFromText(cells[3] ?? "", range.endDate, today);
    const onclick = /onclick\s*=\s*"([^"]*)"/iu.exec(titleRow.raw)?.[1]
      ?? /onclick\s*=\s*'([^']*)'/iu.exec(titleRow.raw)?.[1]
      ?? "";
    const detailPath = /window\.location\s*=\s*['"]([^'"]+)['"]/iu.exec(decodeHtml(onclick))?.[1] ?? "";
    const detailUrl = officialUrl(detailPath, REMOC_SOUTH_COURSES_URL, "https://seoc.hosp.ncku.edu.tw", /^\/Remoc\/CourseInfo\.php$/iu)
      || REMOC_SOUTH_COURSES_URL;
    const brochureHref = /<a\b([^>]*)>/iu.exec(valuesRow.body)?.[1] ?? "";
    const brochureUrl = officialUrl(attribute(brochureHref, "href"), REMOC_SOUTH_COURSES_URL, "https://seoc.hosp.ncku.edu.tw", /^\/UploadFiles\/Files\/Course\//iu);
    courses.push({
      id: listingId("south", range.startDate, title, location),
      title,
      region: "south",
      ...range,
      dateLabel: rocDateLabel(range.startDate, range.endDate),
      location,
      registrationLabel: registration.label,
      status: registration.status,
      ...(deadline ? { deadline } : {}),
      sourceName: SOUTH_SOURCE_NAME,
      sourceUrl: REMOC_SOUTH_COURSES_URL,
      detailUrl,
      ...(brochureUrl ? { brochureUrl } : {}),
      recognitionStatus: "pending",
    });
  }
  return courses.sort((left, right) => left.startDate.localeCompare(right.startDate));
}

export type CentralPostCandidate = { title: string; detailUrl: string };

export function parseCentralPostCandidates(html: string): CentralPostCandidate[] {
  if (!/id=["']ContentPlaceHolder1_gvwPost["']/iu.test(html)) throw new Error("central post table not found");
  const candidates: CentralPostCandidate[] = [];
  const seen = new Set<string>();
  for (const row of tableRows(html)) {
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/iu.exec(row.body);
    if (!anchor) continue;
    const title = cleanHtml(anchor[2] ?? "");
    if (!title || !isRelevantCourseTitle(title)) continue;
    const detailUrl = officialUrl(attribute(anchor[1] ?? "", "href"), REMOC_CENTRAL_POSTS_URL, "https://eoc.vghtc.gov.tw", /^\/PostDetail\.aspx$/iu);
    if (!detailUrl || seen.has(detailUrl)) continue;
    seen.add(detailUrl);
    candidates.push({ title, detailUrl });
    if (candidates.length >= MAX_CENTRAL_DETAILS) break;
  }
  return candidates;
}

function spanById(html: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`<span\\b[^>]*id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/span>`, "iu").exec(html)?.[1] ?? "";
}

function announcementCourseTitle(value: string) {
  const quoted = [...value.matchAll(/「([^」]{4,500})」/gu)].map((match) => match[1]?.trim() ?? "").filter(isRelevantCourseTitle);
  return quoted.sort((left, right) => right.length - left.length)[0] ?? value.replace(/^\[教育訓練\]/u, "").trim();
}

function valueAfterLabel(lines: string[], label: RegExp) {
  const line = lines.find((candidate) => label.test(candidate));
  return line?.replace(/^.*?(?:課程地點|上課地點|活動地點)\s*[：:]/u, "").trim() ?? "";
}

function locationFromTitle(value: string) {
  return /[（(](?:專業課程\s*[-－—]\s*)?([^()（）]{2,40}場次)[)）]/u.exec(value)?.[1]?.trim() ?? "";
}

function classifyRegion(title: string, location: string): RegionalCourseListingRegion | null {
  const text = `${title} ${location}`.normalize("NFKC");
  if (/花蓮|臺東|台東|東區緊急醫療|東區REMOC|部東場|慈濟/u.test(text)) return null;
  if (/臺北|台北|新北|基隆|桃園|新竹|苗栗|宜蘭|林口|淡水|北投|北區/u.test(text)) return "north";
  if (/臺中|台中|彰化|南投|中山醫|中榮|中區/u.test(text)) return "central";
  if (/雲林|嘉義|臺南|台南|高雄|屏東|澎湖|成大|成功大學|高屏|南區/u.test(text)) return "south";
  return null;
}

export function parseCentralCourseDetail(html: string, detailUrl: string, now = new Date()): RegionalCourseListing | null {
  const safeDetailUrl = officialUrl(detailUrl, REMOC_CENTRAL_POSTS_URL, "https://eoc.vghtc.gov.tw", /^\/PostDetail\.aspx$/iu);
  if (!safeDetailUrl) return null;
  const rawTitle = cleanHtml(spanById(html, "ContentPlaceHolder1_lblTitle"));
  const title = announcementCourseTitle(rawTitle).slice(0, 500);
  if (!title || !isRelevantCourseTitle(title)) return null;
  const contentHtml = spanById(html, "ContentPlaceHolder1_lblContent");
  const contentLines = htmlLines(contentHtml);
  const location = (cleanHtml(spanById(html, "ContentPlaceHolder1_lblPlace"))
    || valueAfterLabel(contentLines, /(?:課程地點|上課地點|活動地點)\s*[：:]/u)
    || locationFromTitle(rawTitle)).slice(0, 500);
  const timeLine = contentLines.find((line) => /課程時間\s*[：:]/u.test(line)) ?? "";
  const range = parseCourseDateRange(timeLine)
    ?? parseCourseDateRange(rawTitle)
    ?? parseCourseDateRange(cleanHtml(spanById(html, "ContentPlaceHolder1_lblTime")));
  if (!range || !location) return null;
  const region = classifyRegion(`${rawTitle} ${title}`, location);
  if (!region) return null;
  const today = taiwanDateKey(now);
  const contentText = contentLines.join(" ");
  const deadlineLine = contentLines.find((line) => /報名期限\s*[：:]/u.test(line)) ?? "";
  const deadline = parseCourseDateRange(deadlineLine)?.endDate;
  const registration = deadline
    ? deadline < today && range.endDate >= today
      ? { status: "closed" as const, label: "報名已截止" }
      : { status: "open" as const, label: `報名至 ${rocDateLabel(deadline, deadline)}` }
    : registrationFromText(deadlineLine || contentText, range.endDate, today);
  const attachmentRow = /<tr\b[^>]*>[\s\S]*?<td\b[^>]*>\s*附件\s*<\/td>([\s\S]*?)<\/tr>/iu.exec(html)?.[1] ?? "";
  const attachmentAttributes = /<a\b([^>]*)>/iu.exec(attachmentRow)?.[1] ?? "";
  const brochureUrl = officialUrl(attribute(attachmentAttributes, "href"), REMOC_CENTRAL_HOME_URL, "https://eoc.vghtc.gov.tw", /^\/FileHandler\.ashx$/iu);
  return {
    id: listingId(region, range.startDate, title, location),
    title,
    region,
    ...range,
    dateLabel: rocDateLabel(range.startDate, range.endDate),
    location,
    registrationLabel: registration.label,
    status: registration.status,
    ...(deadline ? { deadline } : {}),
    sourceName: CENTRAL_SOURCE_NAME,
    sourceUrl: REMOC_CENTRAL_HOME_URL,
    detailUrl: safeDetailUrl,
    ...(brochureUrl ? { brochureUrl } : {}),
    recognitionStatus: "pending",
  };
}

function deduplicateCourses(courses: RegionalCourseListing[]) {
  const sourceHomeRegion = (course: RegionalCourseListing) => {
    if (course.sourceName === NORTH_SOURCE_NAME) return "north";
    if (course.sourceName === CENTRAL_SOURCE_NAME) return "central";
    return "south";
  };
  const normalizedTitle = (value: string) => value.normalize("NFKC").replace(/\d{3}年度?/gu, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const map = new Map<string, RegionalCourseListing>();
  for (const course of courses) {
    const key = `${course.region}|${course.startDate}|${normalizedTitle(course.title)}`;
    const previous = map.get(key);
    if (!previous || (sourceHomeRegion(course) === course.region && sourceHomeRegion(previous) !== previous.region)) map.set(key, course);
  }
  return [...map.values()]
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title, "zh-Hant"))
    .slice(0, MAX_COURSES);
}

type PageLoader = (url: string) => Promise<string>;
type SourceResult = { status: RegionalCourseSourceStatus; courses: RegionalCourseListing[] };

async function loadNorthSource(loadPage: PageLoader, now: Date): Promise<SourceResult> {
  let status: RegionalCourseSourceStatus = "live";
  let candidates: NorthCourseListingCandidate[];
  try {
    candidates = parseNorthCourseListings(await loadPage(REMOC_NORTH_COURSES_URL), now);
  } catch {
    status = "snapshot";
    candidates = fallbackNorthCourseListings(now);
  }
  const courses = await Promise.all(candidates.map(async (candidate) => {
    if (!candidate.registrationCandidateUrl) {
      return publicNorthCourse(candidate);
    }
    try {
      const html = await loadPage(candidate.registrationCandidateUrl);
      return applyVerifiedNorthRegistration(candidate, html, candidate.registrationCandidateUrl, now);
    } catch {
      return publicNorthCourse(candidate);
    }
  }));
  return { status, courses };
}

async function loadSouthSource(loadPage: PageLoader, now: Date): Promise<SourceResult> {
  try {
    return { status: "live", courses: parseSouthCourseListings(await loadPage(REMOC_SOUTH_COURSES_URL), now) };
  } catch {
    return { status: "unavailable", courses: [] };
  }
}

async function loadCentralSource(loadPage: PageLoader, now: Date): Promise<SourceResult> {
  try {
    const candidates = parseCentralPostCandidates(await loadPage(REMOC_CENTRAL_POSTS_URL));
    const settled = await Promise.allSettled(candidates.map(async (candidate) => (
      parseCentralCourseDetail(await loadPage(candidate.detailUrl), candidate.detailUrl, now)
    )));
    const courses = settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
    const failures = settled.filter((result) => result.status === "rejected").length;
    return { status: failures ? "partial" : "live", courses };
  } catch {
    return { status: "unavailable", courses: [] };
  }
}

export async function refreshRegionalCourseListings(loadPage: PageLoader, now = new Date()): Promise<RegionalCourseListingsPayload> {
  const [north, central, south] = await Promise.all([
    loadNorthSource(loadPage, now),
    loadCentralSource(loadPage, now),
    loadSouthSource(loadPage, now),
  ]);
  const statuses = [north.status, central.status, south.status];
  const liveCount = statuses.filter((status) => status === "live").length;
  const feedStatus = liveCount === statuses.length
    ? "live" as const
    : statuses.some((status) => status === "live" || status === "partial")
      ? "partial" as const
      : statuses.some((status) => status === "snapshot")
        ? "snapshot" as const
        : "unavailable" as const;
  return {
    feedStatus,
    updatedAt: taiwanDateKey(now),
    sources: [
      { region: "north", sourceName: NORTH_SOURCE_NAME, sourceUrl: REMOC_NORTH_COURSES_URL, status: north.status },
      { region: "central", sourceName: CENTRAL_SOURCE_NAME, sourceUrl: REMOC_CENTRAL_HOME_URL, status: central.status },
      { region: "south", sourceName: SOUTH_SOURCE_NAME, sourceUrl: REMOC_SOUTH_COURSES_URL, status: south.status },
    ],
    courses: deduplicateCourses([...north.courses, ...central.courses, ...south.courses]),
  };
}

const ONE_HOUR = 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

export function regionalCourseListingsCacheControl(status: RegionalCourseListingsPayload["feedStatus"]) {
  return status === "live" || status === "partial"
    ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=21600, stale-if-error=86400"
    : "public, max-age=0, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400";
}

export function createRegionalCourseListingsLoader(
  refresh: () => Promise<RegionalCourseListingsPayload>,
  clock: () => number = Date.now,
) {
  let cached: RegionalCourseListingsPayload | null = null;
  let expiresAt = 0;
  let inFlight: Promise<RegionalCourseListingsPayload> | null = null;
  return async function loadRegionalCourseListings() {
    const requestedAt = clock();
    if (cached && requestedAt < expiresAt) return cached;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(refresh)
      .then((feed) => {
        const previous = cached;
        if (!previous) return feed;
        const retainedRegions = new Set(feed.sources
          .filter((source) => source.status === "unavailable" && previous.courses.some((course) => course.region === source.region))
          .map((source) => source.region));
        if (!retainedRegions.size) return feed;
        const sources = feed.sources.map((source) => retainedRegions.has(source.region)
          ? { ...source, status: "snapshot" as const }
          : source);
        const statuses = sources.map((source) => source.status);
        const feedStatus = statuses.every((status) => status === "live")
          ? "live" as const
          : statuses.some((status) => status === "live" || status === "partial")
            ? "partial" as const
            : statuses.some((status) => status === "snapshot")
              ? "snapshot" as const
              : "unavailable" as const;
        return {
          ...feed,
          feedStatus,
          sources,
          courses: deduplicateCourses([
            ...feed.courses,
            ...previous.courses.filter((course) => retainedRegions.has(course.region)),
          ]),
        };
      })
      .catch(() => cached ?? {
        feedStatus: "snapshot" as const,
        updatedAt: taiwanDateKey(new Date()),
        sources: [
          { region: "north" as const, sourceName: NORTH_SOURCE_NAME, sourceUrl: REMOC_NORTH_COURSES_URL, status: "snapshot" as const },
          { region: "central" as const, sourceName: CENTRAL_SOURCE_NAME, sourceUrl: REMOC_CENTRAL_HOME_URL, status: "unavailable" as const },
          { region: "south" as const, sourceName: SOUTH_SOURCE_NAME, sourceUrl: REMOC_SOUTH_COURSES_URL, status: "unavailable" as const },
        ],
        courses: fallbackNorthCourseListings().map(publicNorthCourse),
      })
      .then((feed) => {
        cached = feed;
        expiresAt = requestedAt + (feed.feedStatus === "live" || feed.feedStatus === "partial" ? ONE_HOUR : FIVE_MINUTES);
        return feed;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
