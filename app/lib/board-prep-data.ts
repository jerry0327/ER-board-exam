export const BOARD_PREP_RULES_PAGE_URL = "https://www.sem.org.tw/Doc/%E7%9B%B8%E9%97%9C%E8%A6%8F%E5%AE%9A";
export const BOARD_PREP_RULES_FILE_URL = "https://tsem.blob.core.windows.net/docfilecontainer/110-115%E5%B9%B4%E5%BA%A6%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E5%BF%85%E4%BF%AE%E8%AA%B2%E7%A8%8B%E8%A1%A8%281150212%E6%9B%B4%E6%96%B0%29.xlsx";
export const BOARD_PREP_RULES_LAST_VERIFIED = "2026-07-18";

export type BoardPrepCohortId = "107" | "108-109" | "110" | "111" | "112-115";

export type BoardPrepTracking =
  | { kind: "occurrences"; count: number; unitLabel: string; notePlaceholder: string; labels?: string[] }
  | { kind: "passport"; completionLabel: string };

export type BoardPrepRuleItem = {
  id: string;
  title: string;
  officialNote: string;
  applicability: string;
  sourceLabel: string;
  sourceUrl: string;
  tracking?: BoardPrepTracking;
  requiresCertificate?: boolean;
  appliesFrom?: string;
  appliesThrough?: string;
};

export type BoardPrepRuleSection = {
  id: string;
  title: string;
  applicability: string;
  items: BoardPrepRuleItem[];
  appliesFrom?: string;
  appliesThrough?: string;
};

export type BoardPrepCohort = {
  id: BoardPrepCohortId;
  label: string;
  quotaYears: number[];
  applicability: string;
  sections: BoardPrepRuleSection[];
};

const sourceLabel = "台灣急診醫學會｜110–115 年度住院醫師必修課程表（1150212 更新）";

function rule(
  id: string,
  title: string,
  officialNote = "",
  options: Pick<BoardPrepRuleItem, "tracking" | "requiresCertificate" | "appliesFrom" | "appliesThrough"> = {},
): Omit<BoardPrepRuleItem, "applicability"> {
  return { id, title, officialNote, sourceLabel, sourceUrl: BOARD_PREP_RULES_FILE_URL, ...options };
}

function section(
  id: string,
  title: string,
  applicability: string,
  rules: Omit<BoardPrepRuleItem, "applicability">[],
  timing: Pick<BoardPrepRuleSection, "appliesFrom" | "appliesThrough"> = {},
): BoardPrepRuleSection {
  return {
    id,
    title,
    applicability,
    ...timing,
    items: rules.map((item) => ({ ...item, applicability })),
  };
}

const ultrasoundRules = [
  rule(
    "ultrasound.basic",
    "基礎超音波課程",
    "可於 PGY 期間完成；若由訓練醫院辦理，課程仍須經台灣急診醫學會認證。",
    { requiresCertificate: true },
  ),
  rule("ultrasound.advanced", "進階超音波課程", "學會主辦。", { requiresCertificate: true }),
  rule(
    "ultrasound.cases",
    "超音波案例紀錄（學習護照）",
    "主動脈、心包膜、外傷、肝膽、產科、泌尿道、深部靜脈栓塞，以及超音波輔助腹腔或胸腔穿刺，各 10 例。",
    { tracking: { kind: "passport", completionLabel: "護照紀錄已完成" } },
  ),
];

const imagingRules = [
  rule("imaging.case-evaluation", "影像醫學案例評核表"),
];

const toxicologyLegacyRules = [
  rule("toxicology.case-discussion", "中毒個案討論會"),
  rule("toxicology.hazmat-training", "毒化災訓練課程", "完成毒化災訓練，並取得學會或訓練醫院核認。", { requiresCertificate: true }),
  rule("toxicology.hazmat-drill", "毒化災實兵演習"),
  rule("toxicology.sem-case-discussion", "學會主辦之中毒個案討論會", "學會主辦。", { requiresCertificate: true }),
  rule("toxicology.ails", "AILS 課程並取得證書", "參加台灣急診醫學會 AILS 課程並取得證書。", { requiresCertificate: true }),
  rule(
    "toxicology.cases-12",
    "中毒病例 12 例（學習護照）",
    "訓練期間照顧或被照會之中毒病例 12 例。",
    { tracking: { kind: "passport", completionLabel: "護照紀錄已完成" } },
  ),
];

