import type {
  TraceabilityItem,
  TraceabilityQuestionItem,
  TraceabilityQuestionMatches,
} from "../components/traceability-types";
import type { QuestionIndex } from "./types";
import type { BoardTraceHit } from "./board-trace";

type QuestionTraceGroup = {
  aliases: Set<string>;
  matchesQuestionStem: boolean;
  optionKeys: Set<string>;
  questionId: string;
};

function questionGroupKey(hit: BoardTraceHit) {
  return hit.canonicalQuestionId ?? hit.questionId;
}

function collectQuestionTraceGroups(hits: readonly BoardTraceHit[]) {
  const seenAtoms = new Set<string>();
  const groupedByQuestion = new Map<string, QuestionTraceGroup>();
  for (const hit of hits) {
    if (seenAtoms.has(hit.canonicalAtomId)) continue;
    seenAtoms.add(hit.canonicalAtomId);
    const groupKey = questionGroupKey(hit);
    const group = groupedByQuestion.get(groupKey) ?? {
      aliases: new Set<string>(),
      matchesQuestionStem: false,
      optionKeys: new Set<string>(),
      questionId: hit.questionId,
    };
    for (const alias of hit.aliases ?? []) group.aliases.add(alias);
    const optionKey = hit.optionKey?.toUpperCase() ?? null;
    if (optionKey) group.optionKeys.add(optionKey);
    else group.matchesQuestionStem = true;
    groupedByQuestion.set(groupKey, group);
  }
  return groupedByQuestion;
}

function matchSet(group: QuestionTraceGroup | undefined): TraceabilityQuestionMatches {
  return {
    matchesQuestionStem: Boolean(group?.matchesQuestionStem),
    optionKeys: [...(group?.optionKeys ?? [])].sort((left, right) => left.localeCompare(right, "en")),
  };
}

function hasMatches(matches: TraceabilityQuestionMatches) {
  return matches.matchesQuestionStem || matches.optionKeys.length > 0;
}

function questionTraceItem(
  groupKey: string,
  directGroup: QuestionTraceGroup | undefined,
  relatedGroup: QuestionTraceGroup | undefined,
  questionById: Map<string, QuestionIndex>,
): TraceabilityQuestionItem {
  const group = directGroup ?? relatedGroup!;
  const question = questionById.get(group.questionId)
    ?? [...group.aliases].map((alias) => questionById.get(alias)).find(Boolean);
  const aliases = new Set([...(directGroup?.aliases ?? []), ...(relatedGroup?.aliases ?? [])]);
  const directMatches = matchSet(directGroup);
  const relatedMatches = matchSet(relatedGroup);
  const unionOptionKeys = [...new Set([
    ...directMatches.optionKeys,
    ...relatedMatches.optionKeys,
  ])].sort((left, right) => left.localeCompare(right, "en"));
  return {
    id: groupKey,
    title: question?.title ?? group.questionId,
    eyebrow: question ? `${question.year} 年・${group.questionId}` : group.questionId,
    aliases: [...aliases]
      .filter((alias) => alias !== group.questionId)
      .map((label) => ({ label })),
    directMatches: hasMatches(directMatches) ? directMatches : undefined,
    relatedMatches: hasMatches(relatedMatches) ? relatedMatches : undefined,
    matchedOptionKeys: unionOptionKeys,
    matchesQuestionStem: directMatches.matchesQuestionStem || relatedMatches.matchesQuestionStem,
    target: { kind: "question", questionId: group.questionId },
  };
}

/**
 * Collapses sentence-level trace atoms into one result per canonical exam
 * question. Exact option targets stay available as actions on that result.
 */
export function groupBoardTraceHits(
  hits: readonly BoardTraceHit[],
  questionById: Map<string, QuestionIndex>,
) {
  return [...collectQuestionTraceGroups(hits).entries()].map(([groupKey, group]): TraceabilityItem => (
    questionTraceItem(groupKey, group, undefined, questionById)
  ));
}

/**
 * Reconciles direct and related atoms before rendering. A canonical question
 * appears once; direct evidence wins the group while related evidence remains
 * visible on the same row as "同題延伸".
 */
export function reconcileBoardTraceHits(
  directHits: readonly BoardTraceHit[],
  relatedHits: readonly BoardTraceHit[],
  questionById: Map<string, QuestionIndex>,
) {
  const directGroups = collectQuestionTraceGroups(directHits);
  const directAtoms = new Set(directHits.map((hit) => hit.canonicalAtomId));
  const relatedGroups = collectQuestionTraceGroups(
    relatedHits.filter((hit) => !directAtoms.has(hit.canonicalAtomId)),
  );
  const directItems = [...directGroups.entries()].map(([groupKey, directGroup]) => (
    questionTraceItem(groupKey, directGroup, relatedGroups.get(groupKey), questionById)
  ));
  const relatedItems = [...relatedGroups.entries()]
    .filter(([groupKey]) => !directGroups.has(groupKey))
    .map(([groupKey, relatedGroup]) => (
      questionTraceItem(groupKey, undefined, relatedGroup, questionById)
    ));
  return { directItems, relatedItems };
}

export function traceQuestionCount(hits: readonly BoardTraceHit[]) {
  return new Set(hits.map((hit) => hit.canonicalQuestionId ?? hit.questionId)).size;
}
