import { fetchCompressedStatic } from "./compressed-static.ts";
import { plainMarkdownHeading } from "./markdown-heading.ts";

export type BoardTraceTarget = "stem" | `option-${string}`;

export type BoardTraceLocation = {
  unitCode: string;
  paragraphId: string;
  nodeId: string;
  relation: "primary" | "related";
  sectionId?: string | null;
  flags?: string[];
};

export type BoardQuestionTrace = {
  questionId: string;
  canonicalQuestionId?: string;
  aliases?: string[];
  stem: BoardTraceLocation[];
  options: Record<string, BoardTraceLocation[]>;
};

export type BoardTraceHit = {
  canonicalAtomId: string;
  questionId: string;
  canonicalQuestionId?: string;
  aliases?: string[];
  optionKey?: string | null;
};

export type BoardSentenceSelector = {
  paragraphId: string;
  exact: string;
  prefix?: string;
  suffix?: string;
  direct?: string[];
  related?: string[];
};

export type BoardTraceParagraph = {
  direct: string[];
  related: string[];
};

export type BoardTraceUnitData = {
  schemaVersion: number;
  unitCode: string;
  questionRefs: Record<string, string | string[]>;
  paragraphs: Record<string, BoardTraceParagraph>;
  sentences: Record<string, BoardSentenceSelector>;
};

export type BoardTextbookUnit = {
  unitCode: string;
  unitId?: string;
  title: string;
  volume?: string;
  order: number;
  paragraphCount: number;
  directAtomCount?: number;
  relatedAtomCount?: number;
  contentHash?: string;
  markdownPath?: string;
  tracePath?: string;
};

export type BoardTextbookManifest = {
  schemaVersion: number;
  title: string;
  subtitle?: string;
  unitCount: number;
  questionCount: number;
  optionCount: number;
  traceableSentenceCount?: number;
  units: BoardTextbookUnit[];
};

export type BoardTraceHumanLocator = {
  heading: string;
  paragraphOrdinal: number;
  sectionOrdinal: number;
  sentenceOrdinals: Record<string, number>;
};

type BoardTraceRouteShard = {
  schemaVersion: number;
  exam: string;
  questionRoutes: Record<string, string>;
  routes: Record<string, BoardQuestionTrace>;
};

const manifestPath = "/guides/board/manifest.json";
let manifestRequest: Promise<BoardTextbookManifest> | null = null;
const unitDataRequests = new Map<string, Promise<BoardTraceUnitData>>();
const unitMarkdownRequests = new Map<string, Promise<string>>();
const routeShardRequests = new Map<string, Promise<BoardTraceRouteShard>>();
const locatorIndexRequests = new Map<string, Promise<Map<string, BoardTraceHumanLocator>>>();

function requestJson<T>(path: string, label: string) {
  return fetchCompressedStatic(path, { cache: "no-cache" }).then(async (response) => {
    if (!response.ok) throw new Error(`${label}載入失敗`);
    return response.json() as Promise<T>;
  });
}

function requestText(path: string, label: string) {
  return fetchCompressedStatic(path, { cache: "no-cache" }).then(async (response) => {
    if (!response.ok) throw new Error(`${label}載入失敗`);
    return response.text();
  });
}

export function normalizeBoardUnitCode(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().toUpperCase();
}

export function boardTraceTargetLabel(target: BoardTraceTarget) {
  return target === "stem" ? "整題觀念" : `${target.slice("option-".length).toUpperCase()} 選項`;
}

export function boardTraceOptionKey(target: BoardTraceTarget) {
  return target === "stem" ? null : target.slice("option-".length).toUpperCase();
}

export function loadBoardTextbookManifest() {
  if (!manifestRequest) {
    manifestRequest = requestJson<BoardTextbookManifest>(manifestPath, "題庫教科書目錄")
      .catch((error: unknown) => {
        manifestRequest = null;
        throw error;
      });
  }
  return manifestRequest;
}

export function loadBoardTextbookUnitMarkdown(unitCode: string) {
  const code = normalizeBoardUnitCode(unitCode);
  if (!unitMarkdownRequests.has(code)) {
    const request = requestText(`/guides/board/units/${encodeURIComponent(code)}.md`, `${code} 單元正文`)
      .catch((error: unknown) => {
        unitMarkdownRequests.delete(code);
        throw error;
      });
    unitMarkdownRequests.set(code, request);
  }
  return unitMarkdownRequests.get(code)!;
}

export function loadBoardTextbookUnitData(unitCode: string) {
  const code = normalizeBoardUnitCode(unitCode);
  if (!unitDataRequests.has(code)) {
    const request = requestJson<BoardTraceUnitData>(`/guides/board/units/${encodeURIComponent(code)}.json`, `${code} 單元追溯資料`)
      .catch((error: unknown) => {
        unitDataRequests.delete(code);
        throw error;
      });
    unitDataRequests.set(code, request);
  }
  return unitDataRequests.get(code)!;
}

function examFromQuestionId(questionId: string) {
  const match = /^(\d{3}[AB]?)-Q\d{3}$/u.exec(questionId.toUpperCase());
  return match?.[1] ?? "";
}

