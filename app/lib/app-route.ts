import type { NavView } from "./types";
import { isAilsPageId, normalizeAilsPageId, type AilsPageId } from "./ails-review.ts";
import { parseRosensSupplementalSectionId } from "./supplemental-guide-ids.ts";

const routeViews: Record<string, NavView> = {
  dashboard: "總覽",
  practice: "開始作答",
  browse: "題庫瀏覽",
  reader: "詳解閱讀",
  guides: "學習指引",
  audio: "學習音檔",
  documents: "學習文件",
  review: "錯題本",
  notebook: "筆記本",
  analytics: "學習分析",
  prep: "備考中心",
  rest: "休息站",
};

export type AppRoute = {
  view: NavView;
  resourceId: string | null;
  annotationId: string | null;
  textbookId?: GuideTextbookId;
  guideModuleId?: GuideModuleId;
  traceNodeId?: string;
  traceQuestionId?: string;
  traceTarget?: BoardTraceRouteTarget;
};

export type GuideTextbookId = "tintinalli" | "rosens";
export type GuideModuleId = "ails" | "board" | "ems" | "goldfrank";
export type BoardTraceRouteTarget = "stem" | `option-${string}`;
export type AilsRouteId = AilsPageId | "answers";
export type PrepRouteId =
  | "checklist"
  | "recognized"
  | "upcoming/society"
  | "upcoming/remoc/north"
  | "upcoming/remoc/central"
  | "upcoming/remoc/south"
  | "exam";

const prepRouteIds = new Set<PrepRouteId>([
  "checklist",
  "recognized",
  "upcoming/society",
  "upcoming/remoc/north",
  "upcoming/remoc/central",
  "upcoming/remoc/south",
  "exam",
]);

export function normalizePrepRouteId(value: string | null | undefined): PrepRouteId {
  const normalized = (value ?? "").toLowerCase() as PrepRouteId;
  return prepRouteIds.has(normalized) ? normalized : "checklist";
}

export function isAilsRouteId(value: string | null | undefined): value is AilsRouteId {
  return value === "answers" || isAilsPageId(value);
}

