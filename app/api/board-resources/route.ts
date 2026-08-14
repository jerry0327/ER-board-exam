import {
  createSemResourceFeedLoader,
  refreshSemResourceFeed,
  resourceFeedCacheControl,
} from "../../lib/sem-resource-feed";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 2_000_000;

async function fetchOfficialPage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-TW,zh;q=0.9",
        "User-Agent": "EmergencyBoardQuestions/1.0 (+official-resource-monitor)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.url && new URL(response.url).origin !== "https://www.sem.org.tw") throw new Error("unexpected redirect origin");
    const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("unexpected content type");
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) throw new Error("response too large");
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_HTML_BYTES) throw new Error("response too large");
    return new TextDecoder().decode(body);
  } finally {
    clearTimeout(timeout);
  }
}

const loadSemResourceFeed = createSemResourceFeedLoader((now) => refreshSemResourceFeed(fetchOfficialPage, now));

export async function GET() {
  const feed = await loadSemResourceFeed();
  return Response.json(feed, {
    headers: {
      "Cache-Control": resourceFeedCacheControl(feed.status),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
