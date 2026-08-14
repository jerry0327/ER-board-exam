import type { Manifest } from "./types";

export type QuestionBankArchiveRange = {
  earliestRocYear: number;
  latestRocYear: number;
  gregorianLabel: string;
  rocLabel: string;
};

function rocYearFromGroupId(groupId: string) {
  const match = /^(\d{2,3})(?:[A-Z])?$/u.exec(groupId.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isSafeInteger(year) && year > 0 ? year : null;
}

export function questionBankArchiveRange(
  groups: Manifest["groups"],
): QuestionBankArchiveRange | null {
  const years = groups
    .map((group) => rocYearFromGroupId(group.id))
    .filter((year): year is number => year !== null);
  if (!years.length) return null;

  const earliestRocYear = Math.min(...years);
  const latestRocYear = Math.max(...years);
  const rocLabel = earliestRocYear === latestRocYear
    ? `民國 ${latestRocYear} 年`
    : `民國 ${earliestRocYear}—${latestRocYear} 年`;
  const earliestGregorianYear = earliestRocYear + 1911;
  const latestGregorianYear = latestRocYear + 1911;
  const gregorianLabel = earliestGregorianYear === latestGregorianYear
    ? String(latestGregorianYear)
    : `${earliestGregorianYear}—${latestGregorianYear}`;

  return {
    earliestRocYear,
    latestRocYear,
    gregorianLabel,
    rocLabel,
  };
}
