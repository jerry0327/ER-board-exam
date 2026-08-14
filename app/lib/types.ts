export type NavView = "總覽" | "開始作答" | "題庫瀏覽" | "詳解閱讀" | "學習指引" | "學習音檔" | "學習文件" | "錯題本" | "筆記本" | "學習分析" | "備考中心" | "休息站";
export type Confidence = "low" | "normal" | "high";
export type PracticeMode = "study" | "exam";

export type Manifest = {
  title: string;
  totalQuestions: number;
  totalExplanations: number;
  duplicateGroups: number;
  groups: { id: string; label: string; count: number; file: string }[];
  categories: { id: string; count: number }[];
  sourceSections: { id: number; label: string; count: number }[];
  validation: Record<string, number>;
};

export type Option = { key: string; text: string };

export type QuestionIndex = {
  id: string;
  exam: string;
  year: number;
  number: number;
  title: string;
  stem: string;
  contentHash?: string;
  answerKeys: string[];
  allCredit: boolean;
  questionType: string;
  focus: string;
  category: string;
  tags?: string[];
  sourceSections: number[];
  /** Populated when the future 303-chapter study-guide catalog is imported. */
  tintinalliChapters?: number[];
  images: string[];
  searchText?: string;
  duplicateGroup?: string;
  canonicalId?: string;
  qualityStatus?: "source-mismatch";
  excludedFromPractice?: boolean;
};

export type BrowsePreset = {
  category?: string;
  status?: "all" | "unanswered" | "wrong" | "due" | "bookmarked" | "read";
  sourceSection?: number;
  nonce: number;
};

export type AnnotationKind = "question_note" | "highlight" | "excerpt";

export type AnnotationExcerptRequest = {
  markdown: string;
  block: "table" | "heading";
  label: string;
  /** Stable DOM target used by Notebook/Search “back to source” links. */
  sourceAnchor: string;
};

export type StudyAnnotation = {
  id: string;
  questionId: string;
  kind: AnnotationKind;
  body: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number | null;
  endOffset: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncState?: "saved" | "pending" | "conflict";
};

export type FullQuestion = QuestionIndex & {
  options: Option[];
  answerText: string;
  explanation: string;
};

export type ProgressRecord = {
  userId: string;
  questionId: string;
  attempts: number;
  correctAttempts: number;
  firstAttemptCorrect: number | null;
  lastAnswer: string | null;
  lastCorrect: number | null;
  lastConfidence: Confidence | null;
  bookmarked: number;
  readState: "unread" | "reading" | "done" | "later";
  wrongState: "none" | "pending" | "mastered";
  streak: number;
  dueAt: string | null;
  lastAttemptAt: string | null;
  updatedAt: string;
};

export type AttemptRecord = {
  id: number;
  mutationId?: string | null;
  questionId: string;
  selectedKeys: string;
  correct: number | null;
  confidence: Confidence;
  mode: PracticeMode;
  createdAt: string;
};

export type AttemptInput = {
  mutationId?: string;
  questionId: string;
  selectedKeys: string[];
  correct: boolean | null;
  confidence: Confidence;
  mode: PracticeMode;
};

export type ProgressAction =
  | ({ action: "attempt"; mutationId: string; attemptedAt?: string } & AttemptInput)
  | { action: "bookmark"; questionId: string; value: boolean }
  | { action: "read"; questionId: string; value: "reading" | "done" | "later" | "unread" }
  | { action: "mastery"; questionId: string; value: "pending" | "mastered" | "none" };

export type PracticeFilters = {
  mode: PracticeMode;
  count: number;
  exam: string;
  category: string;
  source: "all" | "new" | "wrong" | "due" | "bookmarked";
  order: "random" | "sequential";
  timerEnabled: boolean;
};

export type PracticeSession = {
  schemaVersion: 2;
  ids: string[];
  cursor: number;
  mode: PracticeMode;
  answers: Record<string, string[]>;
  confidence: Record<string, Confidence>;
  /** Per-question visual marks only; these never participate in evaluation. */
  eliminatedOptions: Record<string, string[]>;
  /** Per-question, session-scoped working notes that are never synced as annotations. */
  scratchpads: Record<string, string>;
  submitted: string[];
  flaggedIds: string[];
  timerEnabled: boolean;
  reviewing?: boolean;
  completed: boolean;
  startedAt: string;
  pausedAt?: string;
  accumulatedPausedMs?: number;
  completedAt?: string;
};

export type GuideReadState = "unread" | "reading" | "done" | "later";

export type GuideProgressRecord = {
  userId: string;
  chapterId: number;
  readState: GuideReadState;
  bookmarked: number;
  note: string;
  contentHash: string | null;
  lastOpenedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

/** Progress for namespaced guide resources, including non-numeric chapter ids. */
export type GuideResourceProgressRecord = {
  userId: string;
  resourceId: string;
  readState: GuideReadState;
  bookmarked: number;
  contentHash: string | null;
  lastOpenedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};
