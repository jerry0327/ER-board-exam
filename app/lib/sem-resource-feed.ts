export type SemCourseSource = "sem-hosted" | "external-credit" | "aha";

export type SemCourse = {
  id: string;
  title: string;
  organizer: string;
  date: string;
  credits: number | null;
  sponsorType: string;
  registrationStatus: string;
  url: string;
  source: SemCourseSource;
};

export type SemAnnouncement = {
  id: string;
  title: string;
  date: string;
  url: string;
};

export type SemNews = SemAnnouncement & {
  category: string;
};

export type SemResourceFeed = {
  status: "live" | "partial" | "snapshot";
  updatedAt: string;
  courses: SemCourse[];
  announcements: SemAnnouncement[];
  news: SemNews[];
  sourceFailures: string[];
  recognitionNotice: string;
};

const SEM_ORIGIN = "https://www.sem.org.tw";
const FALLBACK_UPDATED_AT = "2026-07-18T00:00:00+08:00";
const SEM_ANNOUNCEMENT_SOURCE_LABEL = "專科甄審公告";
const SEM_NEWS_SOURCE_LABEL = "學會新聞公告";
const SEM_ANNOUNCEMENT_LIMIT = 8;
const SEM_NEWS_LIMIT = 12;
export const SEM_RECOGNITION_NOTICE = "報名前，請向訓練醫院確認課程是否可列入必修時數。";

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

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lt: "<",
  mdash: "—",
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
      const validScalar = Number.isInteger(point) && point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
      return validScalar ? String.fromCodePoint(point) : entity;
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

function paragraph(body: string, className: string) {
  const pattern = new RegExp(`<p\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>`, "iu");
  return cleanHtml(pattern.exec(body)?.[1] ?? "");
}

