import type { Confidence, PracticeMode } from "./types";

export type EvaluationQuestion = {
  id: string;
  category: string;
  answerKeys: string[];
  allCredit: boolean;
  sourceSections: number[];
  tintinalliChapters?: number[];
};

export type TopicEvaluation = {
  category: string;
  correct: number;
  wrong: number;
  total: number;
  accuracy: number;
  sampleSufficient: boolean;
};

export type GuideRecommendation = {
  kind: "chapter" | "section";
  id: number;
  wrongCount: number;
};

export type SessionEvaluation = {
  scored: number;
  correct: number;
  wrong: number;
  unanswered: number;
  completion: number;
  accuracy: number;
  durationSeconds: number | null;
  averageSeconds: number | null;
  band: "baseline" | "priority" | "developing" | "solid" | "strong";
  bandLabel: string;
  bandDetail: string;
  topics: TopicEvaluation[];
  weakestTopic: TopicEvaluation | null;
  strongestTopic: TopicEvaluation | null;
  highConfidenceWrong: number;
  lowConfidenceCorrect: number;
  wrongIds: string[];
  recommendedGuides: GuideRecommendation[];
  recommendationTitle: string;
  recommendationDetail: string;
};

type EvaluateSessionInput = {
  questions: EvaluationQuestion[];
  answers: Record<string, string[]>;
  confidence: Record<string, Confidence>;
  mode: PracticeMode;
  startedAt: string;
  completedAt?: string;
  accumulatedPausedMs?: number;
};

export function sameAnswer(selected: string[], official: string[]) {
  if (selected.length !== official.length) return false;
  const orderedSelected = [...selected].sort();
  const orderedOfficial = [...official].sort();
  return orderedSelected.every((key, index) => key === orderedOfficial[index]);
}

function elapsedSeconds(startedAt: string, completedAt?: string, accumulatedPausedMs = 0) {
  if (!completedAt) return null;
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  const elapsed = Math.round((completed - started - Math.max(0, accumulatedPausedMs)) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 43_200) return null;
  return elapsed;
}

function performanceBand(scored: number, accuracy: number) {
  if (scored < 5) return {
    band: "baseline" as const,
    label: "本輪題數較少",
    detail: "先查看錯題與未作答題目，再繼續下一輪。",
  };
  if (accuracy >= 85) return {
    band: "strong" as const,
    label: "本輪表現穩定",
    detail: "可先查看低信心答對題與少數錯題，再練習其他主題。",
  };
  if (accuracy >= 75) return {
    band: "solid" as const,
    label: "大部分題目答對",
    detail: "接下來可優先複習錯題較集中的主題。",
  };
  if (accuracy >= 60) return {
    band: "developing" as const,
    label: "部分主題需要複習",
    detail: "先逐題查看錯題，再重新作答。",
  };
  return {
    band: "priority" as const,
    label: "優先複習錯題",
    detail: "先查看錯題較多的主題與高信心答錯題，再進行下一輪練習。",
  };
}

