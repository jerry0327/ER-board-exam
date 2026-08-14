import type { AilsQuestion } from "./ails-review";
import type { FullQuestion, Manifest, QuestionIndex } from "./types";

export type AilsQuestionMode = "qbank" | "cards" | "quiz";
export type AilsQuestionOrder = "sequential" | "random";
export type AilsLearningState = "all" | "unanswered" | "wrong" | "bookmarked" | "mastered" | "unmastered";

export type AilsProgressSnapshot = {
  bookmarked: boolean;
  mastered: boolean;
  read: boolean;
  attempts: number;
  lastCorrect: boolean | null;
};

export type AilsQuestionFilters = {
  query?: string;
  topic?: string;
  classification?: string;
  learningState?: AilsLearningState;
};

export function ailsQuestionId(questionNumber: number) {
  return `AILS-Q${String(questionNumber).padStart(3, "0")}`;
}

export function ailsQuestionNumberFromId(questionId: string) {
  const match = questionId.match(/^AILS-Q(\d{1,3})$/);
  const questionNumber = match ? Number(match[1]) : NaN;
  return Number.isInteger(questionNumber) && questionNumber >= 1 && questionNumber <= 272
    ? questionNumber
    : null;
}

export function ailsQuestionExplanation(question: AilsQuestion) {
  const sections = ["## 歷屆題目解析", question.rationale];
  if (question.currentNote) sections.push("## 現行觀念提醒", question.currentNote);
  if (question.repeatGroup?.length) {
    sections.push(
      "## 相關重複題",
      `同組題號：${question.repeatGroup.map((number) => ailsQuestionId(number)).join("、")}`,
    );
  }
  return sections.join("\n\n");
}

export function ailsQuestionToFull(question: AilsQuestion): FullQuestion {
  return {
    id: ailsQuestionId(question.num),
    exam: "AILS",
    year: 2017,
    number: question.num,
    title: question.topic,
    stem: question.question,
    answerKeys: [question.answer],
    allCredit: false,
    questionType: question.questionClass,
    focus: question.topic,
    category: question.topic,
    tags: [question.status],
    sourceSections: [],
    images: [],
    options: question.options.map((option) => ({ key: option.label, text: option.text })),
    answerText: question.answerText,
    explanation: ailsQuestionExplanation(question),
    searchText: [
      question.topic,
      question.questionClass,
      question.answerText,
      question.rationale,
      question.currentNote,
      ...question.options.map((option) => option.text),
    ].join(" "),
  };
}

export function buildAilsQuestionCollection(questions: AilsQuestion[], topics: string[]) {
  const fullQuestions = questions.map(ailsQuestionToFull);
  const indexQuestions: QuestionIndex[] = fullQuestions;
  const manifest: Manifest = {
    title: "AILS 急性中毒題庫",
    totalQuestions: questions.length,
    totalExplanations: questions.length,
    duplicateGroups: 0,
    groups: [{ id: "AILS", label: "AILS 第 3 版參考題庫", count: questions.length, file: "" }],
    categories: topics.map((topic) => ({
      id: topic,
      count: questions.filter((question) => question.topic === topic).length,
    })),
    sourceSections: [],
    validation: {},
  };
  return {
    manifest,
    questions: indexQuestions,
    fullQuestions,
    questionById: new Map(fullQuestions.map((question) => [question.id, question])),
  };
}

export function filterAilsQuestions(
  questions: AilsQuestion[],
  filters: AilsQuestionFilters,
  progressFor: (questionNumber: number) => AilsProgressSnapshot,
) {
  const query = filters.query?.trim().toLocaleLowerCase("zh-Hant") ?? "";
  const topic = filters.topic ?? "all";
  const classification = filters.classification ?? "all";
  const learningState = filters.learningState ?? "all";

  return questions.filter((question) => {
    if (topic !== "all" && question.topic !== topic) return false;
    if (classification !== "all" && question.questionClass !== classification) return false;
    if (query) {
      const haystack = [
        question.question,
        question.topic,
        question.rationale,
        question.currentNote,
        question.answerText,
        ...question.options.map((option) => option.text),
      ].join(" ").toLocaleLowerCase("zh-Hant");
      if (!haystack.includes(query)) return false;
    }

    const progress = progressFor(question.num);
    if (learningState === "unanswered" && progress.attempts > 0) return false;
    if (learningState === "wrong" && progress.lastCorrect !== false) return false;
    if (learningState === "bookmarked" && !progress.bookmarked) return false;
    if (learningState === "mastered" && !progress.mastered) return false;
    if (learningState === "unmastered" && progress.mastered) return false;
    return true;
  });
}

export function orderAilsQuestions(
  questions: AilsQuestion[],
  order: AilsQuestionOrder,
  random: () => number = Math.random,
) {
  const result = [...questions].sort((left, right) => left.num - right.num);
  if (order === "sequential") return result;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function buildAilsQuestionSet(
  questions: AilsQuestion[],
  filters: AilsQuestionFilters,
  progressFor: (questionNumber: number) => AilsProgressSnapshot,
  count: number,
  order: AilsQuestionOrder,
  random: () => number = Math.random,
) {
  return orderAilsQuestions(filterAilsQuestions(questions, filters, progressFor), order, random)
    .slice(0, Math.max(1, count))
    .map((question) => question.num);
}
