import sectionCatalogJson from "../data/textbook-sections.json" with { type: "json" };

export type TextbookAudioSection = {
  id: string;
  label: string;
  title: string;
  firstChapter: number;
  lastChapter: number;
  firstGuideChapterId?: string;
};

type TextbookSectionCatalog = {
  schema: "em-board-textbook-sections-v1";
  textbooks: Record<string, {
    title: string;
    sections: TextbookAudioSection[];
  }>;
};

const sectionCatalog = sectionCatalogJson as TextbookSectionCatalog;

export const tintinalliTextbookSections = sectionCatalog.textbooks.tintinalli.sections;
export const rosensTextbookSections = sectionCatalog.textbooks.rosens.sections;

export function textbookAudioSections(textbookId: string | null | undefined) {
  return textbookId ? sectionCatalog.textbooks[textbookId]?.sections ?? [] : [];
}

export function normalizeTextbookAudioSectionId(textbookId: string, value: string) {
  const normalized = value.trim().toLocaleLowerCase("en");
  if (textbookId === "tintinalli") {
    const section = Number(normalized.replace(/^section[-_ ]?/u, ""));
    return Number.isSafeInteger(section) && section > 0 ? String(section) : normalized;
  }
  if (textbookId === "rosens") {
    const match = /^p?(\d+)(?:[-_ ]?s(?:ection)?[-_ ]?|[-_ ])(\d+)$/u.exec(normalized);
    if (match) return `p${Number(match[1])}-s${Number(match[2])}`;
  }
  return normalized;
}

/**
 * Resolve both current chapter audio and future section-level audio against
 * the same tiny textbook taxonomy. No guide manifest or chapter body is
 * downloaded to render the audio-library selector.
 */
export function textbookAudioSectionForSource(source: {
  textbook: string;
  kind: string;
  chapterId: string;
  sectionId?: string;
}) {
  const sections = textbookAudioSections(source.textbook);
  if (!sections.length) return null;
  if (source.sectionId) {
    const sectionId = normalizeTextbookAudioSectionId(source.textbook, source.sectionId);
    return sections.find((section) => section.id === sectionId) ?? null;
  }
  if (source.kind === "textbook-section") {
    const sectionId = normalizeTextbookAudioSectionId(source.textbook, source.chapterId);
    return sections.find((section) => section.id === sectionId) ?? null;
  }
  const chapter = Number(source.chapterId);
  if (!Number.isSafeInteger(chapter) || chapter < 1) return null;
  return sections.find((section) => chapter >= section.firstChapter && chapter <= section.lastChapter) ?? null;
}