export function evaluateSession({ questions, answers, confidence, mode, startedAt, completedAt, accumulatedPausedMs }: EvaluateSessionInput): SessionEvaluation {
  const scoredQuestions = questions.filter((question) => !question.allCredit);
  const answered = questions.filter((question) => question.allCredit || (answers[question.id]?.length ?? 0) > 0).length;
  const unanswered = questions.length - answered;
  const outcomes = scoredQuestions.map((question) => {
    const selected = answers[question.id] ?? [];
    const answeredQuestion = selected.length > 0;
    return {
      question,
      answered: answeredQuestion,
      correct: answeredQuestion && sameAnswer(selected, question.answerKeys),
      confidence: confidence[question.id] ?? "normal",
    };
  });
  const correct = outcomes.filter((outcome) => outcome.correct).length;
  const wrongOutcomes = outcomes.filter((outcome) => !outcome.correct);
  const scored = outcomes.length;
  const accuracy = scored ? Math.round(correct / scored * 100) : 0;
  const topicMap = new Map<string, { correct: number; total: number }>();

  for (const outcome of outcomes) {
    const row = topicMap.get(outcome.question.category) ?? { correct: 0, total: 0 };
    row.total += 1;
    row.correct += outcome.correct ? 1 : 0;
    topicMap.set(outcome.question.category, row);
  }

  const topics: TopicEvaluation[] = [...topicMap.entries()]
    .map(([category, row]) => ({
      category,
      correct: row.correct,
      wrong: row.total - row.correct,
      total: row.total,
      accuracy: Math.round(row.correct / row.total * 100),
      sampleSufficient: row.total >= 3,
    }))
    .sort((left, right) => left.accuracy - right.accuracy || right.total - left.total || left.category.localeCompare(right.category, "zh-Hant"));

  const strongestTopic = [...topics].sort((left, right) => right.accuracy - left.accuracy || right.total - left.total || left.category.localeCompare(right.category, "zh-Hant"))[0] ?? null;
  const weakestTopic = topics[0] ?? null;
  const highConfidenceWrong = wrongOutcomes.filter((outcome) => outcome.answered && outcome.confidence === "high").length;
  const lowConfidenceCorrect = outcomes.filter((outcome) => outcome.correct && outcome.confidence === "low").length;
  const durationSeconds = elapsedSeconds(startedAt, completedAt, accumulatedPausedMs);
  const averageSeconds = durationSeconds !== null && answered ? Math.round(durationSeconds / answered) : null;
  const band = performanceBand(scored, accuracy);

  const exactChapterCounts = new Map<number, number>();
  const sectionCounts = new Map<number, number>();
  for (const outcome of wrongOutcomes) {
    const chapters = outcome.question.tintinalliChapters?.filter((chapter) => Number.isInteger(chapter) && chapter >= 1 && chapter <= 303) ?? [];
    if (chapters.length) {
      for (const chapter of new Set(chapters)) exactChapterCounts.set(chapter, (exactChapterCounts.get(chapter) ?? 0) + 1);
    } else {
      for (const section of new Set(outcome.question.sourceSections)) sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
    }
  }
  const guideRows = exactChapterCounts.size
    ? [...exactChapterCounts.entries()].map(([id, wrongCount]) => ({ kind: "chapter" as const, id, wrongCount }))
    : [...sectionCounts.entries()].map(([id, wrongCount]) => ({ kind: "section" as const, id, wrongCount }));
  const recommendedGuides = guideRows.sort((left, right) => right.wrongCount - left.wrongCount || left.id - right.id).slice(0, 3);

  let recommendationTitle = "再完成一組練習";
  let recommendationDetail = "下一輪可選擇 10 題混合練習。";
  if (scored >= 5 && wrongOutcomes.length === 0) {
    recommendationTitle = "繼續練習其他主題";
    recommendationDetail = lowConfidenceCorrect
      ? `本輪全對，但有 ${lowConfidenceCorrect} 題信心偏低；先讀完這些詳解，再挑戰新領域。`
      : "本輪沒有計分錯題，可把下一輪移到尚未覆蓋的領域。";
  } else if (highConfidenceWrong > 0) {
    recommendationTitle = "先回看高信心答錯題";
    recommendationDetail = `${highConfidenceWrong} 題在高信心作答時答錯，可先閱讀詳解並重新作答。`;
  } else if (weakestTopic && wrongOutcomes.length > 0) {
    recommendationTitle = `優先補強「${weakestTopic.category}」`;
    recommendationDetail = `本輪此主題 ${weakestTopic.correct}/${weakestTopic.total} 題答對，可先閱讀錯題詳解，再做同領域練習。`;
  }

  if (mode === "study" && durationSeconds !== null && averageSeconds !== null) {
    // Study mode includes time spent reading explanations. The UI labels this
    // distinction instead of presenting the value as pure answer speed.
  }

  return {
    scored,
    correct,
    wrong: wrongOutcomes.length,
    unanswered,
    completion: questions.length ? Math.round(answered / questions.length * 100) : 0,
    accuracy,
    durationSeconds,
    averageSeconds,
    band: band.band,
    bandLabel: band.label,
    bandDetail: band.detail,
    topics,
    weakestTopic,
    strongestTopic,
    highConfidenceWrong,
    lowConfidenceCorrect,
    wrongIds: wrongOutcomes.map((outcome) => outcome.question.id),
    recommendedGuides,
    recommendationTitle,
    recommendationDetail,
  };
}