function absoluteSemUrl(path: string) {
  try {
    const url = new URL(decodeHtml(path.trim()), SEM_ORIGIN);
    if (url.origin !== SEM_ORIGIN || url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedDate(value: string) {
  const match = /\b(20\d{2})\/(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\b/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sourceFromPath(path: string): SemCourseSource {
  if (/\/Activity\/B\//iu.test(path)) return "external-credit";
  if (/\/Activity\/AHA\//iu.test(path)) return "aha";
  return "sem-hosted";
}

export function parseSemCourseHtml(html: string): SemCourse[] {
  const courses: SemCourse[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  const activeHtml = stripInactiveHtml(html);

  while ((match = anchorPattern.exec(activeHtml))) {
    const attributes = match[1] ?? "";
    if (!/class\s*=\s*["'][^"']*\bAHA-item\b[^"']*["']/iu.test(attributes)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1] ?? "";
    const url = absoluteSemUrl(href);
    if (!url) continue;
    const path = new URL(url).pathname;
    const idMatch = /^\/Activity\/(AHA|A|B)\/Details\/(\d+)\/?$/iu.exec(path);
    if (!idMatch) continue;
    const id = `${idMatch[1].toUpperCase()}:${idMatch[2]}`;
    if (seen.has(id)) continue;

    const body = match[2] ?? "";
    const dateText = paragraph(body, "date");
    const date = normalizedDate(dateText);
    const title = paragraph(body, "title").slice(0, 500);
    if (!title || !date) continue;
    const creditMatch = /積分\s*(\d+(?:\.\d+)?)/u.exec(dateText);
    const parsedCredits = creditMatch ? Number(creditMatch[1]) : null;
    const registrationStatus = ["即將截止", "報名中", "已額滿", "報名截止", "尚未開放", "已取消"]
      .find((status) => dateText.includes(status)) ?? "報名狀態未標示";
    const sponsorType = ["非學會主辦", "學會主辦", "AHA"]
      .find((type) => dateText.includes(type)) ?? (sourceFromPath(path) === "aha" ? "AHA" : "積分活動");

    seen.add(id);
    courses.push({
      id,
      title,
      organizer: paragraph(body, "description").slice(0, 800),
      date,
      credits: parsedCredits !== null && Number.isFinite(parsedCredits) && parsedCredits >= 0 && parsedCredits <= 1000 ? parsedCredits : null,
      sponsorType,
      registrationStatus,
      url,
      source: sourceFromPath(path),
    });
  }

  return courses.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, "zh-Hant"));
}

type ParsedSemNewsLink = {
  articleId: string;
  category: string;
  title: string;
  date: string;
  url: string;
};

function parseSemNewsLinks(html: string): ParsedSemNewsLink[] {
  const news: ParsedSemNewsLink[] = [];
  const seen = new Map<string, number>();
  const activeHtml = stripInactiveHtml(html);
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/giu;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(activeHtml))) {
    const row = rowMatch[0] ?? "";
    const date = normalizedDate(cleanHtml(row));
    if (!date) continue;
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchorPattern.exec(row))) {
      const href = /href\s*=\s*["']([^"']+)["']/iu.exec(anchorMatch[1] ?? "")?.[1] ?? "";
      const url = absoluteSemUrl(href);
      if (!url) continue;
      const idMatch = /^\/News\/(?:([a-z\d_-]+)\/)?Details\/(\d+)\/?$/iu.exec(new URL(url).pathname);
      const category = idMatch ? (idMatch[1] ?? "all") : null;
      const articleId = idMatch?.[2];
      if (!category || !articleId) continue;
      const title = cleanHtml(anchorMatch[2] ?? "").slice(0, 500);
      if (!title) continue;

      const existingIndex = seen.get(articleId);
      if (existingIndex !== undefined) {
        const existing = news[existingIndex];
        if (existing?.category === "all" && category !== "all") news[existingIndex] = { articleId, category, title, date, url };
        continue;
      }
      seen.set(articleId, news.length);
      news.push({ articleId, category, title, date, url });
    }
  }

  return news.sort((left, right) => right.date.localeCompare(left.date) || right.articleId.localeCompare(left.articleId));
}

export function parseSemAnnouncementHtml(html: string): SemAnnouncement[] {
  return parseSemNewsLinks(html)
    .filter((item) => item.category === "7" || item.category === "all")
    .map(({ articleId: id, title, date, url }) => ({ id, title, date, url }))
    .slice(0, SEM_ANNOUNCEMENT_LIMIT);
}

export function parseSemNewsHtml(html: string): SemNews[] {
  return parseSemNewsLinks(html)
    .map(({ articleId: id, category, title, date, url }) => ({ id, category, title, date, url }))
    .slice(0, SEM_NEWS_LIMIT);
}

export const fallbackSemCourses: SemCourse[] = [
  { id: "A:33135", title: "「115年度醫療整備計畫」(非外科系)醫事人員外傷照護訓練課程【北區】", organizer: "衛生福利部、急診醫學會", date: "2026-07-19", credits: 4, sponsorType: "學會主辦", registrationStatus: "報名截止", url: `${SEM_ORIGIN}/Activity/A/Details/33135`, source: "sem-hosted" },
  { id: "A:32964", title: "115年度中毒個案討論會–中區", organizer: "社團法人台灣急診醫學會、秀傳紀念醫院", date: "2026-07-20", credits: 3, sponsorType: "學會主辦", registrationStatus: "報名截止", url: `${SEM_ORIGIN}/Activity/A/Details/32964`, source: "sem-hosted" },
  { id: "A:33136", title: "「115年度醫療整備計畫」(非外科系)醫事人員外傷照護訓練課程【高屏區】", organizer: "衛生福利部、急診醫學會", date: "2026-07-22", credits: 4, sponsorType: "學會主辦", registrationStatus: "報名中", url: `${SEM_ORIGIN}/Activity/A/Details/33136`, source: "sem-hosted" },
  { id: "A:32647", title: "115年師資培育工作坊 (中區)", organizer: "社團法人台灣急診醫學會、中山醫學大學附設醫院", date: "2026-07-28", credits: 4, sponsorType: "學會主辦", registrationStatus: "報名截止", url: `${SEM_ORIGIN}/Activity/A/Details/32647`, source: "sem-hosted" },
  { id: "A:33137", title: "「115年度醫療整備計畫」(非外科系)醫事人員外傷照護訓練課程【中區】", organizer: "衛生福利部、社團法人台灣急診醫學會", date: "2026-07-31", credits: 4, sponsorType: "學會主辦", registrationStatus: "報名中", url: `${SEM_ORIGIN}/Activity/A/Details/33137`, source: "sem-hosted" },
  { id: "A:33112", title: "急性中毒救命課程（AILS Training Course）-115年第3場", organizer: "社團法人台灣急診醫學會、中國醫藥大學附設醫院", date: "2026-08-23", credits: 15, sponsorType: "學會主辦", registrationStatus: "報名截止", url: `${SEM_ORIGIN}/Activity/A/Details/33112`, source: "sem-hosted" },
  { id: "A:33173", title: "高擬真中毒症候群訓練課程（TSTC）", organizer: "社團法人台灣急診醫學會、林口長庚紀念醫院", date: "2026-09-21", credits: 6, sponsorType: "學會主辦", registrationStatus: "已額滿", url: `${SEM_ORIGIN}/Activity/A/Details/33173`, source: "sem-hosted" },
  { id: "A:33127", title: "「115年度醫療整備計畫」(非外科系)醫事人員外傷照護訓練課程【台北區】", organizer: "衛生福利部、社團法人台灣急診醫學會", date: "2026-10-03", credits: 4, sponsorType: "學會主辦", registrationStatus: "報名中", url: `${SEM_ORIGIN}/Activity/A/Details/33127`, source: "sem-hosted" },
];

export const fallbackSemAnnouncements: SemAnnouncement[] = [
  { id: "1619", title: "公告115年度急診醫學科專科醫師甄審合格人員名單", date: "2026-07-06", url: `${SEM_ORIGIN}/News/7/Details/1619` },
  { id: "1603", title: "公告115年度急診醫學科專科醫師甄審初審合格名單", date: "2026-06-06", url: `${SEM_ORIGIN}/News/7/Details/1603` },
  { id: "1581", title: "公告115年度急診醫學科專科醫師甄審口試程序說明", date: "2026-05-11", url: `${SEM_ORIGIN}/News/7/Details/1581` },
  { id: "1578", title: "公告115年度急診醫學科專科醫師甄審筆試試題及答案", date: "2026-05-09", url: `${SEM_ORIGIN}/News/7/Details/1578` },
  { id: "1577", title: "公告115年度急診醫學科專科醫師甄審試題申覆程序", date: "2026-05-09", url: `${SEM_ORIGIN}/News/7/Details/1577` },
  { id: "1517", title: "115年度急診醫學科專科醫師甄審初審簡章公告", date: "2025-12-24", url: `${SEM_ORIGIN}/News/7/Details/1517` },
];

export function fallbackSemResourceFeed(now = new Date(), sourceFailures: string[] = []): SemResourceFeed {
  const today = taiwanDateKey(now);
  return {
    status: "snapshot",
    updatedAt: FALLBACK_UPDATED_AT,
    courses: fallbackSemCourses.filter((course) => course.date >= today),
    announcements: [...fallbackSemAnnouncements],
    news: [],
    sourceFailures: [...new Set(sourceFailures)],
    recognitionNotice: SEM_RECOGNITION_NOTICE,
  };
}

/** Keep last-known official slices when a refresh cannot safely replace them. */
export function preserveStaleSemResourceFeed(previous: SemResourceFeed | null, refreshed: SemResourceFeed, now = new Date()) {
  if (!previous) return refreshed;

  if (refreshed.status === "partial") {
    const preserveAnnouncements = refreshed.sourceFailures.includes(SEM_ANNOUNCEMENT_SOURCE_LABEL) && previous.announcements.length > 0;
    const preserveNews = refreshed.sourceFailures.includes(SEM_NEWS_SOURCE_LABEL) && previous.news.length > 0;
    if (preserveAnnouncements || preserveNews) {
      return {
        ...refreshed,
        announcements: preserveAnnouncements
          ? previous.announcements
              .slice()
              .sort((left, right) => right.date.localeCompare(left.date))
              .slice(0, SEM_ANNOUNCEMENT_LIMIT)
          : refreshed.announcements,
        news: preserveNews
          ? previous.news
              .slice()
              .sort((left, right) => right.date.localeCompare(left.date))
              .slice(0, SEM_NEWS_LIMIT)
          : refreshed.news,
      };
    }
  }

  if (refreshed.status !== "snapshot") return refreshed;
  const today = taiwanDateKey(now);
  const courseMap = new Map(refreshed.courses.map((course) => [course.id, course]));
  for (const course of previous.courses) {
    if (course.date >= today) courseMap.set(course.id, course);
  }
  const announcementMap = new Map(refreshed.announcements.map((announcement) => [announcement.id, announcement]));
  for (const announcement of previous.announcements) announcementMap.set(announcement.id, announcement);
  const newsMap = new Map(refreshed.news.map((item) => [item.id, item]));
  for (const item of previous.news) newsMap.set(item.id, item);
  return {
    ...previous,
    status: "snapshot" as const,
    courses: [...courseMap.values()]
      .filter((course) => course.date >= today)
      .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, "zh-Hant"))
      .slice(0, 40),
    announcements: [...announcementMap.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, SEM_ANNOUNCEMENT_LIMIT),
    news: [...newsMap.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, SEM_NEWS_LIMIT),
    sourceFailures: refreshed.sourceFailures,
    recognitionNotice: refreshed.recognitionNotice,
  };
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const semResourceSourcePages = [
  { label: "學會主辦積分活動", url: "https://www.sem.org.tw/Activity/A/Index", kind: "course" },
  { label: "非學會主辦積分活動", url: "https://www.sem.org.tw/Activity/B/Index", kind: "course" },
  { label: "AHA 急救教育訓練", url: "https://www.sem.org.tw/Activity/AHA/Index", kind: "course" },
  { label: SEM_ANNOUNCEMENT_SOURCE_LABEL, url: "https://www.sem.org.tw/News/7/Index", kind: "announcement" },
  { label: SEM_NEWS_SOURCE_LABEL, url: "https://www.sem.org.tw/News", kind: "news" },
] as const;

type PageLoader = (url: string) => Promise<string>;
type FeedRefresh = (now: Date) => Promise<SemResourceFeed>;

function recognizableEmptyCourseIndex(html: string, url: string) {
  const contentRegion = /class\s*=\s*["'][^"']*\bcontent-left\b[^"']*["']/iu.test(html);
  const expectedHeading = url.includes("/AHA/") ? /AHA\s*急救教育訓練/iu : /課程列表/iu;
  return contentRegion && expectedHeading.test(html);
}

export async function refreshSemResourceFeed(loadPage: PageLoader, now = new Date()): Promise<SemResourceFeed> {
  const results = await Promise.allSettled(semResourceSourcePages.map(async (source) => ({ source, html: await loadPage(source.url) })));
  const failures: string[] = [];
  const courseMap = new Map<string, SemCourse>();
  const fallback = fallbackSemResourceFeed(now);
  let announcements = fallback.announcements;
  let news = fallback.news;
  let successfulSources = 0;

  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failures.push(semResourceSourcePages[index]?.label ?? "官方來源");
      continue;
    }
    const { source, html } = result.value;
    try {
      if (source.kind === "course") {
        const parsed = parseSemCourseHtml(html);
        if (!parsed.length && !recognizableEmptyCourseIndex(html, source.url)) {
          failures.push(source.label);
          continue;
        }
        successfulSources += 1;
        for (const course of parsed) courseMap.set(course.id, course);
      } else if (source.kind === "announcement") {
        const parsed = parseSemAnnouncementHtml(html);
        if (!parsed.length) {
          failures.push(source.label);
          continue;
        }
        successfulSources += 1;
        announcements = parsed;
      } else {
        const parsed = parseSemNewsHtml(html);
        if (!parsed.length) {
          failures.push(source.label);
          continue;
        }
        successfulSources += 1;
        news = parsed;
      }
    } catch {
      failures.push(source.label);
    }
  }

  if (successfulSources === 0) {
    return fallbackSemResourceFeed(now, failures.length ? failures : semResourceSourcePages.map((source) => source.label));
  }

  if (![...courseMap.values()].some((course) => course.source === "sem-hosted")) {
    for (const course of fallback.courses) courseMap.set(course.id, course);
  }

  const today = taiwanDateKey(now);
  return {
    status: successfulSources === semResourceSourcePages.length ? "live" : "partial",
    updatedAt: now.toISOString(),
    courses: [...courseMap.values()]
      .filter((course) => course.date >= today)
      .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, "zh-Hant"))
      .slice(0, 40),
    announcements,
    news,
    sourceFailures: [...new Set(failures)],
    recognitionNotice: SEM_RECOGNITION_NOTICE,
  };
}