export function loadBoardQuestionTrace(questionId: string) {
  const id = questionId.toUpperCase();
  const exam = examFromQuestionId(id);
  if (!exam) return Promise.reject(new Error(`無法辨識題號 ${questionId}`));
  if (!routeShardRequests.has(exam)) {
    const request = requestJson<BoardTraceRouteShard>(`/data/board-trace/routes/${encodeURIComponent(exam)}.json`, `${exam} 題目追溯資料`)
      .catch((error: unknown) => {
        routeShardRequests.delete(exam);
        throw error;
      });
    routeShardRequests.set(exam, request);
  }
  return routeShardRequests.get(exam)!.then((shard) => {
    const routeId = shard.questionRoutes[id];
    return routeId ? shard.routes[routeId] ?? null : null;
  });
}

export function traceLocationsForTarget(trace: BoardQuestionTrace | null, target: BoardTraceTarget) {
  if (!trace) return [];
  const optionKey = boardTraceOptionKey(target);
  return optionKey ? trace.options[optionKey] ?? [] : trace.stem ?? [];
}

export function boardTraceLocationKey(location: Pick<BoardTraceLocation, "unitCode" | "paragraphId">) {
  return `${normalizeBoardUnitCode(location.unitCode)}\0${location.paragraphId}`;
}

/** One visible destination per semantic paragraph; primary evidence wins. */
export function reconcileBoardTraceLocations(locations: readonly BoardTraceLocation[]) {
  const groups = new Map<string, BoardTraceLocation[]>();
  for (const location of locations) {
    const key = boardTraceLocationKey(location);
    const group = groups.get(key) ?? [];
    group.push(location);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const primary = group.filter((location) => location.relation === "primary");
    const candidates = primary.length ? primary : group;
    return candidates.find((location) => location.nodeId.startsWith("ts-"))
      ?? candidates.find((location) => location.nodeId === location.paragraphId)
      ?? candidates[0];
  });
}

/**
 * Builds human labels from the shipped Markdown itself. Internal sec-/tp-/ts-
 * identifiers never need to leak into the learner-facing panel.
 */
export function parseBoardTraceLocatorIndex(
  markdown: string,
  data: BoardTraceUnitData,
) {
  const index = new Map<string, BoardTraceHumanLocator>();
  const markerPattern = /^\s*<!--board-trace:([^:>]+):\d+:\d+-->\s*$/u;
  const headingPattern = /^\s*(#{1,6})[\t ]+(.+?)(?:[\t ]+#+[\t ]*)?$/u;
  let sectionOrdinal = 0;
  let paragraphOrdinal = 0;
  let heading = "";
  let pendingParagraphId: string | null = null;
  const blocks = markdown.replace(/\r\n?/gu, "\n").split(/\n[\t ]*\n+/u);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const headingMatch = headingPattern.exec(trimmed);
    if (headingMatch) {
      if (headingMatch[1].length === 3) {
        sectionOrdinal += 1;
        paragraphOrdinal = 0;
        heading = plainMarkdownHeading(headingMatch[2]);
      }
      continue;
    }
    const markerMatch = markerPattern.exec(trimmed);
    if (markerMatch) {
      pendingParagraphId = markerMatch[1];
      continue;
    }
    if (/^\s*<!--[\s\S]*-->\s*$/u.test(trimmed)) continue;
    paragraphOrdinal += 1;
    if (!pendingParagraphId) continue;
    index.set(pendingParagraphId, {
      heading,
      paragraphOrdinal,
      sectionOrdinal,
      sentenceOrdinals: {},
    });
    pendingParagraphId = null;
  }

  const sentenceCounts = new Map<string, number>();
  for (const [nodeId, sentence] of Object.entries(data.sentences)) {
    const next = (sentenceCounts.get(sentence.paragraphId) ?? 0) + 1;
    sentenceCounts.set(sentence.paragraphId, next);
    const locator = index.get(sentence.paragraphId);
    if (locator) locator.sentenceOrdinals[nodeId] = next;
  }
  return index;
}

export function loadBoardTraceLocatorIndex(unitCode: string) {
  const code = normalizeBoardUnitCode(unitCode);
  if (!locatorIndexRequests.has(code)) {
    const request = Promise.all([
      loadBoardTextbookUnitMarkdown(code),
      loadBoardTextbookUnitData(code),
    ]).then(([markdown, data]) => parseBoardTraceLocatorIndex(markdown, data))
      .catch((error: unknown) => {
        locatorIndexRequests.delete(code);
        throw error;
      });
    locatorIndexRequests.set(code, request);
  }
  return locatorIndexRequests.get(code)!;
}

export function primaryTraceLocation(trace: BoardQuestionTrace | null, target: BoardTraceTarget) {
  const locations = traceLocationsForTarget(trace, target);
  return locations.find((location) => location.relation === "primary") ?? locations[0] ?? null;
}

export function resolveBoardTraceHits(data: BoardTraceUnitData | null, atomIds: readonly string[]) {
  if (!data || !atomIds.length) return [];
  const hits: BoardTraceHit[] = [];
  for (const canonicalAtomId of atomIds) {
    const match = /^(ROC\d{3}-[QP]\d{3})(?:-OPT-([A-E]))?$/u.exec(canonicalAtomId);
    if (!match) continue;
    const canonicalQuestionId = match[1];
    const reference = data.questionRefs[canonicalQuestionId];
    if (!reference) continue;
    const aliases = typeof reference === "string" ? [reference] : reference;
    const questionId = aliases[0];
    if (!questionId) continue;
    hits.push({
      canonicalAtomId,
      canonicalQuestionId,
      questionId,
      aliases,
      optionKey: match[2] ?? null,
    });
  }
  return hits;
}

export function prefetchBoardTextbookUnit(unitCode: string) {
  void loadBoardTextbookUnitMarkdown(unitCode).catch(() => undefined);
}
