import type { RosensChapter } from "./rosens-catalog";
import type { AudioSummarySource } from "./audio-summaries";
import type { GoldfrankGuideChapter } from "./goldfrank-guides";
import type { LearningDocument } from "./learning-documents";
import { parseAnyGuideAnnotationResourceId, type AnyGuideAnnotationSource } from "./annotation-source.ts";
import { supplementalSectionDisplayId } from "./supplemental-guide-ids.ts";
import type { StudyGuideChapter } from "./study-guides";
import type { NavView, QuestionIndex, StudyAnnotation } from "./types";

export const SPOTLIGHT_RESULT_LIMITS = {
  questions: 7,
  tintinalli: 4,
  rosens: 4,
  goldfrank: 4,
  audio: 5,
  documents: 3,
  annotations: 3,
  navigation: 3,
  resources: 3,
} as const;

export const SPOTLIGHT_MAX_RESULTS = Object.values(SPOTLIGHT_RESULT_LIMITS)
  .reduce((total, value) => total + value, 0);

export type SpotlightNavigationAction = {
  view: NavView;
  label: string;
  description: string;
  keywords: string;
};

export type SpotlightOfficialResource = {
  id: string;
  label: string;
  description: string;
  href: string;
  hostLabel: string;
  keywords: string;
};

export const SPOTLIGHT_NAVIGATION_ACTIONS: readonly SpotlightNavigationAction[] = [
  { view: "總覽", label: "回到總覽", description: "今日任務、進度與繼續閱讀", keywords: "首頁 home dashboard 今日 任務" },
  { view: "開始作答", label: "開始作答", description: "隨機練習、模擬考或自訂題組", keywords: "作答 練習 quiz test practice 模擬考 隨機" },
  { view: "題庫瀏覽", label: "瀏覽題庫", description: "搜尋、篩選與挑選題目", keywords: "題庫 搜尋 browse filter 題目" },
  { view: "詳解閱讀", label: "閱讀詳解", description: "依年度或主題閱讀逐題解析", keywords: "詳解 explanation reader 答案 解析" },
  { view: "學習指引", label: "學習內容", description: "指引、音檔、文件與考題溯源", keywords: "學習 指引 guide textbook tintinalli rosens rosen goldfrank toxicology 教科書 章節 音檔 文件" },
  { view: "學習音檔", label: "學習音檔", description: "教科書章節有聲複習", keywords: "音檔 audio audiobook 有聲書 rosens rosen goldfrank 章節" },
  { view: "學習文件", label: "學習文件", description: "閱讀圖譜、講義與簡報", keywords: "文件 document pdf word ppt powerpoint 圖譜 講義 簡報" },
  { view: "錯題本", label: "錯題本", description: "待釐清、到期與收藏題目", keywords: "錯題 wrong review 複習 到期 收藏" },
  { view: "筆記本", label: "筆記本", description: "搜尋重點標記與題目筆記", keywords: "筆記 note annotation highlight 重點" },
  { view: "學習分析", label: "學習分析", description: "正確率、弱項與題庫分布", keywords: "分析 analytics statistics 統計 正確率 弱項" },
  { view: "備考中心", label: "備考中心", description: "課程、證書、完訓與甄審資料", keywords: "備考 課程 證書 完訓 甄審 表單 credential certificate course form" },
  { view: "休息站", label: "休息站", description: "短暫休息與呼吸練習", keywords: "休息 rest break breathe 呼吸" },
] as const;

export const SPOTLIGHT_QUICK_VIEWS: readonly NavView[] = [
  "總覽",
  "開始作答",
  "學習指引",
  "錯題本",
  "備考中心",
] as const;

