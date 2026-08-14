export const DEFAULT_TRACEABILITY_VISIBLE_COUNT = 20;

export type TraceabilityAlias = string | {
  /** Alias as it appears in the source data. */
  label: string;
  /** Optional canonical label when the alias needs an explicit resolution. */
  canonicalLabel?: string;
};

export type TraceabilityQuestionTarget = {
  kind: "question";
  questionId: string;
};

export type TraceabilityOptionTarget = {
  kind: "option";
  questionId: string;
  optionKey: string;
};

export type TraceabilityReferenceTarget = {
  kind: "reference";
  resourceId: string;
  anchorId?: string;
};

/** A target on either side of the question ↔ textbook relationship. */
export type TraceabilityTarget =
  | TraceabilityQuestionTarget
  | TraceabilityOptionTarget
  | TraceabilityReferenceTarget;

type TraceabilityItemBase = {
  /** Stable relationship/record id, not the visible list position. */
  id: string;
  title: string;
  /** Small source label, for example an exam year or textbook chapter. */
  eyebrow?: string;
  /** Short evidence excerpt. Long source text should remain in the reader. */
  excerpt?: string;
  /** Human-readable locator, for example section, paragraph, or option. */
  locator?: string;
  aliases?: readonly TraceabilityAlias[];
};

export type TraceabilityQuestionItem = TraceabilityItemBase & {
  target: TraceabilityQuestionTarget;
  /** Direct evidence preserved when a question also has related matches. */
  directMatches?: TraceabilityQuestionMatches;
  /** Related evidence kept on the same row instead of duplicating the question. */
  relatedMatches?: TraceabilityQuestionMatches;
  /** Option-level matches grouped under this question result. */
  matchedOptionKeys?: readonly string[];
  /** Whether the question stem itself is also a mapped match. */
  matchesQuestionStem?: boolean;
};

export type TraceabilityQuestionMatches = {
  matchesQuestionStem: boolean;
  optionKeys: readonly string[];
};

export type TraceabilityOptionItem = TraceabilityItemBase & {
  target: TraceabilityOptionTarget;
  matchedOptionKeys?: never;
  matchesQuestionStem?: never;
};

export type TraceabilityReferenceItem = TraceabilityItemBase & {
  target: TraceabilityReferenceTarget;
  matchedOptionKeys?: never;
  matchesQuestionStem?: never;
};

export type TraceabilityItem =
  | TraceabilityQuestionItem
  | TraceabilityOptionItem
  | TraceabilityReferenceItem;

export type TraceabilityContext = {
  label: string;
  target: TraceabilityTarget;
};

export type TraceabilityQuestionSelectHandler = (
  questionId: string,
  item: TraceabilityQuestionItem,
) => void;

export type TraceabilityOptionSelectHandler = (
  questionId: string,
  optionKey: string,
  item: TraceabilityOptionItem | TraceabilityQuestionItem,
) => void;

export type TraceabilityReferenceSelectHandler = (
  resourceId: string,
  anchorId: string | undefined,
  item: TraceabilityReferenceItem,
) => void;
