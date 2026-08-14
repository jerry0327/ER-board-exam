import { strFromU8, unzipSync } from "fflate";
import snapshotData from "../data/sem-recognized-courses.snapshot.json" with { type: "json" };
import {
  SEM_RECOGNITION_FORMS_URL,
  groupRecognizedCourses,
  mergeRecognizedCourses,
  recognizedCourseFromRow,
  type SemRecognitionFeed,
  type SemRecognizedCourse,
} from "./sem-recognized-courses.ts";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_TTL_MS = 20 * 60 * 1000;
const ALLOWED_HOSTS = new Set(["www.sem.org.tw", "tsem.blob.core.windows.net"]);

type SnapshotShape = {
  updatedAt: string;
  sourceUrl: string;
  sourceRevision: string;
  courses: SemRecognizedCourse[];
};

const snapshot = snapshotData as SnapshotShape;

function decodeXml(value: string) {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function safeOfficialUrl(value: string) {
  const url = new URL(decodeXml(value), SEM_RECOGNITION_FORMS_URL);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) throw new Error("課程來源網址不在允許範圍內");
  return url.href;
}

export function discoverRecognitionWorkbookUrl(html: string) {
  const candidates = [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.xlsx(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .flatMap((match) => {
      const href = match[1];
      const label = decodeXml(match[2].replace(/<[^>]+>/gu, " "));
      let decoded = href;
      try { decoded = decodeURIComponent(href); } catch { /* keep the original URL text */ }
      const searchable = `${label} ${decoded}`;
      if (!/住院醫師災難醫學訓練課程時數認證清單/u.test(searchable)) return [];
      try {
        const url = new URL(safeOfficialUrl(href));
        if (url.hostname !== "tsem.blob.core.windows.net" || !url.pathname.startsWith("/docfilecontainer/") || !url.pathname.toLocaleLowerCase().endsWith(".xlsx")) return [];
        const revision = [...searchable.matchAll(/(?<!\d)(\d{7})(?!\d)/gu)].map((entry) => entry[1]).sort().at(-1) ?? "";
        url.hash = "";
        return [{ url: url.href, revision }];
      } catch { return []; }
    });
  // A fixed annual workbook must never be treated as a live discovery result.
  // When the official index has no matching entry, the loader will retain its
  // last successful feed or fall back to the bundled, explicitly dated snapshot.
  return candidates.sort((left, right) => right.revision.localeCompare(left.revision))[0]?.url ?? null;
}

function xmlFile(files: Record<string, Uint8Array>, path: string) {
  const bytes = files[path];
  if (!bytes) throw new Error(`認證表缺少 ${path}`);
  return strFromU8(bytes);
}

function sharedStrings(files: Record<string, Uint8Array>) {
  const xml = files["xl/sharedStrings.xml"] ? xmlFile(files, "xl/sharedStrings.xml") : "";
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map((match) => (
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((part) => decodeXml(part[1])).join("")
  ));
}

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/u.exec(reference)?.[0] ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

export function worksheetRows(xml: string, strings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const row = Array.from({ length: 10 }, () => "");
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const reference = /\br=["']([A-Z]+\d+)["']/u.exec(cellMatch[1])?.[1] ?? "A1";
      const index = columnIndex(reference);
      if (index < 0 || index >= 10) continue;
      const type = /\bt=["']([^"']+)["']/u.exec(cellMatch[1])?.[1] ?? "";
      const body = cellMatch[2] ?? "";
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/u.exec(body)?.[1]
        ?? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((part) => part[1]).join("");
      row[index] = type === "s" ? strings[Number(raw)] ?? "" : decodeXml(raw ?? "");
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function workbookSheets(files: Record<string, Uint8Array>) {
  const workbook = xmlFile(files, "xl/workbook.xml");
  const relationships = xmlFile(files, "xl/_rels/workbook.xml.rels");
  const targets = new Map([...relationships.matchAll(/<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["'][^>]*\/>/gu)]
    .map((match) => [match[1], match[2].replace(/^\//u, "")]));
  return [...workbook.matchAll(/<sheet\b[^>]*\bname=["']([^"']+)["'][^>]*\br:id=["']([^"']+)["'][^>]*\/>/gu)].map((match) => {
    const target = targets.get(match[2]);
    const path = target?.startsWith("xl/") ? target : `xl/${target ?? ""}`;
    return { name: decodeXml(match[1]), path };
  });
}

export function parseRecognitionWorkbook(bytes: Uint8Array, sourceUrl: string, sourceRevision: string) {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("認證表不是有效的 XLSX 檔案");
  if (bytes.byteLength > MAX_XLSX_BYTES) throw new Error("認證表檔案超過安全大小");
  const files = unzipSync(bytes);
  if (Object.keys(files).length > 200) throw new Error("認證表檔案項目過多");
  const totalSize = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
  if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new Error("認證表解壓後超過安全大小");
  const strings = sharedStrings(files);
  const sheets = workbookSheets(files);
  if (!sheets.length || sheets.length > 20) throw new Error("認證表工作表數量不正確");
  const courses: SemRecognizedCourse[] = [];
  for (const sheet of sheets) {
    for (const row of worksheetRows(xmlFile(files, sheet.path), strings)) {
      const course = recognizedCourseFromRow(sheet.name, row, sourceUrl, sourceRevision);
      if (course) courses.push(course);
    }
  }
  if (courses.length < 300 || courses.length > 2_000) throw new Error("認證表資料筆數異常");
  return groupRecognizedCourses(courses);
}

async function fetchBounded(url: string, accept: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeOfficialUrl(url), {
      headers: { Accept: accept, "User-Agent": "EmergencyBoardCourseIndex/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`官方來源回應 ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshRecognitionFeed(): Promise<SemRecognitionFeed> {
  const forms = await fetchBounded(SEM_RECOGNITION_FORMS_URL, "text/html");
  const workbookUrl = discoverRecognitionWorkbookUrl(await forms.text());
  if (!workbookUrl) throw new Error("官方索引找不到認證清單");
  const workbook = await fetchBounded(workbookUrl, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const contentLength = Number(workbook.headers.get("content-length") ?? "0");
  if (contentLength > MAX_XLSX_BYTES) throw new Error("認證表檔案超過安全大小");
  const bytes = new Uint8Array(await workbook.arrayBuffer());
  const filename = decodeURIComponent(new URL(workbookUrl).pathname.split("/").at(-1) ?? "");
  const filenameRevision = /\((\d{6,8})更新\)/u.exec(filename)?.[1] ?? "";
  const lastModified = workbook.headers.get("last-modified") ?? "";
  const revision = filenameRevision || lastModified || workbook.headers.get("etag")?.replace(/^W\//u, "") || "";
  const liveCourses = parseRecognitionWorkbook(bytes, workbookUrl, revision);
  return {
    status: "live",
    updatedAt: sourceUpdatedAt(filenameRevision, lastModified),
    sourceUrl: workbookUrl,
    sourceRevision: revision,
    courses: mergeRecognizedCourses(snapshot.courses, liveCourses),
  };
}

function snapshotFeed(): SemRecognitionFeed {
  return {
    status: "snapshot",
    updatedAt: snapshot.updatedAt,
    sourceUrl: snapshot.sourceUrl,
    sourceRevision: snapshot.sourceRevision,
    courses: snapshot.courses,
  };
}

function sourceUpdatedAt(revision: string, lastModified: string) {
  const match = /^(\d{2,3})(\d{2})(\d{2})$/u.exec(revision);
  if (match) {
    const year = Number(match[1]) + 1911;
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
      return `${year}-${match[2]}-${match[3]}`;
    }
  }
  if (lastModified) {
    const parsed = new Date(lastModified);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return "";
}

type FeedRefresher = () => Promise<SemRecognitionFeed>;

export function createSemRecognitionFeedLoader(
  refresh: FeedRefresher,
  clock: () => number = Date.now,
) {
  let cached: { expiresAt: number; value: SemRecognitionFeed } | null = null;
  let refreshPromise: Promise<SemRecognitionFeed> | null = null;

  return async function loadSemRecognitionFeed() {
    const now = clock();
    if (cached && cached.expiresAt > now) return cached.value;
    if (!refreshPromise) {
      refreshPromise = Promise.resolve()
        .then(refresh)
        .then((value) => {
          cached = { value, expiresAt: clock() + CACHE_TTL_MS };
          return value;
        })
        .catch(() => {
          const previous = cached?.value;
          const value = previous
            ? previous.status === "snapshot" ? previous : { ...previous, status: "partial" as const }
            : snapshotFeed();
          cached = { value, expiresAt: clock() + RETRY_TTL_MS };
          return value;
        })
        .finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  };
}

const loadSemRecognitionFeed = createSemRecognitionFeedLoader(refreshRecognitionFeed);

export async function getSemRecognitionFeed() {
  return loadSemRecognitionFeed();
}
