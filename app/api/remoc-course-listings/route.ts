import {
  REMOC_CENTRAL_POSTS_URL,
  REMOC_NORTH_COURSES_URL,
  REMOC_SOUTH_COURSES_URL,
} from "../../lib/remoc-course-listings";
import {
  createRegionalCourseListingsLoader,
  refreshRegionalCourseListings,
  regionalCourseListingsCacheControl,
} from "../../lib/remoc-course-listings.server";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 2_000_000;
const NORTH_REGISTRATION_URL = "https://www.beclass.com/rid=305264569e72b99a331a";

function allowedPageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid source URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("invalid source URL");
  if (url.href === REMOC_NORTH_COURSES_URL || url.href === REMOC_CENTRAL_POSTS_URL || url.href === REMOC_SOUTH_COURSES_URL || url.href === NORTH_REGISTRATION_URL) return url;
  if (url.origin === "https://eoc.vghtc.gov.tw" && url.pathname === "/PostDetail.aspx") {
    const type = url.searchParams.get("Type");
    const key = url.searchParams.get("PK");
    if ((type === "P" || type === "C") && /^\d{1,8}$/u.test(key ?? "") && [...url.searchParams.keys()].every((name) => name === "Type" || name === "PK")) return url;
  }
  throw new Error("unexpected source URL");
}

async function fetchOfficialPage(value: string) {
  const url = allowedPageUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "User-Agent": "EmergencyBoardQuestions/1.0 (+regional-course-index)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = allowedPageUrl(response.url || url.href);
    if (finalUrl.origin !== url.origin) throw new Error("unexpected redirect origin");
    const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("unexpected content type");
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) throw new Error("response too large");
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_HTML_BYTES) throw new Error("response too large");
    return new TextDecoder().decode(body);
  } finally {
    clearTimeout(timeout);
  }
}

const loadRegionalCourseListings = createRegionalCourseListingsLoader(() => refreshRegionalCourseListings(fetchOfficialPage));

export async function GET() {
  const feed = await loadRegionalCourseListings();
  return Response.json(feed, {
    headers: {
      "Cache-Control": regionalCourseListingsCacheControl(feed.feedStatus),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