export const SPOTLIGHT_OFFICIAL_RESOURCES: readonly SpotlightOfficialResource[] = [
  {
    id: "tsem-courses",
    label: "學會主辦課程列表",
    description: "查詢台灣急診醫學會主辦課程、日期與報名狀態",
    href: "https://www.sem.org.tw/Activity/A/Index",
    hostLabel: "sem.org.tw",
    keywords: "台灣 急診 醫學會 tsem sem 課程 活動 報名 積分 完訓 course activity registration",
  },
  {
    id: "tsem-forms",
    label: "訓練醫院與住院醫師各類表單",
    description: "輪訓合約、訓練證明、申請表與認證清單",
    href: "https://www.sem.org.tw/Doc/%E5%90%84%E9%A1%9E%E8%A1%A8%E5%96%AE",
    hostLabel: "sem.org.tw",
    keywords: "台灣 急診 醫學會 tsem sem 各類 表單 申請 下載 證明 完訓 住院醫師 訓練醫院 form document",
  },
  {
    id: "tsem-learning-platform",
    label: "台灣急診醫學會線上教育平台",
    description: "住院醫師訓練、核心能力與專科課程入口",
    href: "https://www.sem.org.tw/Content/%E7%B7%9A%E4%B8%8A%E6%95%99%E8%82%B2%E5%B9%B3%E5%8F%B0",
    hostLabel: "sem.org.tw",
    keywords: "台灣 急診 醫學會 tsem sem 線上 教育 平台 課程 住院醫師 核心能力 e learning online education",
  },
  {
    id: "tsem-announcements",
    label: "台灣急診醫學會最新公告",
    description: "全學會各類公告、教育活動與最新消息",
    href: "https://www.sem.org.tw/News",
    hostLabel: "sem.org.tw",
    keywords: "台灣 急診 醫學會 tsem sem 最新 公告 新聞 消息 甄審 教育 考試",
  },
  {
    id: "tsem-board-rules",
    label: "急診專科醫師甄審原則",
    description: "衛福部公告之急診醫學科專科醫師甄審原則",
    href: "https://www.sem.org.tw/Content/%E7%94%84%E5%AF%A9%E5%8E%9F%E5%89%87",
    hostLabel: "sem.org.tw",
    keywords: "急診 專科 醫師 甄審 原則 資格 規則 board examination rules",
  },
  {
    id: "taiwan-cdc-diseases",
    label: "疾管署傳染病與防疫專題",
    description: "疾病介紹、病例定義與專業工作指引",
    href: "https://www.cdc.gov.tw/Disease/Index",
    hostLabel: "cdc.gov.tw",
    keywords: "衛福部 疾管署 cdc 傳染病 防疫 病例 定義 指引 infectious disease",
  },
  {
    id: "pubmed",
    label: "PubMed 醫學文獻搜尋",
    description: "由美國國家醫學圖書館維護的生醫文獻資料庫",
    href: "https://pubmed.ncbi.nlm.nih.gov/",
    hostLabel: "pubmed.ncbi.nlm.nih.gov",
    keywords: "pubmed medline ncbi nlm 醫學 文獻 搜尋 evidence research paper",
  },
] as const;

const SAFE_RESOURCE_HOSTS = new Set([
  "www.sem.org.tw",
  "www.cdc.gov.tw",
  "pubmed.ncbi.nlm.nih.gov",
]);

export function normalizeSpotlightSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/([0-9]{3}[ab]?)\s*[- ]?\s*(?:q)?\s*0*([0-9]{1,3})/iu, "$1-q$2")
    .replace(/\s+/gu, " ")
    .trim();
}