const toxicologyModernRules = [
  rule("toxicology.case-report", "於訓練醫院或學術研討會報告中毒個案"),
  ...toxicologyLegacyRules.slice(1),
];

const emsRules = [
  rule(
    "ems.course",
    "住院醫師緊急醫療系統訓練課程（16 小時）",
    "可於 PGY 期間完成；官方表列為學會主辦。",
    { requiresCertificate: true },
  ),
  rule("ems.ambulance-runs-4", "消防單位實習書面紀錄：救護出勤 4 件"),
  rule("ems.dispatch-2", "消防單位實習書面紀錄：救護派遣 2 件"),
  rule("ems.case-discussion-1", "消防單位實習書面紀錄：救護案例討論 1 件"),
];

const disaster107Rules = [
  rule(
    "disaster.basic-14h",
    "基礎必修課程 14 小時",
    "可參加學會住院醫師初階災難訓練；106–107 年容額亦可採學會認證之災難醫學訓練課程。REMOC 課程由訓練醫院主任、主持人或教學負責人核算時數，並於學習護照簽章。",
    { requiresCertificate: true },
  ),
  rule("disaster.exercise-8h", "災難演習 8 小時"),
  rule("disaster.evaluation", "災難醫學訓練評核表（演習）"),
];

const disaster108To111Rules = [
  rule("disaster.intro-16h", "住院醫師初階災難訓練課程 16 小時", "學會主辦。", { requiresCertificate: true }),
  rule(
    "disaster.special-24h",
    "特殊災難訓練課程 24 小時",
    "須為學會認證課程：毒化災 8 小時、核災 8 小時、其他經學會認證之相關課程 8 小時。",
    { requiresCertificate: true },
  ),
  rule(
    "disaster.drills-3",
    "至少參加 3 場不同型態演習並完成 3 份評核表",
    "包含實兵或桌上演練；型態可為災難醫療隊／大量傷患、醫院緊急應變、特殊災害（毒化災或核災）。",
    {
      tracking: {
        kind: "occurrences",
        count: 3,
        unitLabel: "場",
        notePlaceholder: "演習名稱或評核表位置",
        labels: ["災難醫療隊／大量傷患", "醫院緊急應變", "特殊災害"],
      },
    },
  ),
];

const disaster112To115Rules = [
  rule("disaster.intro", "住院醫師初階災難訓練課程", "學會主辦。", { requiresCertificate: true, appliesFrom: "2023-08-01" }),
  rule("disaster.hazmat-6h", "毒化災課程 6 小時", "須為急診醫學會認證之相關課程。", { requiresCertificate: true, appliesFrom: "2023-08-01" }),
  rule("disaster.nuclear-6h", "核災課程 6 小時", "須依官方必修課程表完成。", { requiresCertificate: true, appliesFrom: "2023-08-01" }),
  rule("disaster.other-6h", "其他經急診醫學會認證之相關課程 6 小時", "", { requiresCertificate: true, appliesFrom: "2023-08-01" }),
  rule(
    "disaster.joint-discussion-3",
    "學會主辦之災難應變與醫療聯合討論會 3 次",
    "學會主辦；官方表註記每兩月辦理一次。",
    { tracking: { kind: "occurrences", count: 3, unitLabel: "次", notePlaceholder: "討論會日期、場次或地點" }, appliesFrom: "2023-08-01" },
  ),
  rule(
    "disaster.drills-3",
    "至少參加 3 場不同型態演習並完成 3 份評核表",
    "包含實兵或桌上演練；型態可為災難醫療隊／大量傷患、醫院緊急應變、特殊災害（毒化災或核災）。",
    {
      tracking: {
        kind: "occurrences",
        count: 3,
        unitLabel: "場",
        notePlaceholder: "演習名稱或評核表位置",
        labels: ["災難醫療隊／大量傷患", "醫院緊急應變", "特殊災害"],
      },
      appliesFrom: "2023-08-01",
    },
  ),
];

