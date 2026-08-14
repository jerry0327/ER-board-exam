import {
  createSemDisasterCourseFeedLoader,
  disasterCourseCacheControl,
  refreshSemDisasterCourseFeed,
} from "../../lib/sem-disaster-courses";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_WORKBOOK_BYTES = 8_000_000;
const SEM_ORIGIN = "https://www.sem.org.tw";
const SEM_BLOB_ORIGIN = "https://tsem.blob.core.windows.net";

async function fetchBounded(url: string, accept: string, maxBytes: number, expectedOrigin: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: accept,
        "Accept-Language": "zh-TW,zh;q=0.9",
        "User-Agent": "EmergencyBoardQuestions/1.0 (+official-training-course-index)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (new URL(response.url || url).origin !== expectedOrigin) throw new Error("unexpected redirect origin");
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("response too large");
    const body = await response.arrayBuffer();
    if (body.byteLength > maxBytes) throw new Error("response too large");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFormsPage(url: string) {
  const body = await fetchBounded(url, "text/html,application/xhtml+xml", MAX_HTML_BYTES, SEM_ORIGIN);
  return new TextDecoder().decode(body);
}

async function fetchRecognitionWorkbook(url: string) {
  const parsed = new URL(url);
  if (parsed.origin !== SEM_BLOB_ORIGIN || !parsed.pathname.startsWith("/docfilecontainer/") || !parsed.pathname.toLowerCase().endsWith(".xlsx")) {
    throw new Error("unexpected workbook URL");
  }
  const body = await fetchBounded(
    parsed.toString(),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream",
    MAX_WORKBOOK_BYTES,
    SEM_BLOB_ORIGIN,
  );
  return new Uint8Array(body);
}

const loadSemDisasterCourseFeed = createSemDisasterCourseFeedLoader(() => refreshSemDisasterCourseFeed(fetchFormsPage, fetchRecognitionWorkbook));

export async function GET() {
  const feed = await loadSemDisasterCourseFeed();
  return Response.json(feed, {
    headers: {
      "Cache-Control": disasterCourseCacheControl(feed.status),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
