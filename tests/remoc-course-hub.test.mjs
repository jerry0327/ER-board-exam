import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DISASTER_COURSE_RECOGNIZED_FALLBACK,
  REMOC_114_CENTRAL_SCHEDULE_URL,
  REMOC_115_PENDING_COURSES,
  REMOC_115_SCHEDULE_URL,
  REMOC_CATEGORY_OPTIONS,
  REMOC_REGION_OPTIONS,
  REMOC_STATIC_SCHEDULE_ROC_YEAR,
  disasterCourseCategories,
  disasterCourseTiming,
  formatRocDateFromIso,
  normalizeDisasterCoursePayload,
  pendingCourseHasRecognition,
  resolveDisasterChecklistTarget,
  rocYearFromIsoDate,
} from "../app/lib/remoc-course-data.ts";

test("bundled course fallback covers all regions and maps recognized hours to checklist items", () => {
  for (const region of ["north", "central", "south"]) {
    assert.ok(DISASTER_COURSE_RECOGNIZED_FALLBACK.some((course) => course.regions.includes(region)), `${region} needs a recognized fallback course`);
  }
  for (const course of DISASTER_COURSE_RECOGNIZED_FALLBACK) {
    assert.equal(course.recognitionStatus, "recognized");
    assert.match(course.sourceUrl, /^https:\/\/tsem\.blob\.core\.windows\.net\/docfilecontainer\//u);
    assert.ok(course.recognitions.length > 0);
    for (const recognition of course.recognitions) {
      assert.match(recognition.hoursText, /\d/u);
      assert.match(recognition.checklistItemId, /^disaster\.(?:hazmat-6h|nuclear-6h|other-6h|drills-3|intro)$/u);
    }
  }
  assert.ok(DISASTER_COURSE_RECOGNIZED_FALLBACK.some((course) => disasterCourseCategories(course).includes("hazmat")));
  assert.ok(DISASTER_COURSE_RECOGNIZED_FALLBACK.some((course) => disasterCourseCategories(course).includes("other")));
});

test("future REMOC announcements stay pending until a recognized row matches", () => {
  assert.ok(REMOC_115_PENDING_COURSES.length >= 2);
  for (const course of REMOC_115_PENDING_COURSES) {
    assert.equal(course.recognitionStatus, "pending");
    assert.equal(course.sourceUrl, REMOC_115_SCHEDULE_URL);
    assert.ok(course.recognitions.every((recognition) => recognition.hoursText === "尚待認列"));
    assert.equal(disasterCourseTiming(course, "2026-07-19"), "tentative");
    assert.equal(pendingCourseHasRecognition(course, DISASTER_COURSE_RECOGNIZED_FALLBACK), false);
  }

  const pending = REMOC_115_PENDING_COURSES[0];
  const recognizedMatch = {
    ...pending,
    id: "recognized-match",
    title: "林口長庚輻傷事件緊急醫療應變人員教育訓練",
    recognitionStatus: "recognized",
    dateCertainty: "confirmed",
    recognitions: [{ kind: "nuclear", label: "核災課程", hoursText: "6 小時", checklistItemId: "disaster.nuclear-6h" }],
  };
  assert.equal(pendingCourseHasRecognition(pending, [recognizedMatch]), true);
});

test("course timing distinguishes upcoming, ongoing, and completed dates", () => {
  const base = { startDate: "2026-07-20", endDate: "2026-07-22" };
  assert.equal(disasterCourseTiming(base, "2026-07-19"), "upcoming");
  assert.equal(disasterCourseTiming(base, "2026-07-21"), "ongoing");
  assert.equal(disasterCourseTiming(base, "2026-07-23"), "completed");
  const tentative = { ...base, dateCertainty: "tentative" };
  assert.equal(disasterCourseTiming(tentative, "2026-07-19"), "tentative");
  assert.equal(disasterCourseTiming(tentative, "2026-07-21"), "ongoing");
  assert.equal(disasterCourseTiming(tentative, "2026-07-23"), "completed");
});

test("course dates, not workbook update dates, control the displayed ROC year and legacy checklist destination", () => {
  assert.equal(rocYearFromIsoDate("2026-07-15"), REMOC_STATIC_SCHEDULE_ROC_YEAR);
  assert.equal(formatRocDateFromIso("2026-07-15"), "115/07/15");
  assert.equal(rocYearFromIsoDate("2027-01-10"), 116);
  assert.equal(rocYearFromIsoDate("invalid"), null);
  assert.equal(resolveDisasterChecklistTarget("disaster.intro", ["disaster.intro-16h"]), "disaster.intro-16h");
  assert.equal(resolveDisasterChecklistTarget("disaster.intro", ["disaster.basic-14h"]), "disaster.basic-14h");
  assert.equal(resolveDisasterChecklistTarget("disaster.hazmat-6h", ["disaster.special-24h"]), "disaster.special-24h");
  assert.equal(resolveDisasterChecklistTarget("disaster.nuclear-6h", ["disaster.nuclear-6h", "disaster.special-24h"]), "disaster.nuclear-6h");
});

test("live course payload accepts only bounded official data", () => {
  const valid = normalizeDisasterCoursePayload({
    status: "live",
    updatedAt: "2026-07-15",
    sourceUrl: "https://www.sem.org.tw/Doc/%E5%90%84%E9%A1%9E%E8%A1%A8%E5%96%AE",
    courses: [{
      id: "course-1",
      title: "化學災害教育訓練",
      dateLabel: "115/7/29",
      startDate: "2026-07-29",
      endDate: "2026-07-29",
      location: "新竹市",
      regions: ["north"],
      recognitions: [{ kind: "hazmat", label: "毒化災課程", hoursText: "6 小時", checklistItemId: "disaster.hazmat-6h" }],
      sourceUrl: "https://tsem.blob.core.windows.net/docfilecontainer/list.xlsx",
    }],
  });
  assert.equal(valid?.courses.length, 1);
  assert.equal(valid?.courses[0].recognitions[0].checklistItemId, "disaster.hazmat-6h");

  assert.equal(normalizeDisasterCoursePayload({
    status: "live",
    updatedAt: "2026-07-15",
    sourceUrl: "https://evil.example/list.xlsx",
    courses: [],
  }), null);
});

test("board prep keeps course family tabs and REMOC region selection as two controlled route levels", async () => {
  const [view, component, css, appRoute] = await Promise.all([
    readFile(new URL("../app/views/board-prep-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/board-prep-remoc.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/board-prep.css", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(view, /board-prep-checklist-tab/u);
  assert.match(view, /board-prep-upcoming-tab/u);
  assert.match(view, /<BoardPrepRemoc accountKey=\{accountKey\} quotaYear=\{boardPrep\.state\.quotaYear\} region=\{remocRegion\} onRegionCountsChange=\{setRemocRegionCounts\}/u);
  assert.match(view, /board-prep-item-\$\{itemId\}/u);
  assert.match(component, /fetch\(DISASTER_COURSES_ENDPOINT/u);
  assert.match(component, /fetch\(REMOC_COURSE_LISTINGS_ENDPOINT/u);
  assert.match(view, /className="board-prep-upcoming-selector reading-variant-selector"/u);
  assert.match(view, /id="board-prep-upcoming-society-tab"/u);
  assert.match(view, /id="board-prep-upcoming-remoc-tab"/u);
  assert.match(view, /onRouteChange\("upcoming\/society"\)/u);
  assert.match(view, /onRouteChange\(`upcoming\/remoc\/\$\{region\}`\)/u);
  assert.match(view, /activeUpcomingTab === "remoc" && <label className="board-prep-region-picker">課程地區/u);
  assert.match(view, /<select className="field-control" aria-label="選擇 REMOC 課程地區" value=\{remocRegion\}/u);
  assert.match(view, /REMOC_REGION_OPTIONS\.map\(\(option\) => <option/u);
  assert.doesNotMatch(view, /data-stage=\{activeUpcomingTab|id=\{`board-prep-upcoming-remoc-\$\{option\.id\}-tab`\}/u);
  assert.doesNotMatch(component, /role="tablist" aria-label="課程地區"|remoc-region-tabs/u);
  assert.match(appRoute, /"upcoming\/society"/u);
  for (const region of ["north", "central", "south"]) {
    assert.match(appRoute, new RegExp(`"upcoming/remoc/${region}"`, "u"));
  }
  assert.deepEqual(REMOC_REGION_OPTIONS.map((option) => option.label), ["北部", "中部", "南部"]);
  assert.deepEqual(REMOC_CATEGORY_OPTIONS.map((option) => option.label), ["全部課程", "毒化災", "核災", "HICS／DMAT／其他"]);
  assert.match(component, /已認列/u);
  assert.match(component, /尚待認列/u);
  assert.match(component, /搜尋課名、地點或認列內容/u);
  assert.match(component, /我的認列時數/u);
  assert.match(component, /可報名/u);
  assert.match(component, /更新完訓清單/u);
  assert.match(view, /applyRemocCourseProgress/u);
  assert.match(component, /onOpen=\{\(\) => onOpenChecklistItem\("disaster\.intro"\)\}/u);
  assert.match(component, /className="remoc-course-inline-actions"/u);
  assert.match(component, /報名與課程資訊/u);
  assert.doesNotMatch(component, /checklistActionLabels|查看其他課程進度|查看演習進度/u);
  assert.doesNotMatch(component, /updateItem|updateOccurrence|completed:\s*true/u);
  assert.match(component, /認證清單日期/u);
  assert.doesNotMatch(component, />115\/07\/15 時數認證清單</u);
  assert.doesNotMatch(component, /115 年度災難課程|>115 年課程行程|查看 115 年官方公告|學會 115 年 REMOC/u);
  assert.match(component, /latestRecognizedCourseRocYear\(recognizedCourses\)/u);
  assert.match(component, /rocYearFromIsoDate\(course\.startDate\)/u);
  assert.doesNotMatch(component, /rocYearFromIsoDate\(recognitionUpdatedAt\)/u);
  assert.match(component, /recognitionSourceStatus === "live"[\s\S]*?recognitionYearIsCurrent/u);
  assert.match(component, /DISASTER_COURSE_RECOGNITION_FORMS_URL/u);
  assert.match(component, /const announcedCourses = useMemo\(\(\) => useStaticSchedule/u);
  assert.doesNotMatch(component, /今年已辦課程/u);
  assert.match(component, /\{useStaticSchedule && <a href=\{REMOC_115_ANNOUNCEMENT_URL\}/u);
  assert.match(REMOC_114_CENTRAL_SCHEDULE_URL, /^https:\/\/tsem\.blob\.core\.windows\.net\/newscontainer\//u);
  assert.match(css, /\.board-prep-workspace-tabs/u);
  assert.match(css, /\.board-prep-upcoming-selector__options\s*\{[^}]*repeat\(2,/su);
  assert.doesNotMatch(css, /\.remoc-region-tabs/u);
  assert.match(component, /className="remoc-summary-panel paper-card"/u);
  assert.match(component, /className="remoc-progress-panel"/u);
  assert.doesNotMatch(component, /className="paper-card remoc-progress-panel"/u);
  assert.match(css, /\.remoc-course-grid/u);
  const remocCss = css.slice(css.indexOf(".remoc-hub"), css.indexOf("@media (max-width: 1120px)"));
  assert.doesNotMatch(remocCss, /font-size:\s*(?:[0-9]|10)px/u);
});

test("recognized-course completion opens as a viewport-centered modal above sticky actions", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/components/recognized-courses-area.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recognized-courses.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /completionDialogRef\.current/u);
  assert.match(component, /dialog\.showModal\(\)/u);
  assert.match(component, /onCancel=/u);
  assert.doesNotMatch(component, /<dialog open/u);
  assert.match(css, /\.recognized-dialog\s*\{[^}]*position:\s*fixed;/su);
  assert.match(css, /\.recognized-dialog::backdrop/u);
});
