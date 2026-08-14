import { BOARD_PREP_COHORTS, BOARD_PREP_RULES_LAST_VERIFIED, type BoardPrepCohort, type BoardPrepRuleItem, type BoardPrepRuleSection } from "./board-prep-data.ts";

export const BOARD_PREP_SCHEMA_VERSION = 2;
export const BOARD_PREP_MIN_QUOTA_YEAR = 107;
export const BOARD_PREP_LATEST_PUBLISHED_QUOTA_YEAR = 115;
// Keep persisted selections bounded while allowing future cohorts to be chosen
// before a new official rules workbook has been incorporated into the app.
export const BOARD_PREP_MAX_QUOTA_YEAR = 130;

export type BoardPrepSelectionMode = "quota-year" | "training-start";

export type BoardPrepCompletionState = {
  completed: boolean;
  completedAt: string;
  certificateNumber: string;
  note: string;
  updatedAt: string;
};

export type BoardPrepItemState = BoardPrepCompletionState & {
  occurrences: Record<string, BoardPrepCompletionState>;
};

export type BoardPrepState = {
  schemaVersion: 2;
  selectionMode: BoardPrepSelectionMode;
  quotaYear: number;
  trainingStartDate: string;
  items: Record<string, BoardPrepItemState>;
  updatedAt: string;
};

export type BoardPrepAttachmentExportMeta = {
  id: string;
  itemId: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
};

function datePartsInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function validDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function clampQuotaYear(value: number) {
  return Math.min(BOARD_PREP_MAX_QUOTA_YEAR, Math.max(BOARD_PREP_MIN_QUOTA_YEAR, Math.round(value)));
}

export function inferBoardPrepQuotaYear(value: string | Date, timeZone = "Asia/Taipei") {
  let year: number;
  let month: number;
  if (typeof value === "string" && validDateOnly(value)) {
    [year, month] = value.split("-").map(Number);
  } else {
    const date = value instanceof Date ? value : new Date(value);
    const parts = datePartsInTimeZone(Number.isFinite(date.getTime()) ? date : new Date(), timeZone);
    year = parts.year;
    month = parts.month;
  }
  return year - 1911 - (month < 8 ? 1 : 0);
}

export function quotaYearTrainingStart(quotaYear: number) {
  return `${clampQuotaYear(quotaYear) + 1911}-08-01`;
}

export function boardPrepQuotaYearCovered(value: number) {
  return Number.isInteger(value) && value >= BOARD_PREP_MIN_QUOTA_YEAR && value <= BOARD_PREP_MAX_QUOTA_YEAR;
}

export function getBoardPrepCohort(quotaYear: number): BoardPrepCohort {
  const covered = clampQuotaYear(quotaYear);
  const published = BOARD_PREP_COHORTS.find((cohort) => cohort.quotaYears.includes(covered));
  if (published) return published;
  const latest = BOARD_PREP_COHORTS.at(-1)!;
  return {
    ...latest,
    label: `${covered} 年度容額（參照 ${BOARD_PREP_LATEST_PUBLISHED_QUOTA_YEAR} 年課程表）`,
    quotaYears: [covered],
  };
}

export function defaultBoardPrepState(now = new Date()): BoardPrepState {
  const inferred = inferBoardPrepQuotaYear(now);
  const quotaYear = clampQuotaYear(inferred);
  return {
    schemaVersion: BOARD_PREP_SCHEMA_VERSION,
    selectionMode: "quota-year",
    quotaYear,
    trainingStartDate: "",
    items: {},
    updatedAt: now.toISOString(),
  };
}

function normalizeCompletionState(value: unknown): BoardPrepCompletionState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<BoardPrepCompletionState> & { certificateNote?: unknown };
  return {
    completed: input.completed === true,
    completedAt: validDateOnly(input.completedAt) ? input.completedAt : "",
    certificateNumber: typeof input.certificateNumber === "string" ? input.certificateNumber.slice(0, 500) : "",
    note: typeof input.note === "string"
      ? input.note.slice(0, 2000)
      : typeof input.certificateNote === "string"
        ? input.certificateNote.slice(0, 2000)
        : "",
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
  };
}