function cacheDuration(status: SemResourceFeed["status"]) {
  if (status === "live") return SIX_HOURS;
  if (status === "partial") return THIRTY_MINUTES;
  return FIFTEEN_MINUTES;
}

export function resourceFeedCacheControl(status: SemResourceFeed["status"]) {
  if (status === "live") return "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=86400";
  if (status === "partial") return "public, max-age=0, s-maxage=1800, stale-while-revalidate=3600, stale-if-error=86400";
  return "public, max-age=0, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400";
}

/** Per-isolate cache with in-flight de-duplication; CDN caching remains additive. */
export function createSemResourceFeedLoader(refresh: FeedRefresh, clock: () => number = Date.now) {
  let cachedFeed: SemResourceFeed | null = null;
  let expiresAt = 0;
  let inFlight: Promise<SemResourceFeed> | null = null;

  return async function loadSemResourceFeed() {
    const requestedAt = clock();
    if (cachedFeed && requestedAt < expiresAt) return cachedFeed;
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => refresh(new Date(requestedAt)))
      .then((refreshed) => {
        const next = preserveStaleSemResourceFeed(cachedFeed, refreshed, new Date(requestedAt));
        cachedFeed = next;
        expiresAt = clock() + cacheDuration(next.status);
        return next;
      })
      .catch(() => {
        const snapshot = fallbackSemResourceFeed(new Date(requestedAt), semResourceSourcePages.map((source) => source.label));
        const next = preserveStaleSemResourceFeed(cachedFeed, snapshot, new Date(requestedAt));
        cachedFeed = next;
        expiresAt = clock() + FIFTEEN_MINUTES;
        return next;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
