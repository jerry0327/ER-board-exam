import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateBoardPrepAttachment, BOARD_PREP_ATTACHMENT_MAX_BYTES } from "../app/lib/board-prep-attachments.ts";
import {
  BOARD_PREP_LATEST_PUBLISHED_QUOTA_YEAR,
  BOARD_PREP_MAX_QUOTA_YEAR,
  BOARD_PREP_MIN_QUOTA_YEAR,
  boardPrepQuotaYearCovered,
  boardPrepOccurrenceEntries,
  boardPrepProgressSummary,
  boardPrepRuleProgress,
  buildBoardPrepCsvExport,
  buildBoardPrepJsonExport,
  defaultBoardPrepState,
  getApplicableBoardPrepSections,
  getBoardPrepCohort,
  inferBoardPrepQuotaYear,
  normalizeBoardPrepState,
  quotaYearTrainingStart,
  updateBoardPrepItem,
  updateBoardPrepOccurrence,
} from "../app/lib/board-prep.ts";
import { BOARD_PREP_COHORTS, BOARD_PREP_RULES_FILE_URL } from "../app/lib/board-prep-data.ts";

function hasBlobField(value) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, "blob")) return true;
  return Object.values(value).some(hasBlobField);
}

test("covers every official quota cohort from 107 through 115", () => {
  assert.deepEqual(BOARD_PREP_COHORTS.map((cohort) => cohort.id), ["107", "108-109", "110", "111", "112-115"]);
  for (let year = 107; year <= 115; year += 1) assert.ok(getBoardPrepCohort(year).quotaYears.includes(year));
  for (const cohort of BOARD_PREP_COHORTS) {
    for (const section of cohort.sections) {
      assert.ok(section.applicability.length > 10);
      for (const item of section.items) {
        assert.ok(item.applicability.length > 10, `${cohort.id}:${item.id} needs applicability`);
        assert.equal(item.sourceUrl, BOARD_PREP_RULES_FILE_URL);
        assert.match(item.sourceUrl, /^https:\/\/(?:www\.sem\.org\.tw|tsem\.blob\.core\.windows\.net)\//u);
      }
    }
  }
});

test("infers the ROC quota year at the August training boundary", () => {
  assert.equal(inferBoardPrepQuotaYear("2022-07-31"), 110);
  assert.equal(inferBoardPrepQuotaYear("2022-08-01"), 111);
  assert.equal(inferBoardPrepQuotaYear("2026-07-31"), 114);
  assert.equal(inferBoardPrepQuotaYear("2026-08-01"), 115);
});

test("keeps future quota years selectable without changing the published 107–115 cohorts", () => {
  const future = normalizeBoardPrepState({
    ...defaultBoardPrepState(new Date("2027-08-01T00:00:00.000Z")),
    selectionMode: "quota-year",
    quotaYear: 116,
  });
  assert.equal(future.quotaYear, 116);
  assert.equal(quotaYearTrainingStart(116), "2027-08-01");
  assert.equal(boardPrepQuotaYearCovered(116), true);
  assert.equal(boardPrepQuotaYearCovered(BOARD_PREP_MAX_QUOTA_YEAR + 1), false);

  const futureCohort = getBoardPrepCohort(116);
  assert.deepEqual(futureCohort.quotaYears, [116]);
  assert.match(futureCohort.label, new RegExp(`116 年度容額（參照 ${BOARD_PREP_LATEST_PUBLISHED_QUOTA_YEAR} 年課程表）`, "u"));
  assert.equal(getBoardPrepCohort(115), BOARD_PREP_COHORTS.at(-1));
  assert.equal(BOARD_PREP_MIN_QUOTA_YEAR, 107);
  assert.ok(BOARD_PREP_MAX_QUOTA_YEAR > BOARD_PREP_LATEST_PUBLISHED_QUOTA_YEAR);
});

test("applies TTAS, midterm assessment, modern disaster rules, and nine geriatric courses on their official dates", () => {
  const cohort111 = getApplicableBoardPrepSections({ quotaYear: 111, trainingStartDate: "2022-08-01" });
  assert.ok(cohort111.some((section) => section.id === "triage" && section.items.some((item) => item.id === "triage.ttas")));
  assert.ok(cohort111.some((section) => section.id === "assessment" && section.items.some((item) => item.id === "assessment.midterm")));

  const cohort112 = getApplicableBoardPrepSections({ quotaYear: 112, trainingStartDate: "2023-08-01" });
  const disaster = cohort112.find((section) => section.id === "disaster");
  assert.deepEqual(disaster?.items.map((item) => item.id), [
    "disaster.intro",
    "disaster.hazmat-6h",
    "disaster.nuclear-6h",
    "disaster.other-6h",
    "disaster.joint-discussion-3",
    "disaster.drills-3",
  ]);

  const cohort114 = getApplicableBoardPrepSections({ quotaYear: 114, trainingStartDate: "2025-08-01" });
  assert.equal(cohort114.some((section) => section.id === "geriatrics"), false);
  const cohort115 = getApplicableBoardPrepSections({ quotaYear: 115, trainingStartDate: "2026-08-01" });
  assert.equal(cohort115.find((section) => section.id === "geriatrics")?.items.length, 9);
  assert.equal(cohort115.flatMap((section) => section.items).find((item) => item.id === "ems.course")?.title, "住院醫師緊急醫療系統訓練課程（16 小時）");
});

test("normalizes account-scoped checklist state and computes completion", () => {
  const initial = normalizeBoardPrepState({
    ...defaultBoardPrepState(new Date("2026-08-01T00:00:00.000Z")),
    selectionMode: "training-start",
    trainingStartDate: "2023-08-01",
    quotaYear: 107,
  });
  assert.equal(initial.quotaYear, 112);
  const next = updateBoardPrepItem(initial, "ultrasound.basic", {
    completed: true,
    completedAt: "2024-01-02",
    certificateNumber: "CERT-1",
    note: "紙本護照第 12 頁",
  }, new Date("2024-01-02T00:00:00.000Z"));
  const summary = boardPrepProgressSummary(next);
  assert.equal(summary.completed, 1);
  assert.equal(summary.total > summary.completed, true);
  assert.equal(next.items["ultrasound.basic"].certificateNumber, "CERT-1");
  assert.equal(next.items["ultrasound.basic"].note, "紙本護照第 12 頁");
  assert.deepEqual(next.items["ultrasound.basic"].occurrences, {});
});

test("migrates the former combined certificate note into the note field", () => {
  const state = normalizeBoardPrepState({
    ...defaultBoardPrepState(),
    items: {
      "ultrasound.basic": {
        completed: true,
        completedAt: "2024-01-02",
        certificateNote: "舊版證明註記",
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
    },
  });
  assert.equal(state.items["ultrasound.basic"].certificateNumber, "");
  assert.equal(state.items["ultrasound.basic"].note, "舊版證明註記");
  assert.equal("certificateNote" in state.items["ultrasound.basic"], false);
});

test("records each required discussion and drill as an independent occurrence", () => {
  for (const year of [108, 110, 111, 112, 115]) {
    const sections = getApplicableBoardPrepSections({ quotaYear: year, trainingStartDate: `${year + 1911}-08-01` });
    const drill = sections.flatMap((section) => section.items).find((item) => item.id === "disaster.drills-3");
    assert.ok(drill, `${year} should include disaster drills`);
    assert.deepEqual(boardPrepOccurrenceEntries(drill).map((entry) => entry.label), [
      "災難醫療隊／大量傷患",
      "醫院緊急應變",
      "特殊災害",
    ]);
  }

  const sections = getApplicableBoardPrepSections({ quotaYear: 112, trainingStartDate: "2023-08-01" });
  const discussion = sections.flatMap((section) => section.items).find((item) => item.id === "disaster.joint-discussion-3");
  assert.ok(discussion);
  assert.deepEqual(boardPrepOccurrenceEntries(discussion).map((entry) => entry.label), ["第 1 次", "第 2 次", "第 3 次"]);

  let state = normalizeBoardPrepState({ ...defaultBoardPrepState(), selectionMode: "quota-year", quotaYear: 112 });
  state = updateBoardPrepOccurrence(state, "disaster.drills-3", "1", {
    completed: true,
    completedAt: "2024-01-01",
    certificateNumber: "DRILL-001",
    note: "大量傷患演習",
  });
  assert.deepEqual(boardPrepRuleProgress(discussion, state.items["disaster.joint-discussion-3"]), { completed: 0, total: 3 });
  const drill = sections.flatMap((section) => section.items).find((item) => item.id === "disaster.drills-3");
  assert.ok(drill);
  assert.deepEqual(boardPrepRuleProgress(drill, state.items["disaster.drills-3"]), { completed: 1, total: 3 });
  assert.equal(state.items["disaster.drills-3"].completed, false);
  assert.equal(state.items["disaster.drills-3"].occurrences["1"].certificateNumber, "DRILL-001");
  assert.equal(state.items["disaster.drills-3"].occurrences["1"].note, "大量傷患演習");
  state = updateBoardPrepOccurrence(state, "disaster.drills-3", "2", { completed: true, completedAt: "2024-02-01" });
  state = updateBoardPrepOccurrence(state, "disaster.drills-3", "3", { completed: true, completedAt: "2024-03-01" });
  assert.deepEqual(boardPrepRuleProgress(drill, state.items["disaster.drills-3"]), { completed: 3, total: 3 });
  assert.equal(state.items["disaster.drills-3"].completed, true);
  assert.equal(state.items["disaster.drills-3"].completedAt, "2024-03-01");
});

test("migrates a completed legacy three-event item without losing its record", () => {
  const state = normalizeBoardPrepState({
    ...defaultBoardPrepState(),
    quotaYear: 112,
    items: {
      "disaster.drills-3": {
        completed: true,
        completedAt: "2024-06-30",
        certificateNote: "原有演習紀錄",
        updatedAt: "2024-06-30T00:00:00.000Z",
      },
    },
  });
  assert.equal(Object.keys(state.items["disaster.drills-3"].occurrences).length, 3);
  assert.ok(Object.values(state.items["disaster.drills-3"].occurrences).every((entry) => entry.completed));
  assert.ok(Object.values(state.items["disaster.drills-3"].occurrences).every((entry) => entry.note === "原有演習紀錄"));
  assert.ok(Object.values(state.items["disaster.drills-3"].occurrences).every((entry) => entry.certificateNumber === ""));
});

test("keeps paper-passport case totals aggregated and separates modern disaster courses", () => {
  for (let year = 107; year <= 115; year += 1) {
    const sections = getApplicableBoardPrepSections({ quotaYear: year, trainingStartDate: `${year + 1911}-08-01` });
    const items = sections.flatMap((section) => section.items);
    const passportItems = items.filter((item) => item.tracking?.kind === "passport");
    assert.deepEqual(passportItems.map((item) => item.id).sort(), ["toxicology.cases-12", "ultrasound.cases"]);
    assert.ok(passportItems.every((item) => boardPrepOccurrenceEntries(item).length === 0));
  }

  const modernSections = getApplicableBoardPrepSections({ quotaYear: 112, trainingStartDate: "2023-08-01" });
  const modernItems = modernSections.flatMap((section) => section.items);
  assert.ok(modernItems.some((item) => item.id === "disaster.hazmat-6h"));
  assert.ok(modernItems.some((item) => item.id === "disaster.nuclear-6h"));
  let modernState = normalizeBoardPrepState({ ...defaultBoardPrepState(), quotaYear: 112 });
  modernState = updateBoardPrepItem(modernState, "disaster.hazmat-6h", { completed: true });
  assert.equal(modernState.items["disaster.hazmat-6h"].completed, true);
  assert.equal(modernState.items["disaster.nuclear-6h"], undefined);

  const legacyItems = getApplicableBoardPrepSections({ quotaYear: 111, trainingStartDate: "2022-08-01" }).flatMap((section) => section.items);
  assert.ok(legacyItems.some((item) => item.id === "disaster.special-24h"));
  assert.equal(legacyItems.some((item) => item.id === "disaster.hazmat-6h" || item.id === "disaster.nuclear-6h"), false);
});

test("keeps pure exports spreadsheet-safe and free of attachment blobs", () => {
  let state = normalizeBoardPrepState({ ...defaultBoardPrepState(), selectionMode: "quota-year", quotaYear: 115 });
  state = updateBoardPrepItem(state, "ultrasound.basic", {
    completed: true,
    completedAt: "2026-09-01",
    certificateNumber: "CERT-115",
    note: "=HYPERLINK(\"bad\")",
  });
  const attachments = [{ id: "a1", itemId: "ultrasound.basic", name: "+certificate.pdf", type: "application/pdf", size: 100, createdAt: "2026-09-01T00:00:00.000Z" }];
  const json = buildBoardPrepJsonExport(state, attachments, "2026-09-02T00:00:00.000Z");
  assert.equal(json.selection.quotaYear, 115);
  const exportedItem = json.sections.flatMap((section) => section.items).find((item) => item.id === "ultrasound.basic");
  assert.equal(exportedItem?.certificateNumber, "CERT-115");
  assert.equal(exportedItem?.note, "=HYPERLINK(\"bad\")");
  assert.equal(exportedItem?.attachments[0].name, "+certificate.pdf");
  assert.equal(hasBlobField(json), false);
  assert.deepEqual(Object.keys(exportedItem.attachments[0]).sort(), ["createdAt", "id", "name", "size", "type"]);

  const csv = buildBoardPrepCsvExport(state, attachments);
  assert.match(csv, /'=HYPERLINK/u);
  assert.match(csv, /'\+certificate\.pdf/u);
  assert.match(csv, /官方來源/u);
});

test("certificate validation only allows bounded PDF, JPG, and PNG files", () => {
  assert.doesNotThrow(() => validateBoardPrepAttachment({ name: "proof.pdf", type: "application/pdf", size: 1024 }));
  assert.doesNotThrow(() => validateBoardPrepAttachment({ name: "proof.JPG", type: "image/jpeg", size: 1024 }));
  assert.throws(() => validateBoardPrepAttachment({ name: "proof.svg", type: "image/svg+xml", size: 1024 }), /PDF、JPG 或 PNG/u);
  assert.throws(() => validateBoardPrepAttachment({ name: "proof.png", type: "image/png", size: BOARD_PREP_ATTACHMENT_MAX_BYTES + 1 }), /10 MB/u);
});

test("board prep is controlled by the canonical deep route and keeps recent courses in two levels", async () => {
  const [view, app, route, instrument] = await Promise.all([
    readFile(new URL("../app/views/board-prep-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /export type PrepRouteId =[\s\S]*?"checklist"[\s\S]*?"recognized"[\s\S]*?"upcoming\/society"[\s\S]*?"upcoming\/remoc\/north"[\s\S]*?"upcoming\/remoc\/central"[\s\S]*?"upcoming\/remoc\/south"[\s\S]*?"exam"/u);
  assert.match(route, /export function normalizePrepRouteId/u);
  assert.match(route, /export function prepHash\(route: PrepRouteId\)/u);
  assert.match(route, /return `#prep\/\$\{route\}`/u);

  assert.match(view, /routeId: string \| null;/u);
  assert.match(view, /onRouteChange: \(route: PrepRouteId\) => void;/u);
  assert.match(view, /import \{ taiwanDateKey \} from "\.\.\/lib\/taiwan-date"/u);
  assert.match(view, /export default function BoardPrepView\(\{ accountKey, routeId, onRouteChange \}: Props\)/u);
  assert.match(view, /const normalizedRoute = normalizePrepRouteId\(routeId\)/u);
  assert.match(view, /const activeTab: TabId = normalizedRoute\.startsWith\("upcoming\/"\)/u);
  assert.match(view, /const activeUpcomingTab: UpcomingTabId = normalizedRoute\.startsWith\("upcoming\/remoc\/"\)/u);
  assert.match(view, /const remocRegion: RemocRegion = normalizedRoute\.startsWith\("upcoming\/remoc\/"\)/u);
  assert.doesNotMatch(view, /useState<TabId>|setActiveTab\b|useState<UpcomingTabId>|setActiveUpcomingTab\b|setRemocRegion\b/u);
  assert.match(view, /onRouteChange\(route\)/u);
  assert.match(view, /onRouteChange\("upcoming\/society"\)/u);
  assert.match(view, /onRouteChange\(`upcoming\/remoc\/\$\{region\}`\)/u);

  assert.match(app, /const openPrepRoute = useCallback\(\(route: PrepRouteId\) =>/u);
  assert.match(app, /window\.history\.pushState\(null, "", prepHash\(route\)\)/u);
  assert.match(app, /<BoardPrepView accountKey=\{progress\.accountKey\} routeId=\{normalizePrepRouteId\(requestedQuestionId\)\} onRouteChange=\{openPrepRoute\} \/>/u);

  const upcoming = view.slice(view.indexOf('id="prep-panel-upcoming"'), view.indexOf('id="prep-panel-exam"'));
  assert.match(upcoming, /role="tablist" aria-label="近期開課類別"/u);
  assert.match(upcoming, /id="board-prep-upcoming-society-tab"/u);
  assert.match(upcoming, /id="board-prep-upcoming-remoc-tab"/u);
  assert.match(upcoming, /activeUpcomingTab === "remoc" && <label className="board-prep-region-picker">課程地區/u);
  assert.match(upcoming, /<select className="field-control" aria-label="選擇 REMOC 課程地區" value=\{remocRegion\}/u);
  assert.match(upcoming, /REMOC_REGION_OPTIONS\.map\(\(option\) => <option/u);
  assert.doesNotMatch(upcoming, /board-prep-upcoming-remoc-\$\{option\.id\}-tab|data-stage=\{activeUpcomingTab/u);

  assert.match(
    instrument,
    /\.site-shell \[hidden\]:not\(\[hidden="until-found"\]\)\s*\{\s*display:\s*none;\s*\}/u,
  );
});

test("view keeps evidence collapsed after completion and uses the account-backed evidence API", async () => {
  const [view, recognized, hook, attachments, evidenceRoute, css, recognizedCss, siteCss] = await Promise.all([
    readFile(new URL("../app/views/board-prep-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/recognized-courses-area.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-board-prep.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/board-prep-attachments.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/board-prep-evidence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/board-prep.css", import.meta.url), "utf8"),
    readFile(new URL("../app/recognized-courses.css", import.meta.url), "utf8"),
    readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  ]);
  assert.match(view, /fetch\("\/api\/board-resources"/u);
  assert.match(recognized, /import \{ taiwanDateKey \} from "\.\.\/lib\/taiwan-date"/u);
  assert.match(view, /boardPrepOccurrenceEntries/u);
  assert.match(view, /boardPrep\.updateOccurrence/u);
  assert.match(view, /board-prep-passport-confirmation/u);
  assert.match(view, /passportTracking\.completionLabel/u);
  assert.match(view, /BOARD_PREP_RADAR_SOURCES/u);
  assert.match(view, /board-prep-workspace-tabs/u);
  assert.match(view, /board-prep-checklist-tab/u);
  assert.match(view, /board-prep-recognized-tab/u);
  assert.match(view, /board-prep-upcoming-tab/u);
  assert.match(view, /board-prep-exam-tab/u);
  for (const tabLabel of ["我的資格", "找近期課程", "核對認列", "甄審文件"]) assert.match(view, new RegExp(tabLabel, "u"));
  assert.match(view, /RecognizedCoursesArea/u);
  assert.match(view, /BoardPrepRemoc/u);
  assert.match(view, /<header className="page-intro compact-intro board-prep-intro">[\s\S]*?<section className="board-prep-controls" aria-label="適用規則">[\s\S]*?className="board-prep-progress"[\s\S]*?<\/header>/u);
  assert.doesNotMatch(view, /className="page-intro compact-intro board-prep-intro paper-card"/u, "the page title must use the shared unboxed inner-page language");
  assert.doesNotMatch(view, /className="board-prep-(?:controls|progress) paper-card"/u, "quota controls and progress remain one compact intro hierarchy");
  const checklistPanel = view.slice(view.indexOf('id="prep-panel-checklist"'), view.indexOf('id="prep-panel-recognized"'));
  const upcomingPanel = view.slice(view.indexOf('id="prep-panel-upcoming"'), view.indexOf('id="prep-panel-exam"'));
  const examPanel = view.slice(view.indexOf('id="prep-panel-exam"'));
  assert.doesNotMatch(checklistPanel, /resourceFeed\?\.courses|課程雷達|近期官方活動/u);
  assert.match(upcomingPanel, /SocietyCourseSection/u);
  assert.match(upcomingPanel, /BoardPrepRemoc/u);
  assert.match(upcomingPanel, /board-prep-upcoming-selector reading-variant-selector/u);
  assert.match(upcomingPanel, /reading-variant-selector__stage reading-variant-selector__stage--types/u);
  assert.match(upcomingPanel, /reading-variant-selector__option/u);
  assert.match(upcomingPanel, /role="tablist" aria-label="近期開課類別"/u);
  assert.match(upcomingPanel, /board-prep-region-picker/u);
  assert.match(upcomingPanel, /aria-label="選擇 REMOC 課程地區"/u);
  assert.match(upcomingPanel, /REMOC_REGION_OPTIONS\.map\(\(option\) => <option/u);
  assert.doesNotMatch(upcomingPanel, /board-prep-upcoming-remoc-\$\{option\.id\}-tab|data-stage=\{activeUpcomingTab/u);
  assert.match(view, /學會課程/u);
  assert.match(view, /REMOC 課程/u);
  assert.match(upcomingPanel, /hidden=\{activeUpcomingTab !== "society"\}/u);
  assert.match(upcomingPanel, /hidden=\{activeUpcomingTab !== "remoc"\}/u);
  assert.match(view, /近期課程與積分活動/u);
  assert.doesNotMatch(examPanel, /Tintinalli|Rosen|Goldfrank|AILS|常用複習教材/u);
  assert.match(examPanel, /急診醫學科專科醫師訓練課程基準/u);
  assert.match(examPanel, /甄審原則/u);
  assert.match(view, /resolveCurrentExamResources\(resourceFeed\?\.announcements \?\? \[\]\)/u);
  assert.match(examPanel, /currentExamResources\.notice\?\.label/u);
  assert.match(examPanel, /currentExamResources\.oralProcedure\?\.label/u);
  assert.match(examPanel, /currentExamResources\.writtenExam\?\.label/u);
  assert.doesNotMatch(view, /CURRENT_EXAM_NOTICE_URL|CURRENT_ORAL_EXAM_URL/u);
  assert.match(view, /type BoardResourceDisplay = \{[\s\S]*?updatedAt: string;[\s\S]*?courses: BoardResourceCourse\[\];[\s\S]*?announcements: BoardResourceAnnouncement\[\];[\s\S]*?news: BoardResourceNews\[\];[\s\S]*?\};/u);
  assert.match(view, /資料更新：\{formatRocDateFromIso\(feed\.updatedAt\.slice\(0, 10\)\)\}/u);
  assert.match(view, /const OFFICIAL_NEWS_URL = "https:\/\/www\.sem\.org\.tw\/News"/u);
  assert.match(view, /const latestSocietyNews = useMemo/u);
  assert.match(examPanel, /className="official-news-panel paper-card"/u);
  assert.match(examPanel, /學會最新消息/u);
  assert.match(examPanel, /resourceFeed\.announcements\.slice\(0, 6\)/u);
  assert.match(examPanel, /latestSocietyNews\.map/u);
  assert.match(view, /BOARD_PREP_MAX_QUOTA_YEAR - BOARD_PREP_MIN_QUOTA_YEAR \+ 1/u);
  assert.match(view, /max=\{`\$\{BOARD_PREP_MAX_QUOTA_YEAR \+ 1912\}-07-31`\}/u);
  assert.doesNotMatch(view, /Array\.from\(\{ length: 9 \}|max="2027-07-31"/u);

  const oralDetails = /<details className="current-oral-details"([^>]*)>/u.exec(examPanel);
  assert.ok(oralDetails, "official oral workflow should be available in a disclosure");
  assert.doesNotMatch(oralDetails[0], /\sopen(?:\s|=|>)/u, "oral workflow should be collapsed by default");
  assert.match(examPanel, /<p>\{currentExamYearLabel\}甄審<\/p><h3[^>]*>當年度公告與歷年公開範例<\/h3>/u);
  assert.match(examPanel, /歷年公開範例・115 年公告題型/u);
  assert.match(examPanel, /115 年口試流程與官方公開例題/u);
  assert.doesNotMatch(examPanel, /\{currentExamYearLabel\}口試資訊/u, "115 年 reference material must not appear under a future-year current heading");
  assert.match(examPanel, /checklist-evidence-closed-label[^>]*>展開</u);
  assert.match(examPanel, /checklist-evidence-open-label[^>]*>收闔</u);
  assert.match(examPanel, /隨 115 公告附上的官方公開例題/u);
  assert.match(examPanel, /目前公開資料未包含其餘評分頁、完整答案與後續配分/u);
  assert.doesNotMatch(examPanel, /115 年實際口試題/u);
  for (const linkLabel of ["115 年口試程序公告", "口試流程及注意事項", "個別面試例題（考生版）", "個別面試例題（評分表）", "115 年口試時程表"]) {
    assert.ok(view.includes(linkLabel), `missing official oral-exam source: ${linkLabel}`);
  }
  assert.match(recognizedCss, /\.current-oral-details\s*>\s*summary\s*\{[^}]*justify-content:\s*space-between;[^}]*min-height:\s*54px;/su);
  assert.match(recognizedCss, /\.current-oral-details-body\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su);
  assert.match(recognizedCss, /\.official-news-panel\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su);
  assert.match(recognizedCss, /@media \(max-width: 720px\)[\s\S]*?\.official-news-panel\s*\{[^}]*grid-template-columns:\s*1fr;/su);
  assert.match(siteCss, /\.official-news-panel header\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) max-content;/su);
  assert.match(siteCss, /\.official-news-panel header \.quiet-button\s*\{[^}]*max-width:\s*100%;[^}]*width:\s*auto;/su);

  const checklistDetails = [...view.matchAll(/<details\b[^>]*className=["'][^"']*checklist-evidence[^"']*["'][^>]*>/gu)].map(([tag]) => tag);
  const recognizedDetails = [...recognized.matchAll(/<details\b[^>]*className=["'][^"']*recognized-evidence[^"']*["'][^>]*>/gu)].map(([tag]) => tag);
  assert.ok(checklistDetails.length > 0, "checklist should render an evidence disclosure");
  assert.ok(recognizedDetails.length > 0, "recognized courses should render an evidence disclosure");
  for (const tag of [...checklistDetails, ...recognizedDetails]) assert.doesNotMatch(tag, /\sopen(?:\s|=|>)/u);
  assert.match(view, /checklist-evidence-toggle/u);
  assert.match(view, /checklist-evidence-closed-label[^>]*>展開</u);
  assert.match(view, /checklist-evidence-open-label[^>]*>收闔</u);
  assert.match(recognizedCss, /\.checklist-evidence-toggle\s*\{[^}]*margin-left:\s*auto;/su);
  assert.match(view, /itemState\?\.completed\s*&&\s*<ChecklistEvidence\b/u);
  assert.match(view, /occurrence\.completed\s*&&\s*<ChecklistEvidence\b/u);
  assert.match(recognized, /completion\s*&&[\s\S]{0,240}<tr[^>]*recognized-detail-row[\s\S]{0,240}<details\b[^>]*recognized-evidence/u);
  assert.match(recognized, /data-recognition=\{badge\.key\}/u);
  for (const badgeType of ["intro", "hazmat", "nuclear", "other", "exercise-dmat", "exercise-hospital", "exercise-special"]) {
    assert.match(siteCss, new RegExp(`data-recognition="${badgeType}"`, "u"));
  }

  const visibleCopy = `${view}\n${recognized}`;
  assert.doesNotMatch(visibleCopy, /官方來源已更新（每 6 小時自動更新）|列出不等於訓練認定|回傳要資料確認|不會上傳到伺服器|離線存取|開發者/u);
  assert.doesNotMatch(visibleCopy, /buildBoardPrepJsonExport|buildBoardPrepCsvExport|>\s*JSON\s*<|>\s*CSV\s*</u);

  assert.match(hook, /updateBoardPrepOccurrence/u);
  assert.match(attachments, /fetch\("\/api\/board-prep-evidence"/u);
  assert.doesNotMatch(attachments, /indexedDB/u);
  assert.match(evidenceRoute, /boardPrepEvidence/u);
  assert.match(evidenceRoute, /getEvidenceBucket/u);
  assert.match(evidenceRoute, /bucket\.put/u);
  assert.match(evidenceRoute, /bucket\.delete/u);
  assert.match(evidenceRoute, /crypto\.subtle\.digest/u);
  assert.match(evidenceRoute, /Object\.values\([^)]*occurrences/u);
  assert.match(css, /\.board-prep-page/u);
  assert.match(css, /\.board-prep-workspace-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,/su);
  assert.match(css, /\.board-prep-upcoming-selector__options\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su);
  assert.match(css, /\.board-prep-page\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;/su);
  assert.match(css, /\.board-prep-intro\s*\{[^}]*grid-template-areas:\s*"copy progress"\s*"controls controls";/su);
  assert.match(css, /\.board-prep-intro\s*\{[^}]*padding:\s*0;/su);
  assert.match(css, /\.board-prep-intro\s*\{[^}]*--board-prep-intro-muted:\s*color-mix\(in srgb, var\(--muted\)[^}]*var\(--ink\)\);/su);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.board-prep-intro\s*\{[^}]*grid-template-areas:\s*"copy"\s*"controls"\s*"progress";/su);
  const laptopBreakpointCss = css.slice(css.indexOf("@media (max-width: 1120px)"), css.indexOf("@media (max-width: 920px)"));
  assert.doesNotMatch(laptopBreakpointCss, /\.board-prep-workspace-tabs\s*\{/u, "desktop navigation must stay on one row at common laptop widths");
  const tabletBreakpointCss = css.slice(css.indexOf("@media (max-width: 920px)"), css.indexOf("@media (max-width: 720px)"));
  assert.match(tabletBreakpointCss, /\.board-prep-workspace-tabs\s*\{[^}]*repeat\(2,/su);
  assert.match(css, /\.board-prep-upcoming\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;/su);
  assert.match(css, /\.remoc-hub\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;/su);
  assert.match(css, /\.remoc-summary-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/su);
  assert.match(css, /\.remoc-progress-grid\[data-count="2"\]\s*\{[^}]*repeat\(2,/su);
  assert.match(css, /\.remoc-progress-grid\[data-count="3"\]\s*\{[^}]*repeat\(3,/su);
  assert.match(css, /\.remoc-progress-grid\[data-count="5"\]\s*\{[^}]*repeat\(5,/su);
  assert.match(css, /@media \(max-width: 920px\)[\s\S]*?\.remoc-progress-grid\[data-count="5"\]\s*\{[^}]*repeat\(6,[\s\S]*?nth-last-child\(-n \+ 2\)\s*\{[^}]*grid-column:\s*span 3;/su);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.remoc-progress-grid\[data-count\]\s*\{[^}]*repeat\(2,/su);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.remoc-progress-grid\[data-count="5"\] > button:nth-last-child\(-n \+ 2\)\s*\{[^}]*grid-column:\s*auto;/su);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.remoc-progress-grid\[data-count\]\s*\{[^}]*grid-template-columns:\s*1fr;/su);
  const mobileUnifiedCss = siteCss.slice(siteCss.indexOf("@media (max-width: 600px)"));
  assert.match(mobileUnifiedCss, /\.board-prep-intro\s*\{[^}]*margin-bottom:\s*0;/su);
  assert.match(mobileUnifiedCss, /\.board-prep-workspace-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*overflow-x:\s*hidden;/su);
  assert.match(mobileUnifiedCss, /\.board-prep-workspace-tabs > button\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*min-width:\s*0;/su);
  assert.doesNotMatch(mobileUnifiedCss.match(/\.board-prep-workspace-tabs\s*\{[^}]*\}/su)?.[0] ?? "", /overflow-x:\s*auto/u);
  assert.doesNotMatch(recognizedCss, /\.board-prep-workspace-tabs/u, "tab layout must have a single CSS owner");
  assert.match(css, /\.board-prep-occurrence/u);
  assert.match(css, /\.board-prep-passport-confirmation/u);
  assert.doesNotMatch(css, /\.remoc-region-tabs/u);
  assert.match(recognized, /className="recognized-tools-panel paper-card"[\s\S]*?className="recognized-transfer-row"[\s\S]*?className="recognized-filters"/u);
  assert.doesNotMatch(recognized, /className="(?:recognized-transfer-row|recognized-filters) paper-card"/u);
  assert.match(recognizedCss, /\.recognized-filters\s*\{[^}]*border-top:\s*1px solid var\(--line\);/su);
  assert.match(recognizedCss, /\.checklist-evidence/u);
  assert.match(recognizedCss, /\.recognized-evidence/u);
  assert.doesNotMatch(css, /@import\s+["']\.\/globals\.css/u);
});
