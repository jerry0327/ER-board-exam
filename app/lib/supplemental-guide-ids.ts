export const rosensSupplementalSectionKeys = [
  "1-1", "1-2",
  "2-1", "2-2", "2-3",
  "3-1", "3-2", "3-3", "3-4", "3-5", "3-6", "3-7", "3-8", "3-9", "3-10", "3-11", "3-12",
  "4-1", "4-2",
  "5-1", "5-2", "5-3", "5-4", "5-5", "5-6", "5-7", "5-8",
] as const;

export type RosensSupplementalSectionKey = (typeof rosensSupplementalSectionKeys)[number];

const rosensSupplementalSectionKeySet = new Set<string>(rosensSupplementalSectionKeys);

export function tintinalliSupplementalSectionId(section: number) {
  return Number.isInteger(section) && section >= 1 && section <= 26
    ? `section-${String(section).padStart(2, "0")}`
    : null;
}

export function parseTintinalliSupplementalSectionId(value: string) {
  const match = /^section-(\d{2})$/u.exec(value);
  if (!match) return null;
  const section = Number(match[1]);
  return tintinalliSupplementalSectionId(section) === value ? section : null;
}

export function rosensSupplementalSectionId(key: string) {
  if (!rosensSupplementalSectionKeySet.has(key)) return null;
  const [part, section] = key.split("-").map(Number);
  return `section-${String(part).padStart(2, "0")}-${String(section).padStart(2, "0")}`;
}

export function parseRosensSupplementalSectionId(value: string): RosensSupplementalSectionKey | null {
  const match = /^section-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const key = `${Number(match[1])}-${Number(match[2])}`;
  return rosensSupplementalSectionKeySet.has(key) && rosensSupplementalSectionId(key) === value
    ? key as RosensSupplementalSectionKey
    : null;
}

export function isSupplementalGuideResourceId(textbookId: "tintinalli" | "rosens", value: string | null) {
  if (value === "overview") return true;
  if (!value) return false;
  return textbookId === "tintinalli"
    ? parseTintinalliSupplementalSectionId(value) !== null
    : parseRosensSupplementalSectionId(value) !== null;
}

export function supplementalSectionDisplayId(sectionId: string | null) {
  if (!sectionId) return "";
  return sectionId.split("-").map((part) => String(Number(part))).join("-");
}