function normalizeItemState(value: unknown): BoardPrepItemState | null {
  const completion = normalizeCompletionState(value);
  if (!completion) return null;
  const input = value as Partial<BoardPrepItemState>;
  const occurrences: Record<string, BoardPrepCompletionState> = {};
  if (input.occurrences && typeof input.occurrences === "object") {
    for (const [key, occurrence] of Object.entries(input.occurrences)) {
      const normalized = normalizeCompletionState(occurrence);
      if (normalized && /^[1-9][0-9]?$/u.test(key)) occurrences[key] = normalized;
    }
  }
  return { ...completion, occurrences };
}

const occurrenceRules = new Map(
  BOARD_PREP_COHORTS.flatMap((cohort) => cohort.sections.flatMap((section) => section.items))
    .filter((item) => item.tracking?.kind === "occurrences")
    .map((item) => [item.id, item] as const),
);

export function boardPrepOccurrenceEntries(item: BoardPrepRuleItem) {
  const tracking = item.tracking;
  if (tracking?.kind !== "occurrences") return [];
  return Array.from({ length: tracking.count }, (_, index) => ({
    key: String(index + 1),
    label: tracking.labels?.[index] ?? `第 ${index + 1} ${tracking.unitLabel}`,
  }));
}

function reconcileOccurrenceRule(item: BoardPrepRuleItem, value: BoardPrepItemState) {
  const entries = boardPrepOccurrenceEntries(item);
  if (!entries.length) return value;
  const occurrences = { ...value.occurrences };
  if (value.completed && !entries.some((entry) => occurrences[entry.key])) {
    for (const entry of entries) {
      occurrences[entry.key] = {
        completed: true,
        completedAt: value.completedAt,
        certificateNumber: value.certificateNumber,
        note: value.note,
        updatedAt: value.updatedAt,
      };
    }
  }
  const completed = entries.every((entry) => occurrences[entry.key]?.completed === true);
  const completedDates = entries.map((entry) => occurrences[entry.key]?.completedAt ?? "").filter(Boolean).sort();
  return {
    ...value,
    completed,
    completedAt: completed ? completedDates.at(-1) ?? value.completedAt : "",
    occurrences,
  };
}

export function normalizeBoardPrepState(value: unknown, now = new Date()): BoardPrepState {
  const fallback = defaultBoardPrepState(now);
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<BoardPrepState>;
  const selectionMode: BoardPrepSelectionMode = input.selectionMode === "training-start" ? "training-start" : "quota-year";
  const trainingStartDate = validDateOnly(input.trainingStartDate) ? input.trainingStartDate : "";
  const inputQuotaYear = typeof input.quotaYear === "number" && Number.isFinite(input.quotaYear) ? input.quotaYear : fallback.quotaYear;
  const quotaYear = clampQuotaYear(selectionMode === "training-start" && trainingStartDate
    ? inferBoardPrepQuotaYear(trainingStartDate)
    : inputQuotaYear);
  const items: Record<string, BoardPrepItemState> = {};
  if (input.items && typeof input.items === "object") {
    for (const [id, itemValue] of Object.entries(input.items)) {
      const normalized = normalizeItemState(itemValue);
      if (normalized && /^[a-z0-9][a-z0-9.-]{1,100}$/u.test(id)) items[id] = normalized;
    }
  }
  for (const [id, item] of occurrenceRules) {
    if (items[id]) items[id] = reconcileOccurrenceRule(item, items[id]);
  }
  return {
    schemaVersion: BOARD_PREP_SCHEMA_VERSION,
    selectionMode,
    quotaYear,
    trainingStartDate,
    items,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : fallback.updatedAt,
  };
}

export function effectiveBoardPrepTrainingStart(state: Pick<BoardPrepState, "trainingStartDate" | "quotaYear">) {
  return validDateOnly(state.trainingStartDate) ? state.trainingStartDate : quotaYearTrainingStart(state.quotaYear);
}

