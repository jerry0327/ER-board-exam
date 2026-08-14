import type { SupplementalGuideEntry } from "./supplemental-guides";
import { rosensSupplementalSectionKeys } from "./supplemental-guide-ids.ts";
import { rosensTextbookSections, tintinalliTextbookSections } from "./textbook-audio-sections.ts";

export const tintinalliSectionFirstChapters = tintinalliTextbookSections.map((section) => section.firstChapter);

/** Optional quick-start destination; the primary action opens the full chapter catalog. */
export function supplementalGuideStartingChapter(entry: SupplementalGuideEntry): number | string {
  if (entry.textbookId === "rosens") {
    if (entry.kind === "overview") return "001";
    const sectionIndex = rosensSupplementalSectionKeys.indexOf(entry.section);
    return rosensTextbookSections[sectionIndex]?.firstGuideChapterId ?? "001";
  }
  if (entry.kind === "overview") return 1;
  return tintinalliSectionFirstChapters[entry.section - 1] ?? 1;
}
