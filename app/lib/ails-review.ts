import { fetchCompressedStatic } from "./compressed-static.ts";

export const ailsPageIds = [
  "home",
  "master",
  "antidotes",
  "decon",
  "drugs",
  "pesticides",
  "environmental",
  "biotoxins",
  "names",
  "qbank",
  "cards",
  "quiz",
  "references",
] as const;

export type AilsPageId = (typeof ailsPageIds)[number];

export const ailsInteractivePageIds = ["qbank", "cards", "quiz"] as const satisfies readonly AilsPageId[];
export const ailsReadingPageIds = ailsPageIds.filter(
  (id): id is Exclude<AilsPageId, (typeof ailsInteractivePageIds)[number]> => !ailsInteractivePageIds.includes(id as (typeof ailsInteractivePageIds)[number]),
);
const interactivePageIdSet = new Set<string>(ailsInteractivePageIds);

export function isAilsInteractivePageId(value: string | null | undefined): value is (typeof ailsInteractivePageIds)[number] {
  return Boolean(value && interactivePageIdSet.has(value));
}

export type AilsPage = {
  id: AilsPageId;
  title: string;
  kicker: string;
  deck: string;
  metadata: string[];
  markdown: string;
};

export type AilsQuestion = {
  num: number;
  sourceNum: number;
  topic: string;
  question: string;
  options: { label: string; text: string }[];
  answer: string;
  answerText: string;
  rationale: string;
  currentNote: string;
  status: "已整理" | "現行提醒";
  questionClass: "答案與現行概念一致" | "依歷屆語境作答" | "題目設計有歧義";
  repeatGroup?: number[];
};

export type AilsReview = {
  schemaVersion: 1;
  title: string;
  revisedAt: string;
  groups: { id: string; label: string; pages: AilsPageId[] }[];
  pages: AilsPage[];
  topics: string[];
  questions: AilsQuestion[];
};

const pageIdSet = new Set<string>(ailsPageIds);
let request: Promise<AilsReview> | null = null;

export function isAilsPageId(value: string | null | undefined): value is AilsPageId {
  return Boolean(value && pageIdSet.has(value));
}

export function normalizeAilsPageId(value: string | null | undefined): AilsPageId {
  return isAilsPageId(value) ? value : "home";
}

export function parseAilsReview(value: unknown): AilsReview {
  if (!value || typeof value !== "object") throw new Error("AILS 複習內容格式不完整。");
  const review = value as Partial<AilsReview>;
  if (review.schemaVersion !== 1 || !Array.isArray(review.pages) || !Array.isArray(review.questions) || !Array.isArray(review.topics) || !Array.isArray(review.groups)) {
    throw new Error("AILS 複習內容格式不完整。");
  }
  const pageIds = review.pages.map((page) => page?.id);
  if (pageIds.length !== ailsPageIds.length || ailsPageIds.some((id, index) => pageIds[index] !== id)) {
    throw new Error("AILS 複習目錄不完整。");
  }
  if (review.questions.length !== 272 || review.questions.some((question, index) => question?.num !== index + 1)) {
    throw new Error("AILS 題庫不完整。");
  }
  return review as AilsReview;
}

export function loadAilsReview() {
  if (!request) {
    request = fetchCompressedStatic("/data/ails/review.json")
      .then((response) => {
        if (!response.ok) throw new Error("AILS 複習內容暫時無法載入。");
        return response.json();
      })
      .then(parseAilsReview)
      .catch((error) => {
        request = null;
        throw error;
      });
  }
  return request;
}