function appliesOn(date: string, rule: Pick<BoardPrepRuleItem | BoardPrepRuleSection, "appliesFrom" | "appliesThrough">) {
  if (rule.appliesFrom && date < rule.appliesFrom) return false;
  if (rule.appliesThrough && date > rule.appliesThrough) return false;
  return true;
}

export function getApplicableBoardPrepSections(state: Pick<BoardPrepState, "quotaYear" | "trainingStartDate">) {
  const cohort = getBoardPrepCohort(state.quotaYear);
  const trainingStart = effectiveBoardPrepTrainingStart(state);
  return cohort.sections.flatMap((entry) => {
    if (!appliesOn(trainingStart, entry)) return [];
    const items = entry.items.filter((item) => appliesOn(trainingStart, item));
    return items.length ? [{ ...entry, items }] : [];
  });
}

export function flattenBoardPrepRequirements(sections: BoardPrepRuleSection[]) {
  return sections.flatMap((entry) => entry.items.map((item) => ({ section: entry, item })));
}

export function boardPrepRuleProgress(item: BoardPrepRuleItem, state?: BoardPrepItemState) {
  const entries = boardPrepOccurrenceEntries(item);
  if (!entries.length) return { completed: state?.completed ? 1 : 0, total: 1 };
  return {
    completed: entries.filter((entry) => state?.occurrences?.[entry.key]?.completed).length,
    total: entries.length,
  };
}

export function boardPrepProgressSummary(state: BoardPrepState, sections = getApplicableBoardPrepSections(state)) {
  const requirements = flattenBoardPrepRequirements(sections);
  const progress = requirements.map(({ item }) => boardPrepRuleProgress(item, state.items[item.id]));
  const completed = progress.reduce((sum, item) => sum + item.completed, 0);
  const total = progress.reduce((sum, item) => sum + item.total, 0);
  return { completed, total, remaining: Math.max(0, total - completed), percent: total ? Math.round(completed / total * 100) : 0 };
}

export function updateBoardPrepItem(
  state: BoardPrepState,
  itemId: string,
  patch: Partial<Pick<BoardPrepItemState, "completed" | "completedAt" | "certificateNumber" | "note">>,
  now = new Date(),
) {
  const current = state.items[itemId] ?? {
    completed: false,
    completedAt: "",
    certificateNumber: "",
    note: "",
    updatedAt: "",
    occurrences: {},
  };
  const nextItem = normalizeItemState({ ...current, ...patch, updatedAt: now.toISOString() })!;
  return normalizeBoardPrepState({
    ...state,
    items: { ...state.items, [itemId]: nextItem },
    updatedAt: now.toISOString(),
  }, now);
}

export function updateBoardPrepOccurrence(
  state: BoardPrepState,
  itemId: string,
  occurrenceKey: string,
  patch: Partial<Pick<BoardPrepCompletionState, "completed" | "completedAt" | "certificateNumber" | "note">>,
  now = new Date(),
) {
  const item = occurrenceRules.get(itemId);
  if (!item || !boardPrepOccurrenceEntries(item).some((entry) => entry.key === occurrenceKey)) return state;
  const current = state.items[itemId] ?? {
    completed: false,
    completedAt: "",
    certificateNumber: "",
    note: "",
    updatedAt: "",
    occurrences: {},
  };
  const currentOccurrence = current.occurrences[occurrenceKey] ?? {
    completed: false,
    completedAt: "",
    certificateNumber: "",
    note: "",
    updatedAt: "",
  };
  const nextOccurrence = normalizeCompletionState({ ...currentOccurrence, ...patch, updatedAt: now.toISOString() })!;
  const nextItem = reconcileOccurrenceRule(item, {
    ...current,
    occurrences: { ...current.occurrences, [occurrenceKey]: nextOccurrence },
    updatedAt: now.toISOString(),
  });
  return normalizeBoardPrepState({
    ...state,
    items: { ...state.items, [itemId]: nextItem },
    updatedAt: now.toISOString(),
  }, now);
}