export function parseAppHash(hash: string): AppRoute {
  const [name, rawResource, thirdSegment, fourthSegment, fifthSegment, ...remainingSegments] = hash.replace(/^#/, "").split("/");
  const view = routeViews[name] ?? "總覽";
  let resourceId: string | null = null;
  let annotationId: string | null = null;
  let textbookId: GuideTextbookId | undefined;
  let guideModuleId: GuideModuleId | undefined;
  let traceNodeId: string | undefined;
  let traceQuestionId: string | undefined;
  let traceTarget: BoardTraceRouteTarget | undefined;
  if (view === "學習指引" && rawResource === "ails") {
    guideModuleId = "ails";
    resourceId = isAilsRouteId(thirdSegment) ? thirdSegment : normalizeAilsPageId(thirdSegment);
    annotationId = fourthSegment === "annotation" ? fifthSegment ?? null : null;
  } else if (view === "學習指引" && rawResource === "ems") {
    guideModuleId = "ems";
    const chapter = /^\d{1,3}$/u.test(thirdSegment ?? "") ? Number(thirdSegment) : 1;
    resourceId = chapter >= 1 && chapter <= 24 ? String(chapter).padStart(3, "0") : "001";
    annotationId = fourthSegment === "annotation" ? fifthSegment ?? null : null;
  } else if (view === "學習指引" && rawResource === "goldfrank") {
    guideModuleId = "goldfrank";
    const chapter = /^\d{1,3}$/u.test(thirdSegment ?? "") ? Number(thirdSegment) : 1;
    resourceId = chapter >= 1 && chapter <= 140 ? String(chapter).padStart(3, "0") : "001";
    annotationId = fourthSegment === "annotation" ? fifthSegment ?? null : null;
  } else if (view === "學習指引" && rawResource === "board") {
    guideModuleId = "board";
    resourceId = /^\d{1,2}[A-Z]\d?$/u.test((thirdSegment ?? "").toUpperCase())
      ? thirdSegment.toUpperCase()
      : null;
    const traceSegments = [fourthSegment, fifthSegment, ...remainingSegments].filter(Boolean);
    const traceIndex = traceSegments.indexOf("trace");
    const fromIndex = traceSegments.indexOf("from");
    const annotationIndex = traceSegments.indexOf("annotation");
    const requestedNode = traceIndex >= 0 ? traceSegments[traceIndex + 1] : undefined;
    const requestedQuestion = fromIndex >= 0 ? traceSegments[fromIndex + 1] : undefined;
    const requestedTarget = fromIndex >= 0 ? traceSegments[fromIndex + 2] : undefined;
    if (/^t[ps]-[A-Za-z0-9_-]+$/u.test(requestedNode ?? "")) traceNodeId = requestedNode;
    if (annotationIndex >= 0) annotationId = traceSegments[annotationIndex + 1] ?? null;
    if (/^\d{3}[AB]?-Q\d{3}$/u.test((requestedQuestion ?? "").toUpperCase())) traceQuestionId = requestedQuestion!.toUpperCase();
    if (requestedTarget === "stem" || /^option-[A-F]$/u.test((requestedTarget ?? "").toUpperCase().replace("OPTION-", "option-"))) {
      traceTarget = requestedTarget === "stem" ? "stem" : `option-${requestedTarget!.slice(-1).toUpperCase()}`;
    }
  } else if (view === "學習指引" && (rawResource === "tintinalli" || rawResource === "rosens")) {
    textbookId = rawResource;
    if (thirdSegment) {
      if (textbookId === "tintinalli") {
        if (/^\d{1,3}$/u.test(thirdSegment)) {
          const chapter = Number(thirdSegment);
          resourceId = chapter >= 1 && chapter <= 303 ? String(chapter) : null;
          annotationId = fourthSegment === "annotation" ? fifthSegment ?? null : null;
        } else if (thirdSegment === "overview" || /^section-(?:0[1-9]|1\d|2[0-6])$/u.test(thirdSegment)) {
          resourceId = thirdSegment;
          annotationId = fourthSegment === "annotation" ? fifthSegment ?? null : null;
        }
      }
      if (textbookId === "rosens") {
        const numericChapter = /^\d{1,3}$/u.test(thirdSegment) ? Number(thirdSegment) : null;
        const electronicChapter = /^e(?:0?[1-9]|1[0-6])$/iu.test(thirdSegment);
        const supplementalSection = parseRosensSupplementalSectionId(thirdSegment) !== null;
        if (thirdSegment === "overview" || supplementalSection || (numericChapter !== null && numericChapter >= 1 && numericChapter <= 192) || electronicChapter) {
          resourceId = supplementalSection
            ? thirdSegment
            : electronicChapter
            ? `e${String(Number(thirdSegment.slice(1))).padStart(2, "0")}`
            : numericChapter !== null
              ? String(numericChapter).padStart(3, "0")
              : thirdSegment;
          annotationId = fourthSegment === "annotation" ? fifthSegment ?? null : null;
        }
      }
    }
  } else if (view === "學習指引" && rawResource && /^\d{1,3}$/u.test(rawResource)) {
    const chapter = Number(rawResource);
    resourceId = chapter >= 1 && chapter <= 303 ? String(chapter) : null;
    annotationId = thirdSegment === "annotation" ? fourthSegment ?? null : null;
  } else if (view === "備考中心") {
    const prepPath = [rawResource, thirdSegment, fourthSegment].filter(Boolean).join("/");
    resourceId = normalizePrepRouteId(prepPath);
  } else if (view === "學習文件") {
    const documentId = (rawResource ?? "").normalize("NFKC").trim().toLowerCase();
    resourceId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(documentId) ? documentId : null;
  } else if (rawResource) {
    resourceId = rawResource.toUpperCase();
    annotationId = thirdSegment === "annotation" ? fourthSegment ?? null : null;
    const requestedTraceTarget = thirdSegment === "trace" ? fourthSegment : undefined;
    if (requestedTraceTarget === "stem" || /^option-[A-F]$/iu.test(requestedTraceTarget ?? "")) {
      traceTarget = requestedTraceTarget === "stem" ? "stem" : `option-${requestedTraceTarget!.slice(-1).toUpperCase()}`;
    }
  }
  const route: AppRoute = {
    view,
    resourceId,
    annotationId,
  };
  if (textbookId) route.textbookId = textbookId;
  if (guideModuleId) route.guideModuleId = guideModuleId;
  if (traceNodeId) route.traceNodeId = traceNodeId;
  if (traceQuestionId) route.traceQuestionId = traceQuestionId;
  if (traceTarget) route.traceTarget = traceTarget;
  return route;
}

export function guideHash(chapter: number, annotationId?: string) {
  const safeChapter = Math.min(303, Math.max(1, Math.round(chapter)));
  const base = `#guides/tintinalli/${String(safeChapter).padStart(3, "0")}`;
  return annotationId ? `${base}/annotation/${annotationId}` : base;
}

export function textbookGuideHash(textbookId: GuideTextbookId, chapter?: string | number, annotationId?: string) {
  if (chapter === undefined || chapter === null || chapter === "") return `#guides/${textbookId}`;
  const requested = String(chapter).toLowerCase();
  if (requested === "overview") {
    const base = `#guides/${textbookId}/overview`;
    return annotationId ? `${base}/annotation/${annotationId}` : base;
  }
  if (textbookId === "tintinalli") {
    if (/^section-(?:0[1-9]|1\d|2[0-6])$/u.test(requested)) {
      const base = `#guides/tintinalli/${requested}`;
      return annotationId ? `${base}/annotation/${annotationId}` : base;
    }
    const safeChapter = Math.min(303, Math.max(1, Math.round(Number(chapter))));
    const base = `#guides/tintinalli/${String(safeChapter).padStart(3, "0")}`;
    return annotationId ? `${base}/annotation/${annotationId}` : base;
  }
  const normalized = requested;
  if (parseRosensSupplementalSectionId(normalized) !== null) {
    const base = `#guides/rosens/${normalized}`;
    return annotationId ? `${base}/annotation/${annotationId}` : base;
  }
  const chapterSlug = /^\d{1,3}$/u.test(normalized)
    ? String(Math.min(192, Math.max(1, Math.round(Number(normalized))))).padStart(3, "0")
    : /^e(?:0?[1-9]|1[0-6])$/u.test(normalized)
      ? `e${String(Number(normalized.slice(1))).padStart(2, "0")}`
      : "001";
  const base = `#guides/rosens/${chapterSlug}`;
  return annotationId ? `${base}/annotation/${annotationId}` : base;
}

export function ailsGuideHash(page?: AilsRouteId | string | null, annotationId?: string | null) {
  const base = `#guides/ails/${isAilsRouteId(page) ? page : "home"}`;
  return annotationId ? `${base}/annotation/${annotationId}` : base;
}

export function emsGuideHash(chapter?: string | number | null, annotationId?: string | null) {
  const requested = Number(chapter ?? 1);
  const safeChapter = Number.isInteger(requested) && requested >= 1 && requested <= 24 ? requested : 1;
  const base = `#guides/ems/${String(safeChapter).padStart(3, "0")}`;
  return annotationId ? `${base}/annotation/${annotationId}` : base;
}

export function goldfrankGuideHash(chapter?: string | number | null, annotationId?: string | null) {
  const requested = Number(chapter ?? 1);
  const safeChapter = Number.isInteger(requested) && requested >= 1 && requested <= 140 ? requested : 1;
  const base = `#guides/goldfrank/${String(safeChapter).padStart(3, "0")}`;
  return annotationId ? `${base}/annotation/${annotationId}` : base;
}

export function boardGuideHash(unitCode?: string | null, nodeId?: string | null, questionId?: string | null, target?: BoardTraceRouteTarget | null, annotationId?: string | null) {
  const code = (unitCode ?? "").normalize("NFKC").trim().toUpperCase();
  if (!/^\d{1,2}[A-Z]\d?$/u.test(code)) return "#guides/board";
  let hash = `#guides/board/${code}`;
  if (nodeId && /^t[ps]-[A-Za-z0-9_-]+$/u.test(nodeId)) hash += `/trace/${nodeId}`;
  if (questionId && /^\d{3}[AB]?-Q\d{3}$/u.test(questionId.toUpperCase())) {
    const safeTarget = target === "stem" || /^option-[A-F]$/u.test(target ?? "") ? target : "stem";
    hash += `/from/${questionId.toUpperCase()}/${safeTarget}`;
  }
  if (annotationId) hash += `/annotation/${annotationId}`;
  return hash;
}

export function readerHash(questionId: string, annotationId?: string) {
  const base = `#reader/${questionId.toUpperCase()}`;
  return annotationId ? `${base}/annotation/${annotationId}` : base;
}

export function readerTraceHash(questionId: string, target: BoardTraceRouteTarget = "stem") {
  const safeTarget = target === "stem" || /^option-[A-F]$/u.test(target) ? target : "stem";
  return `#reader/${questionId.toUpperCase()}/trace/${safeTarget}`;
}

export function prepHash(route: PrepRouteId) {
  return `#prep/${route}`;
}

export function learningDocumentHash(documentId?: string | null) {
  const normalized = (documentId ?? "").normalize("NFKC").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
    ? `#documents/${normalized}`
    : "#documents";
}
