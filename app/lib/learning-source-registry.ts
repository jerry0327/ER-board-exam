export type LearningSourceId = "tintinalli" | "rosens" | "goldfrank" | "board" | "ails" | "ems" | "questions";

export type LearningSourceDefinition = {
  id: LearningSourceId;
  title: string;
  shortTitle: string;
  theme: string;
  mark: string;
  order: number;
  guideKicker: string;
  audioKicker: string;
  hierarchy: "chapter" | "section-chapter" | "unit" | "page" | "question-set";
};

/**
 * Cross-surface identity for learning sources. Content loaders remain lazy;
 * this registry contains only the few strings and tokens needed to keep the
 * guide hub, audio shelf, and future additions visually consistent.
 */
export const LEARNING_SOURCE_REGISTRY: Record<LearningSourceId, LearningSourceDefinition> = {
  tintinalli: {
    id: "tintinalli",
    title: "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide",
    shortTitle: "Tintinalli 9e",
    theme: "tintinalli",
    mark: "T",
    order: 1,
    guideKicker: "TINTINALLI · 9TH EDITION",
    audioKicker: "TINTINALLI · 9E",
    hierarchy: "section-chapter",
  },
  rosens: {
    id: "rosens",
    title: "Rosen’s Emergency Medicine: Concepts and Clinical Practice",
    shortTitle: "Rosen’s 10e",
    theme: "rosens",
    mark: "R",
    order: 2,
    guideKicker: "ROSEN’S · 10TH EDITION",
    audioKicker: "ROSEN’S · 10E",
    hierarchy: "section-chapter",
  },
  goldfrank: {
    id: "goldfrank",
    title: "Goldfrank’s Toxicologic Emergencies",
    shortTitle: "Goldfrank 11e",
    theme: "goldfrank",
    mark: "G",
    order: 3,
    guideKicker: "GOLDFRANK’S · 11TH EDITION",
    audioKicker: "GOLDFRANK’S · 11E",
    hierarchy: "chapter",
  },
  board: {
    id: "board",
    title: "歷屆考題對照指引",
    shortTitle: "考題對照指引",
    theme: "board",
    mark: "指",
    order: 6,
    guideKicker: "BOARD QUESTION MAP",
    audioKicker: "BOARD GUIDE",
    hierarchy: "unit",
  },
  ails: {
    id: "ails",
    title: "AILS急性中毒救命術",
    shortTitle: "AILS 第三版",
    theme: "ails",
    mark: "A",
    order: 5,
    guideKicker: "AILS · 第三版",
    audioKicker: "AILS AUDIO",
    hierarchy: "page",
  },
  ems: {
    id: "ems",
    title: "急診住院醫師緊急醫療救護教科書",
    shortTitle: "EMS",
    theme: "ems",
    mark: "E",
    order: 4,
    guideKicker: "EMS · PREHOSPITAL CARE",
    audioKicker: "EMS GUIDE",
    hierarchy: "chapter",
  },
  questions: {
    id: "questions",
    title: "急診專科歷屆題庫",
    shortTitle: "歷屆題庫",
    theme: "questions",
    mark: "Q",
    order: 7,
    guideKicker: "BOARD REVIEW",
    audioKicker: "BOARD REVIEW",
    hierarchy: "question-set",
  },
};

const AUDIO_COLLECTION_SOURCE_ALIASES: Record<string, LearningSourceId> = {
  tintinalli: "tintinalli",
  rosens: "rosens",
  goldfrank: "goldfrank",
  "board-guides": "board",
  ails: "ails",
  ems: "ems",
  questions: "questions",
};

export function learningSourceForAudioLibrary(libraryId: string) {
  const sourceId = AUDIO_COLLECTION_SOURCE_ALIASES[libraryId];
  return sourceId ? LEARNING_SOURCE_REGISTRY[sourceId] : null;
}
