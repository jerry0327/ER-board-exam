import type { SemAnnouncement } from "./sem-resource-feed";

export type CurrentExamResourceKind = "notice" | "oral-procedure" | "written-exam" | "qualified-list";

export type CurrentExamResource = {
  kind: CurrentExamResourceKind;
  label: string;
  year: number;
  url: string;
  announcement: SemAnnouncement;
};

export type CurrentExamResources = {
  year: number | null;
  notice: CurrentExamResource | null;
  oralProcedure: CurrentExamResource | null;
  writtenExam: CurrentExamResource | null;
  qualifiedList: CurrentExamResource | null;
};

type ResourceKey = Exclude<keyof CurrentExamResources, "year">;

type Candidate = {
  announcement: SemAnnouncement;
  index: number;
  key: ResourceKey;
  year: number;
};

const MIN_ROC_EXAM_YEAR = 100;
const MAX_ROC_EXAM_YEAR = 300;

const resourceDefinitions: Record<ResourceKey, { kind: CurrentExamResourceKind; label: (year: number) => string }> = {
  notice: { kind: "notice", label: (year) => `${year} 年甄審簡章` },
  oralProcedure: { kind: "oral-procedure", label: (year) => `${year} 年口試程序說明` },
  writtenExam: { kind: "written-exam", label: (year) => `${year} 年筆試試題與答案` },
  qualifiedList: { kind: "qualified-list", label: (year) => `${year} 年甄審合格名單` },
};

function normalizedTitle(title: string) {
  return title
    .normalize("NFKC")
    .replace(/[\s\-—–_、，,。．:：;；·・()（）[\]【】「」『』]+/gu, "");
}

/** Parse one unambiguous, plausible ROC exam year from an official announcement title. */
export function parseRocExamYear(title: string): number | null {
  const normalized = title.normalize("NFKC");
  const yearTokens = [...normalized.matchAll(/([0-9]+)\s*年(?:度)?/gu)].map((match) => match[1] ?? "");
  if (yearTokens.length === 0) return null;

  const years = new Set<number>();
  for (const token of yearTokens) {
    if (!/^[0-9]{3}$/u.test(token)) return null;
    const year = Number(token);
    if (!Number.isSafeInteger(year) || year < MIN_ROC_EXAM_YEAR || year > MAX_ROC_EXAM_YEAR) return null;
    years.add(year);
  }

  return years.size === 1 ? [...years][0] ?? null : null;
}

function resourceKeyFromTitle(title: string): ResourceKey | null {
  const normalized = normalizedTitle(title);
  const isEmergencyBoardExam = /急診(?:醫學科)?專科醫師/u.test(normalized);
  if (!isEmergencyBoardExam || /申覆|疑義|訓練醫院|醫院認定/u.test(normalized)) return null;

  if (normalized.includes("簡章")) return "notice";
  if (/(?:口試|面試)/u.test(normalized) && /(?:程序|流程|時程|試務|注意事項|作業)/u.test(normalized)) return "oralProcedure";
  if (normalized.includes("筆試") && normalized.includes("試題") && normalized.includes("答案")) return "writtenExam";
  if (/(?:合格|通過)/u.test(normalized) && /(?:名單|人員)/u.test(normalized) && !normalized.includes("初審")) return "qualifiedList";
  return null;
}

function validDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/u.exec(value);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function compareIdsNewestFirst(left: string, right: string) {
  const numericId = /^[0-9]+$/u;
  if (numericId.test(left) && numericId.test(right)) {
    const normalizedLeft = left.replace(/^0+(?=\d)/u, "");
    const normalizedRight = right.replace(/^0+(?=\d)/u, "");
    if (normalizedLeft.length !== normalizedRight.length) return normalizedRight.length - normalizedLeft.length;
    if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? 1 : -1;
  }
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function compareCandidatesNewestFirst(left: Candidate, right: Candidate) {
  const leftDate = validDateKey(left.announcement.date);
  const rightDate = validDateKey(right.announcement.date);
  if (leftDate !== rightDate) return leftDate < rightDate ? 1 : -1;
  const idOrder = compareIdsNewestFirst(left.announcement.id, right.announcement.id);
  return idOrder || left.index - right.index;
}

function createResource(candidate: Candidate): CurrentExamResource {
  const definition = resourceDefinitions[candidate.key];
  return {
    kind: definition.kind,
    label: definition.label(candidate.year),
    year: candidate.year,
    url: candidate.announcement.url,
    announcement: candidate.announcement,
  };
}

/**
 * Resolve one coherent exam year. When a newer year has only some announcements,
 * missing entries stay null instead of silently linking to an older exam cycle.
 */
export function resolveCurrentExamResources(announcements: readonly SemAnnouncement[]): CurrentExamResources {
  const candidates: Candidate[] = announcements.flatMap((announcement, index) => {
    const year = parseRocExamYear(announcement.title);
    const key = resourceKeyFromTitle(announcement.title);
    if (year === null || key === null) return [];
    return [{ announcement, index, key, year }];
  });

  if (candidates.length === 0) {
    return { year: null, notice: null, oralProcedure: null, writtenExam: null, qualifiedList: null };
  }

  const year = Math.max(...candidates.map((candidate) => candidate.year));
  const currentCandidates = candidates
    .filter((candidate) => candidate.year === year)
    .sort(compareCandidatesNewestFirst);
  const resources: CurrentExamResources = {
    year,
    notice: null,
    oralProcedure: null,
    writtenExam: null,
    qualifiedList: null,
  };

  for (const candidate of currentCandidates) {
    if (resources[candidate.key] === null) resources[candidate.key] = createResource(candidate);
  }
  return resources;
}