export function buildBoardPrepJsonExport(
  state: BoardPrepState,
  attachments: BoardPrepAttachmentExportMeta[] = [],
  exportedAt = new Date().toISOString(),
) {
  const cohort = getBoardPrepCohort(state.quotaYear);
  const sections = getApplicableBoardPrepSections(state);
  const byItem = new Map<string, BoardPrepAttachmentExportMeta[]>();
  for (const attachment of attachments) byItem.set(attachment.itemId, [...(byItem.get(attachment.itemId) ?? []), attachment]);
  return {
    schemaVersion: BOARD_PREP_SCHEMA_VERSION,
    exportedAt,
    localOnlyAttachments: true,
    rulesLastVerifiedAt: BOARD_PREP_RULES_LAST_VERIFIED,
    selection: {
      mode: state.selectionMode,
      quotaYear: state.quotaYear,
      trainingStartDate: effectiveBoardPrepTrainingStart(state),
      cohortId: cohort.id,
      cohortLabel: cohort.label,
    },
    sections: sections.map((entry) => ({
      id: entry.id,
      title: entry.title,
      applicability: entry.applicability,
      items: entry.items.map((item) => ({
        id: item.id,
        title: item.title,
        applicability: item.applicability,
        officialNote: item.officialNote,
        sourceUrl: item.sourceUrl,
        completed: state.items[item.id]?.completed ?? false,
        completedAt: state.items[item.id]?.completedAt ?? "",
        certificateNumber: state.items[item.id]?.certificateNumber ?? "",
        note: state.items[item.id]?.note ?? "",
        tracking: item.tracking?.kind ?? "single",
        occurrences: boardPrepOccurrenceEntries(item).map((entry) => ({
          key: entry.key,
          label: entry.label,
          completed: state.items[item.id]?.occurrences?.[entry.key]?.completed ?? false,
          completedAt: state.items[item.id]?.occurrences?.[entry.key]?.completedAt ?? "",
          certificateNumber: state.items[item.id]?.occurrences?.[entry.key]?.certificateNumber ?? "",
          note: state.items[item.id]?.occurrences?.[entry.key]?.note ?? "",
        })),
        attachments: (byItem.get(item.id) ?? []).map(({ id, name, type, size, createdAt }) => ({ id, name, type, size, createdAt })),
      })),
    })),
  };
}

function spreadsheetSafe(value: string) {
  return /^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | boolean) {
  const safe = spreadsheetSafe(String(value));
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

export function buildBoardPrepCsvExport(state: BoardPrepState, attachments: BoardPrepAttachmentExportMeta[] = []) {
  const cohort = getBoardPrepCohort(state.quotaYear);
  const rows: (string | number | boolean)[][] = [[
    "容額年度", "規則群組", "分類", "必修項目", "適用註記", "完成", "完成進度", "完成日期", "證書號", "備註", "附件數", "附件名稱", "官方來源",
  ]];
  const byItem = new Map<string, BoardPrepAttachmentExportMeta[]>();
  for (const attachment of attachments) byItem.set(attachment.itemId, [...(byItem.get(attachment.itemId) ?? []), attachment]);
  for (const { section, item } of flattenBoardPrepRequirements(getApplicableBoardPrepSections(state))) {
    const itemState = state.items[item.id];
    const itemAttachments = byItem.get(item.id) ?? [];
    rows.push([
      state.quotaYear,
      cohort.label,
      section.title,
      item.title,
      item.applicability,
      itemState?.completed ? "是" : "否",
      (() => {
        const progress = boardPrepRuleProgress(item, itemState);
        return `${progress.completed}/${progress.total}`;
      })(),
      itemState?.completedAt ?? "",
      itemState?.certificateNumber ?? "",
      itemState?.note ?? "",
      itemAttachments.length,
      itemAttachments.map((entry) => entry.name).join("；"),
      item.sourceUrl,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