const triageRules = [
  rule(
    "triage.ttas",
    "臺灣急診五級檢傷（TTAS）學員訓練課程",
    "由中華民國急重症護理學會辦理；官方表註記急診住院醫師報名享會員價。",
    { requiresCertificate: true, appliesFrom: "2022-08-01" },
  ),
];

const assessmentRules = [
  rule("assessment.midterm", "住院醫師期中能力進展評量", "學會主辦。", { appliesFrom: "2022-08-01" }),
];

const geriatricRules = [
  rule("geriatrics.assessment-model", "高齡急診照護評估模式", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.atypical-multimorbidity", "高齡急診非典型表現與多重共病", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.cognitive-behavioral", "高齡急診認知與行為問題", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.trauma", "高齡急診外傷", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.functional-decline", "高齡急診急性功能下降", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.palliative-1", "高齡急診安寧緩和照護①", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.palliative-2", "高齡急診安寧緩和照護②", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.care-transition", "高齡急診照護轉銜", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
  rule("geriatrics.medication", "高齡急診藥物處理", "學會主辦之線上課程。", { requiresCertificate: true, appliesFrom: "2026-08-01" }),
];

const applicability = {
  cohort107: "適用 107 年度訓練容額；須於住院醫師訓練期間完成。",
  cohort108109: "適用 108–109 年度訓練容額；須於住院醫師訓練期間完成。",
  cohort110: "適用 110 年度訓練容額；須於住院醫師訓練期間完成。",
  cohort111: "適用 111 年度訓練容額；須於住院醫師訓練期間完成。",
  cohort112115: "適用 112–115 年度訓練容額；須於住院醫師訓練期間完成。",
  from111: "自 111 年 8 月 1 日起收訓者適用；須於住院醫師訓練期間完成。",
  from112: "自 112 年 8 月 1 日起收訓者適用；須於住院醫師訓練期間完成。",
  from115: "自 115 年 8 月 1 日起收訓者適用；九項皆為官方表列必修線上課程。",
};

export const BOARD_PREP_COHORTS: BoardPrepCohort[] = [
  {
    id: "107",
    label: "107 年度容額",
    quotaYears: [107],
    applicability: applicability.cohort107,
    sections: [
      section("ultrasound", "超音波", applicability.cohort107, ultrasoundRules),
      section("imaging", "影像醫學", applicability.cohort107, imagingRules),
      section("toxicology", "毒物學／AILS", applicability.cohort107, toxicologyLegacyRules),
      section("disaster", "災難醫學", applicability.cohort107, disaster107Rules),
      section("ems", "緊急醫療救護訓練", applicability.cohort107, emsRules),
    ],
  },
  {
    id: "108-109",
    label: "108–109 年度容額",
    quotaYears: [108, 109],
    applicability: applicability.cohort108109,
    sections: [
      section("ultrasound", "超音波", applicability.cohort108109, ultrasoundRules),
      section("imaging", "影像醫學", applicability.cohort108109, imagingRules),
      section("toxicology", "毒物學／AILS", applicability.cohort108109, toxicologyLegacyRules),
      section("disaster", "災難醫學", applicability.cohort108109, disaster108To111Rules),
      section("ems", "緊急醫療救護訓練", applicability.cohort108109, emsRules),
    ],
  },
  {
    id: "110",
    label: "110 年度容額",
    quotaYears: [110],
    applicability: applicability.cohort110,
    sections: [
      section("ultrasound", "超音波", applicability.cohort110, ultrasoundRules),
      section("toxicology", "毒物學／AILS", applicability.cohort110, toxicologyModernRules),
      section("disaster", "災難醫學", applicability.cohort110, disaster108To111Rules),
      section("ems", "緊急醫療救護訓練", applicability.cohort110, emsRules),
    ],
  },
  {
    id: "111",
    label: "111 年度容額",
    quotaYears: [111],
    applicability: applicability.cohort111,
    sections: [
      section("ultrasound", "超音波", applicability.cohort111, ultrasoundRules),
      section("toxicology", "毒物學／AILS", applicability.cohort111, toxicologyModernRules),
      section("disaster", "災難醫學", applicability.cohort111, disaster108To111Rules),
      section("ems", "緊急醫療救護訓練", applicability.cohort111, emsRules),
      section("triage", "檢傷分類", applicability.from111, triageRules, { appliesFrom: "2022-08-01" }),
      section("assessment", "能力評量", applicability.from111, assessmentRules, { appliesFrom: "2022-08-01" }),
    ],
  },
  {
    id: "112-115",
    label: "112–115 年度容額",
    quotaYears: [112, 113, 114, 115],
    applicability: applicability.cohort112115,
    sections: [
      section("ultrasound", "超音波", applicability.cohort112115, ultrasoundRules),
      section("toxicology", "毒物學／AILS", applicability.cohort112115, toxicologyModernRules),
      section("disaster", "災難醫學", applicability.from112, disaster112To115Rules, { appliesFrom: "2023-08-01" }),
      section("ems", "緊急醫療救護訓練", applicability.cohort112115, emsRules),
      section("triage", "檢傷分類", applicability.from111, triageRules, { appliesFrom: "2022-08-01" }),
      section("assessment", "能力評量", applicability.from111, assessmentRules, { appliesFrom: "2022-08-01" }),
      section("geriatrics", "急診高齡醫學", applicability.from115, geriatricRules, { appliesFrom: "2026-08-01" }),
    ],
  },
];

export type BoardResourceCourse = {
  id: string;
  title: string;
  organizer: string;
  date: string;
  credits: number | null;
  sponsorType: string;
  registrationStatus: string;
  url: string;
  source: string;
};

export type BoardResourceAnnouncement = {
  id: string;
  title: string;
  date: string;
  url: string;
};

export type BoardResourceFeed = {
  status: string;
  updatedAt: string;
  courses: BoardResourceCourse[];
  announcements: BoardResourceAnnouncement[];
  sourceFailures?: string[];
  recognitionNotice?: string;
};

export type BoardPrepRadarSource = {
  id: string;
  label: string;
  description: string;
  url: string;
  lastCheckedAt: string;
};

/**
 * Replaceable fallback for the course radar. It deliberately contains source
 * entrances rather than inferred course recognition. Live events are supplied
 * by /api/board-resources and must still be verified on their official page.
 */
export const BOARD_PREP_RADAR_SOURCES: BoardPrepRadarSource[] = [
  {
    id: "sem-activities",
    label: "學會主辦積分活動",
    description: "瀏覽台灣急診醫學會主辦的近期活動與報名資訊。",
    url: "https://www.sem.org.tw/Activity/A/Index",
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
  {
    id: "sem-rules",
    label: "訓練醫院相關規定",
    description: "查閱最新住院醫師必修課程表、訓練年限表與學習護照。",
    url: BOARD_PREP_RULES_PAGE_URL,
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
  {
    id: "sem-non-hosted-activities",
    label: "非學會主辦積分活動",
    description: "瀏覽其他單位辦理的急診教育積分活動。",
    url: "https://www.sem.org.tw/Activity/B/Index",
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
  {
    id: "sem-aha-activities",
    label: "AHA 急救教育訓練",
    description: "瀏覽學會彙整的 AHA 急救教育課程。",
    url: "https://www.sem.org.tw/Activity/AHA/Index",
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
  {
    id: "sem-forms",
    label: "各類表單與災難課程認證清單",
    description: "取得學習護照申請表、異動表，以及住院醫師災難醫學訓練課程時數認證清單。",
    url: "https://www.sem.org.tw/Doc/%E5%90%84%E9%A1%9E%E8%A1%A8%E5%96%AE",
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
  {
    id: "sem-online-learning",
    label: "學會線上教育平台入口",
    description: "由學會頁面進入住院醫師訓練、超音波、期中評量與高齡急診等線上課程專區。",
    url: "https://www.sem.org.tw/Content/%E7%B7%9A%E4%B8%8A%E6%95%99%E8%82%B2%E5%B9%B3%E5%8F%B0",
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
  {
    id: "sem-exam-news",
    label: "專科甄審公告",
    description: "查看簡章、筆試、口試與合格名單等官方公告。",
    url: "https://www.sem.org.tw/News/7/Index",
    lastCheckedAt: BOARD_PREP_RULES_LAST_VERIFIED,
  },
];