export function safeSpotlightResourceHref(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || !SAFE_RESOURCE_HOSTS.has(url.hostname.toLocaleLowerCase())
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

type Ranked<T> = { item: T; score: number };

export type SpotlightSearchResults = {
  questions: QuestionIndex[];
  tintinalli: StudyGuideChapter[];
  rosens: RosensChapter[];
  goldfrank: GoldfrankGuideChapter[];
  audio: AudioSummarySource[];
  documents: LearningDocument[];
  annotations: Array<{
    annotation: StudyAnnotation;
    question: QuestionIndex | null;
    guide: StudyGuideChapter | null;
    rosensChapter: RosensChapter | null;
    guideSource: AnyGuideAnnotationSource | null;
  }>;
  navigation: SpotlightNavigationAction[];
  resources: SpotlightOfficialResource[];
  count: number;
};

type SpotlightSearchInput = {
  query: string;
  questions: QuestionIndex[];
  tintinalliChapters?: StudyGuideChapter[];
  rosensChapters?: RosensChapter[];
  goldfrankChapters?: GoldfrankGuideChapter[];
  audioSummaries?: AudioSummarySource[];
  learningDocuments?: readonly LearningDocument[];
  annotations?: StudyAnnotation[];
  navigationActions?: readonly SpotlightNavigationAction[];
  resources?: readonly SpotlightOfficialResource[];
  questionMatches?: (question: QuestionIndex, query: string) => boolean;
};

function searchableText(values: Array<string | number | null | undefined>) {
  return normalizeSpotlightSearch(values.filter((value) => value !== null && value !== undefined).join(" "));
}

function textScore(normalizedQuery: string, text: string, preferred: string[] = []) {
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (!tokens.length || !tokens.every((token) => text.includes(token))) return null;
  let score = 20 + tokens.length * 4;
  for (const field of preferred) {
    const normalized = normalizeSpotlightSearch(field);
    if (normalized === normalizedQuery) score += 160;
    else if (normalized.startsWith(normalizedQuery)) score += 90;
    else if (normalized.includes(normalizedQuery)) score += 55;
  }
  return score;
}

function ranked<T>(items: T[], score: (item: T) => number | null, limit: number) {
  return items
    .map((item, index) => ({ item, score: score(item), index }))
    .filter((entry): entry is Ranked<T> & { index: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function questionText(question: QuestionIndex) {
  return searchableText([
    question.id,
    question.title,
    question.stem,
    question.searchText,
    question.category,
    question.questionType,
    question.focus,
    ...(question.tags ?? []),
  ]);
}

function tintinalliText(chapter: StudyGuideChapter) {
  const padded = String(chapter.id).padStart(3, "0");
  return searchableText([
    chapter.id,
    padded,
    `chapter ${chapter.id}`,
    `ch ${chapter.id}`,
    `第 ${chapter.id} 章`,
    chapter.title,
    chapter.sectionTitle,
    ...chapter.parts.flatMap((part) => [part.title, part.part]),
  ]);
}

function rosensText(chapter: RosensChapter) {
  const ordinal = String(chapter.ordinal);
  const paddedOrdinal = ordinal.padStart(3, "0");
  return searchableText([
    chapter.id,
    chapter.displayId,
    ordinal,
    paddedOrdinal,
    `chapter ${ordinal}`,
    `ch ${ordinal}`,
    `全書第 ${ordinal} 章`,
    `chapter ${chapter.displayId}`,
    `ch ${chapter.displayId}`,
    `第 ${chapter.displayId} 章`,
    "rosens rosen rosen’s",
    chapter.title,
    chapter.sectionTitle,
    chapter.sectionLabel,
    chapter.part,
  ]);
}

function goldfrankText(chapter: GoldfrankGuideChapter) {
  return searchableText([
    chapter.id,
    chapter.number,
    `chapter ${chapter.number}`,
    `ch ${chapter.number}`,
    `第 ${chapter.number} 章`,
    "goldfrank goldfrank’s toxicology toxicologic emergencies 11e",
    chapter.title,
    ...Object.values(chapter.modes).map((mode) => mode.headingTitle),
  ]);
}

function audioText(source: AudioSummarySource) {
  const chapterNumber = /^\d+$/u.test(source.chapterId)
    ? String(Number(source.chapterId))
    : source.chapterId;
  return searchableText([
    source.id,
    source.collectionId,
    source.collectionTitle,
    source.kind === "question-set" ? "歷屆題庫 題組 題目複習" : "教科書 章節",
    source.chapterId,
    source.chapterLabel,
    chapterNumber,
    `chapter ${chapterNumber}`,
    `ch ${chapterNumber}`,
    `第 ${chapterNumber} 章`,
    source.textbook === "rosens"
      ? "rosens rosen rosen’s 學習音檔 有聲書"
      : source.textbook === "tintinalli"
        ? "tintinalli 學習音檔 有聲書"
        : source.textbook === "goldfrank"
          ? "goldfrank toxicology toxicologic emergencies 學習音檔 有聲書"
          : "學習音檔 有聲書",
    source.title,
  ]);
}

function documentText(document: LearningDocument) {
  return searchableText([
    document.id,
    document.title,
    document.subtitle,
    document.description,
    document.format,
    document.layoutLabel,
    "學習文件 圖譜 講義",
  ]);
}

function guideAnnotationText(
  source: AnyGuideAnnotationSource | null,
  tintinalliChapter: StudyGuideChapter | null,
  rosensChapter: RosensChapter | null,
) {
  if (!source) return [];
  if (source.resourceKind === "unit") {
    return [`考題對照指引 ${source.unitCode}`, `急診專科考題總指引 單元 ${source.unitCode}`, "歷屆考點 逐題溯源"];
  }
  if (source.resourceKind === "chapter") {
    if (source.textbook === "ems") {
      return [
        `ems chapter ${source.chapter}`,
        `第 ${source.chapter} 章`,
        "ems 緊急醫療救護 到院前 學習指引",
      ];
    }
    if (source.textbook === "goldfrank") {
      return [
        `goldfrank chapter ${source.chapterId}`,
        `第 ${source.chapter} 章`,
        "goldfrank toxicology toxicologic emergencies 11e 學習指引",
      ];
    }
    if (source.textbook === "tintinalli") {
      return [
        `chapter ${source.chapterId}`,
        `第 ${source.chapter} 章`,
        "tintinalli 學習指引",
        tintinalliChapter?.title,
        tintinalliChapter?.sectionTitle,
      ];
    }
    return [
      `chapter ${rosensChapter?.displayId ?? source.chapterId}`,
      `第 ${rosensChapter?.displayId ?? source.chapterId} 章`,
      "rosens rosen rosen’s 學習指引",
      rosensChapter?.title,
      rosensChapter?.sectionTitle,
      rosensChapter?.sectionLabel,
      rosensChapter?.part,
    ];
  }
  if (source.resourceKind === "section") {
    const sectionId = supplementalSectionDisplayId(source.sectionId);
    const textbookTerms = source.textbook === "rosens"
      ? "rosens rosen rosen’s"
      : "tintinalli";
    return [`${textbookTerms} section ${sectionId}`, `section ${sectionId}`, "分冊 整合 讀書 指南"];
  }
  return source.textbook === "rosens"
    ? ["rosens rosen rosen’s overview 全書 整合 讀書 指南 導讀"]
    : ["tintinalli overview 全書 整合 讀書 指南 導讀"];
}

export function searchSpotlight({
  query,
  questions,
  tintinalliChapters = [],
  rosensChapters = [],
  goldfrankChapters = [],
  audioSummaries = [],
  learningDocuments = [],
  annotations = [],
  navigationActions = SPOTLIGHT_NAVIGATION_ACTIONS,
  resources = SPOTLIGHT_OFFICIAL_RESOURCES,
  questionMatches,
}: SpotlightSearchInput): SpotlightSearchResults {
  const normalizedQuery = normalizeSpotlightSearch(query);
  if (!normalizedQuery) {
    return { questions: [], tintinalli: [], rosens: [], goldfrank: [], audio: [], documents: [], annotations: [], navigation: [], resources: [], count: 0 };
  }

  const questionById = new Map(questions.map((question) => [question.id, question]));
  const tintinalliById = new Map(tintinalliChapters.map((chapter) => [chapter.id, chapter]));
  const rosensById = new Map(rosensChapters.map((chapter) => [chapter.id, chapter]));
  const questionResults = ranked(questions, (question) => {
    if (questionMatches && !questionMatches(question, query)) return null;
    const localScore = textScore(normalizedQuery, questionText(question), [question.id, question.title]);
    return localScore ?? (questionMatches ? 10 : null);
  }, SPOTLIGHT_RESULT_LIMITS.questions);

  const tintinalli = ranked(tintinalliChapters, (chapter) => textScore(
    normalizedQuery,
    tintinalliText(chapter),
    [String(chapter.id), String(chapter.id).padStart(3, "0"), chapter.title],
  ), SPOTLIGHT_RESULT_LIMITS.tintinalli);

  const rosens = ranked(rosensChapters, (chapter) => textScore(
    normalizedQuery,
    rosensText(chapter),
    [chapter.id, chapter.displayId, String(chapter.ordinal), String(chapter.ordinal).padStart(3, "0"), chapter.title],
  ), SPOTLIGHT_RESULT_LIMITS.rosens);

  const goldfrank = ranked(goldfrankChapters, (chapter) => textScore(
    normalizedQuery,
    goldfrankText(chapter),
    [chapter.id, String(chapter.number), chapter.title, chapter.modes.full.headingTitle],
  ), SPOTLIGHT_RESULT_LIMITS.goldfrank);

  const audio = ranked([...audioSummaries], (source) => textScore(
    normalizedQuery,
    audioText(source),
    [source.chapterId, source.chapterLabel, source.title, source.collectionTitle],
  ), SPOTLIGHT_RESULT_LIMITS.audio);

  const documents = ranked([...learningDocuments], (document) => textScore(
    normalizedQuery,
    documentText(document),
    [document.title, document.subtitle, document.format],
  ), SPOTLIGHT_RESULT_LIMITS.documents);

  const annotationCandidates = annotations.filter((annotation) => !annotation.deletedAt).map((annotation) => {
    const guideSource = parseAnyGuideAnnotationResourceId(annotation.questionId);
    const guide = guideSource?.textbook === "tintinalli" && guideSource.resourceKind === "chapter"
      ? tintinalliById.get(guideSource.chapter) ?? null
      : null;
    const rosensChapter = guideSource?.textbook === "rosens" && guideSource.resourceKind === "chapter"
      ? rosensById.get(guideSource.chapterId) ?? null
      : null;
    return {
      annotation,
      question: questionById.get(annotation.questionId) ?? null,
      guide,
      rosensChapter,
      guideSource,
    };
  });
  const annotationResults = ranked(annotationCandidates, ({ annotation, question, guide, rosensChapter, guideSource }) => {
    const guideText = guideAnnotationText(guideSource, guide, rosensChapter);
    return textScore(normalizedQuery, searchableText([
      annotation.questionId,
      question?.title,
      question?.category,
      ...guideText,
      annotation.quote,
      annotation.body,
    ]), [
      annotation.questionId,
      question?.title ?? "",
      guide?.title ?? "",
      guide?.sectionTitle ?? "",
      rosensChapter?.title ?? "",
      rosensChapter?.sectionTitle ?? "",
      ...guideText.map((value) => String(value ?? "")),
      annotation.quote,
      annotation.body,
    ]);
  }, SPOTLIGHT_RESULT_LIMITS.annotations);

  const navigation = ranked([...navigationActions], (action) => textScore(
    normalizedQuery,
    searchableText([action.label, action.view, action.description, action.keywords]),
    [action.label, action.view],
  ), SPOTLIGHT_RESULT_LIMITS.navigation);

  const safeResources = resources.filter((resource) => safeSpotlightResourceHref(resource.href));
  const resourceResults = ranked([...safeResources], (resource) => textScore(
    normalizedQuery,
    searchableText([resource.label, resource.description, resource.hostLabel, resource.keywords]),
    [resource.label, resource.hostLabel],
  ), SPOTLIGHT_RESULT_LIMITS.resources);

  const count = questionResults.length
    + tintinalli.length
    + rosens.length
    + goldfrank.length
    + audio.length
    + documents.length
    + annotationResults.length
    + navigation.length
    + resourceResults.length;
  return {
    questions: questionResults,
    tintinalli,
    rosens,
    goldfrank,
    audio,
    documents,
    annotations: annotationResults,
    navigation,
    resources: resourceResults,
    count,
  };
}
