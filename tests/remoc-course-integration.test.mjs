import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryForRegionalCourseTitle,
  integrateRegionalCourseListings,
  regionalCourseListingMatchesCourse,
  regionalCourseListingToPendingCourse,
} from "../app/lib/remoc-course-integration.ts";

const recognized = {
  id: "recognized-central-0831",
  title: "115 年度化學物質緊急事件醫療應變訓練通識課程",
  dateLabel: "115/8/31",
  startDate: "2026-08-31",
  endDate: "2026-08-31",
  location: "中山醫學大學誠愛樓臨床技能中心",
  regions: ["central"],
  recognitions: [{ kind: "hazmat", label: "毒化災課程", hoursText: "6 小時", checklistItemId: "disaster.hazmat-6h" }],
  sourceUrl: "https://www.sem.org.tw/Doc/example.xlsx",
  recognitionStatus: "recognized",
};

const listing = {
  id: "central-post-787",
  title: "115年度化學物質緊急事件醫療應變訓練通識課程",
  region: "central",
  startDate: "2026-08-31",
  endDate: "2026-08-31",
  dateLabel: "115/08/31",
  location: "中山醫學大學誠愛樓10樓臨床技能中心",
  registrationLabel: "報名中",
  status: "open",
  sourceName: "中區 REMOC",
  sourceUrl: "https://eoc.vghtc.gov.tw/Default.aspx",
  detailUrl: "https://eoc.vghtc.gov.tw/PostDetail.aspx?PK=787&Type=C",
  recognitionStatus: "pending",
};

test("course titles map to the requested disaster filters", () => {
  assert.equal(categoryForRegionalCourseTitle("化學物質緊急事件醫療應變訓練"), "hazmat");
  assert.equal(categoryForRegionalCourseTitle("輻傷事件緊急醫療應變人員訓練"), "nuclear");
  assert.equal(categoryForRegionalCourseTitle("DMAT 聯合演練"), "other");
});

test("a regional listing enriches the recognized row instead of duplicating it", () => {
  assert.equal(regionalCourseListingMatchesCourse(listing, recognized), true);
  const courses = integrateRegionalCourseListings([recognized], [], [listing]);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].recognitionStatus, "recognized");
  assert.equal(courses[0].listing.status, "open");
  assert.match(courses[0].listing.detailUrl, /PostDetail/u);
});

test("unmatched official listings stay pending and cannot contribute hours", () => {
  const pending = regionalCourseListingToPendingCourse({
    ...listing,
    id: "north-radiation",
    title: "輻傷事件緊急醫療應變人員教育訓練模組實體訓練課程",
    region: "north",
    startDate: "2026-10-28",
    endDate: "2026-10-28",
    dateLabel: "115/10/28",
    location: "林口長庚紀念醫院",
  });
  assert.equal(pending.recognitionStatus, "pending");
  assert.equal(pending.recognitions[0].kind, "nuclear");
  assert.equal(pending.recognitions[0].hoursText, "尚待認列");
});

test("same title on a different date does not attach an unrelated registration", () => {
  assert.equal(regionalCourseListingMatchesCourse({ ...listing, startDate: "2026-09-01", endDate: "2026-09-01" }, recognized), false);
});
