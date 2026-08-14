export const REMOC_COURSE_LISTINGS_ENDPOINT = "/api/remoc-course-listings";

export const REMOC_NORTH_COURSES_URL = "https://remocnorth7.webnode.tw/%E7%B7%9A%E4%B8%8A%E5%A0%B1%E5%90%8D/";
export const REMOC_CENTRAL_HOME_URL = "https://eoc.vghtc.gov.tw/Default.aspx";
export const REMOC_CENTRAL_POSTS_URL = "https://eoc.vghtc.gov.tw/PostList.aspx";
export const REMOC_SOUTH_COURSES_URL = "https://seoc.hosp.ncku.edu.tw/Remoc/Course.php";

export type RegionalCourseListingRegion = "north" | "central" | "south";
export type RegionalCourseRegistrationStatus = "open" | "full" | "closed" | "unknown";
export type RegionalCourseSourceStatus = "live" | "partial" | "snapshot" | "unavailable";
export type RegionalCourseListingsFeedStatus = "live" | "partial" | "snapshot" | "unavailable";

export type RegionalCourseListing = {
  id: string;
  title: string;
  region: RegionalCourseListingRegion;
  startDate: string;
  endDate: string;
  dateLabel: string;
  location: string;
  registrationLabel: string;
  status: RegionalCourseRegistrationStatus;
  deadline?: string;
  sourceName: string;
  sourceUrl: string;
  detailUrl: string;
  brochureUrl?: string;
  recognitionStatus: "pending";
};

export type RegionalCourseListingSource = {
  region: RegionalCourseListingRegion;
  sourceName: string;
  sourceUrl: string;
  status: RegionalCourseSourceStatus;
};

export type RegionalCourseListingsPayload = {
  feedStatus: RegionalCourseListingsFeedStatus;
  updatedAt: string;
  sources: RegionalCourseListingSource[];
  courses: RegionalCourseListing[];
};

const allowedRegions = new Set<RegionalCourseListingRegion>(["north", "central", "south"]);
const allowedRegistrationStatuses = new Set<RegionalCourseRegistrationStatus>(["open", "full", "closed", "unknown"]);
const allowedSourceStatuses = new Set<RegionalCourseSourceStatus>(["live", "partial", "snapshot", "unavailable"]);
const allowedFeedStatuses = new Set<RegionalCourseListingsFeedStatus>(["live", "partial", "snapshot", "unavailable"]);
const allowedHosts = new Set(["remocnorth7.webnode.tw", "eoc.vghtc.gov.tw", "seoc.hosp.ncku.edu.tw", "www.beclass.com"]);

function safeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeIsoDate(value: unknown) {
  const text = safeText(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : "";
}

function safeOfficialUrl(value: unknown) {
  const text = safeText(value, 1_500);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export function normalizeRegionalCourseListingsPayload(value: unknown): RegionalCourseListingsPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<RegionalCourseListingsPayload>;
  if (!allowedFeedStatuses.has(input.feedStatus as RegionalCourseListingsFeedStatus)) return null;
  const updatedAt = safeIsoDate(input.updatedAt);
  if (!updatedAt || !Array.isArray(input.sources) || !Array.isArray(input.courses)) return null;

  const sources = input.sources.slice(0, 3).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const source = candidate as Partial<RegionalCourseListingSource>;
    const region = allowedRegions.has(source.region as RegionalCourseListingRegion)
      ? source.region as RegionalCourseListingRegion
      : null;
    const sourceName = safeText(source.sourceName, 120);
    const sourceUrl = safeOfficialUrl(source.sourceUrl);
    const status = allowedSourceStatuses.has(source.status as RegionalCourseSourceStatus)
      ? source.status as RegionalCourseSourceStatus
      : null;
    if (!region || !sourceName || !sourceUrl || !status) return [];
    return [{ region, sourceName, sourceUrl, status }];
  });

  const courses = input.courses.slice(0, 100).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<RegionalCourseListing>;
    const id = safeText(item.id, 160);
    const title = safeText(item.title);
    const region = allowedRegions.has(item.region as RegionalCourseListingRegion)
      ? item.region as RegionalCourseListingRegion
      : null;
    const startDate = safeIsoDate(item.startDate);
    const endDate = safeIsoDate(item.endDate);
    const dateLabel = safeText(item.dateLabel, 100);
    const location = safeText(item.location);
    const registrationLabel = safeText(item.registrationLabel, 160);
    const status = allowedRegistrationStatuses.has(item.status as RegionalCourseRegistrationStatus)
      ? item.status as RegionalCourseRegistrationStatus
      : null;
    const deadline = item.deadline === undefined ? undefined : safeIsoDate(item.deadline);
    const sourceName = safeText(item.sourceName, 120);
    const sourceUrl = safeOfficialUrl(item.sourceUrl);
    const detailUrl = safeOfficialUrl(item.detailUrl);
    const brochureUrl = item.brochureUrl === undefined ? undefined : safeOfficialUrl(item.brochureUrl);
    if (
      !id || !title || !region || !startDate || !endDate || endDate < startDate || !dateLabel || !location
      || !registrationLabel || !status || (item.deadline !== undefined && !deadline) || !sourceName || !sourceUrl
      || !detailUrl || (item.brochureUrl !== undefined && !brochureUrl) || item.recognitionStatus !== "pending"
    ) return [];
    return [{
      id,
      title,
      region,
      startDate,
      endDate,
      dateLabel,
      location,
      registrationLabel,
      status,
      ...(deadline ? { deadline } : {}),
      sourceName,
      sourceUrl,
      detailUrl,
      ...(brochureUrl ? { brochureUrl } : {}),
      recognitionStatus: "pending" as const,
    }];
  });

  return {
    feedStatus: input.feedStatus as RegionalCourseListingsFeedStatus,
    updatedAt,
    sources,
    courses,
  };
}
