import type { FullQuestion, Manifest, QuestionIndex } from "./types";
import { plainQuestionText } from "./question-text";
import { loadStudyGuideLinks } from "./study-guides";
import { fetchCompressedStatic } from "./compressed-static.ts";

let manifestRequest: Promise<Manifest> | null = null;
let startupBankRequest: Promise<{ manifest: Manifest; questions: QuestionIndex[] }> | null = null;
let bankRequest: Promise<{ manifest: Manifest; questions: QuestionIndex[] }> | null = null;
let searchRequest: Promise<void> | null = null;
let questionDataRevision: string | null = null;
const questionCache = new Map<string, Promise<FullQuestion>>();
const searchCatalog = new Map<string, string>();
const searchHaystackCache = new WeakMap<QuestionIndex, { catalogVersion: number; value: string }>();
let lastSearchInput = "";
let lastNormalizedQuery = "";

function cleanIndexQuestion(question: QuestionIndex): QuestionIndex {
  return { ...question, stem: plainQuestionText(question.stem) };
}

type StartupQuestion = Pick<
  QuestionIndex,
  "id" | "exam" | "year" | "number" | "allCredit" | "category" | "canonicalId" | "excludedFromPractice"
>;

type QuestionIndexPayload<T> = {
  questionDataRevision: string;
  questions: T[];
};

function retainQuestionDataRevision(value: string) {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("題庫資料版本無效");
  if (questionDataRevision && questionDataRevision !== value) {
    throw new Error("題庫索引版本不一致，請重新整理頁面");
  }
  questionDataRevision = value;
}

function cleanStartupQuestion(question: StartupQuestion): QuestionIndex {
  return {
    ...question,
    title: "",
    stem: "",
    answerKeys: [],
    questionType: "",
    focus: "",
    sourceSections: [],
    images: [],
  };
}

function cleanFullQuestion(question: FullQuestion): FullQuestion {
  return {
    ...question,
    stem: plainQuestionText(question.stem),
    options: question.options.map((option) => ({ ...option, text: plainQuestionText(option.text) })),
  };
}

function loadQuestionManifest() {
  if (!manifestRequest) {
    manifestRequest = fetchCompressedStatic("/data/manifest.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("題庫資料載入失敗");
        return response.json() as Promise<Manifest>;
      })
      .catch((error: unknown) => {
        manifestRequest = null;
        throw error;
      });
  }
  return manifestRequest;
}

export async function loadQuestionBankStartup() {
  if (!startupBankRequest) {
    startupBankRequest = (async () => {
      const [manifest, indexResponse] = await Promise.all([
        loadQuestionManifest(),
        fetchCompressedStatic("/data/startup-index.json", { cache: "no-cache" }),
      ]);
      if (!indexResponse.ok) throw new Error("題庫資料載入失敗");
      const payload = (await indexResponse.json()) as QuestionIndexPayload<StartupQuestion>;
      retainQuestionDataRevision(payload.questionDataRevision);
      return {
        manifest,
        questions: payload.questions.map(cleanStartupQuestion),
      };
    })().catch((error: unknown) => {
      startupBankRequest = null;
      throw error;
    });
  }
  return startupBankRequest;
}

export async function loadQuestionBank() {
  if (!bankRequest) {
    bankRequest = (async () => {
      const [manifest, indexResponse] = await Promise.all([
        loadQuestionManifest(),
        fetchCompressedStatic("/data/index.json", { cache: "no-cache" }),
      ]);
      if (!indexResponse.ok) throw new Error("題庫資料載入失敗");
      const payload = (await indexResponse.json()) as QuestionIndexPayload<QuestionIndex>;
      retainQuestionDataRevision(payload.questionDataRevision);
      return {
        manifest,
        questions: payload.questions.map(cleanIndexQuestion),
      };
    })().catch((error: unknown) => {
      bankRequest = null;
      throw error;
    });
  }
  return bankRequest;
}

export async function enrichQuestionBankGuideLinks(questions: QuestionIndex[]) {
  const guideLinks = await loadStudyGuideLinks();
  return questions.map((question) => ({
    ...question,
    tintinalliChapters: guideLinks.questionToChapters[question.id] ?? [],
  }));
}

export function loadSearchCatalog() {
  if (!searchRequest) {
    searchRequest = fetchCompressedStatic("/data/search.json", { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("搜尋索引載入失敗");
        return response.json() as Promise<{ questions: [string, string][] }>;
      })
      .then((payload) => {
        for (const [id, value] of payload.questions) searchCatalog.set(id, value);
      })
      .catch((error: unknown) => {
        searchRequest = null;
        throw error;
      });
  }
  return searchRequest;
}

export function loadQuestion(question: Pick<QuestionIndex, "id" | "exam" | "contentHash">) {
  if (!questionCache.has(question.id)) {
    const version = questionDataRevision
      ? `?v=${encodeURIComponent(questionDataRevision)}`
      : "";
    const request = Promise.all([
      fetchCompressedStatic(`/data/questions/${question.exam}/${question.id}.json${version}`, {
        cache: version ? "force-cache" : "no-cache",
      }),
      loadStudyGuideLinks(),
    ])
      .then(([response, guideLinks]) => {
        if (!response.ok) throw new Error(`找不到題目 ${question.id}`);
        return Promise.all([response.json() as Promise<FullQuestion>, guideLinks]);
      })
      .then(([fullQuestion, guideLinks]) => ({
        ...cleanFullQuestion(fullQuestion),
        tintinalliChapters: guideLinks.questionToChapters[question.id] ?? [],
      }))
      .catch((error: unknown) => {
        questionCache.delete(question.id);
        throw error;
      });
    questionCache.set(question.id, request);
  }
  return questionCache.get(question.id)!;
}

export function prefetchQuestion(question: Pick<QuestionIndex, "id" | "exam" | "contentHash">) {
  void loadQuestion(question).catch(() => undefined);
}

export function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/([0-9]{3}[ab]?)\s*[- ]?\s*(?:q)?\s*0*([0-9]{1,3})/i, "$1-q$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearch(question: QuestionIndex, value: string, catalogVersion = 0) {
  if (value !== lastSearchInput) {
    lastSearchInput = value;
    lastNormalizedQuery = normalizeSearch(value);
  }
  const query = lastNormalizedQuery;
  if (!query) return true;
  const id = question.id.toLocaleLowerCase();
  const compactId = id.replace("-q", " ").replace(/^0+/, "");
  const cached = searchHaystackCache.get(question);
  const haystack = cached?.catalogVersion === catalogVersion ? cached.value : normalizeSearch([
      question.id,
      compactId,
      question.title,
      question.stem,
      question.searchText,
      searchCatalog.get(question.id),
      question.category,
      question.questionType,
      question.focus,
      ...(question.tags ?? []),
    ].join(" "));
  if (cached?.catalogVersion !== catalogVersion) searchHaystackCache.set(question, { catalogVersion, value: haystack });
  return query.split(" ").every((token) => haystack.includes(token));
}

export function shuffleStable<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
