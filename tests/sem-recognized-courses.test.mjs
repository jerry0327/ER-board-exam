import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import snapshot from "../app/data/sem-recognized-courses.snapshot.json" with { type: "json" };
import {
  groupRecognizedCourses,
  parseRecognizedHours,
  parseRocDateRange,
  recognizedCourseFromRow,
  recognizedCourseSummary,
} from "../app/lib/sem-recognized-courses.ts";
import {
  createSemRecognitionFeedLoader,
  discoverRecognitionWorkbookUrl,
  worksheetRows,
} from "../app/lib/sem-recognized-courses.server.ts";

const sourceUrl = "https://tsem.blob.core.windows.net/docfilecontainer/recognized.xlsx";

test("parses official hour cells without counting rejected recognition", () => {
  assert.equal(parseRecognizedHours("7/6 3.5小時\n7/7 2.5小時"), 6);
  assert.equal(parseRecognizedHours("毒物學課程不予認列"), 0);
  assert.equal(parseRecognizedHours("6"), 6);
  assert.equal(parseRecognizedHours("1.5天"), 0);
});

test("parses ROC ranges, malformed slashes, shortened end dates, and reschedules", () => {
  assert.deepEqual(parseRocDateRange("115/10/2-10/3"), { startDate: "2026-10-02", endDate: "2026-10-03" });
  assert.deepEqual(parseRocDateRange("115//05/15"), { startDate: "2026-05-15", endDate: "2026-05-15" });
  assert.deepEqual(parseRocDateRange("110/05/17 (改期110/08/30)"), { startDate: "2021-08-30", endDate: "2021-08-30" });
});

test("keeps all recognition categories and three exercise kinds on one course", () => {
  const course = recognizedCourseFromRow("115年", [
    "115/03/02-115/03/03", "台北", "大量傷病患事件現場救護站醫療官課程", "16小時", "1小時", "1小時", "4小時", "1天", "4小時", "桌上演練",
  ], sourceUrl, "1150715");
  assert.ok(course);
  assert.deepEqual(course.exerciseKinds.sort(), ["dmat", "hospital", "special"]);
  assert.equal(course.hours.intro, 16);
  assert.equal(course.hours.other, 4);
});

test("groups split recognition rows for the same course session", () => {
  const first = recognizedCourseFromRow("114年", ["114/02/12", "高雄", "同一門課", "", "3小時", "", "", "", "", ""], sourceUrl, "v1");
  const second = recognizedCourseFromRow("114年", ["114/02/12", "高雄", "同一門課", "", "", "", "3小時", "", "", ""], sourceUrl, "v1");
  const grouped = groupRecognizedCourses([first, second].filter(Boolean));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].hours.hazmat, 3);
  assert.equal(grouped[0].hours.other, 3);
});

test("keeps same-day sessions at different venues separate", () => {
  const first = recognizedCourseFromRow("114年", ["114/02/12", "高雄", "同一門課", "", "3小時", "", "", "", "", ""], sourceUrl, "v1");
  const second = recognizedCourseFromRow("114年", ["114/02/12", "台北", "同一門課", "", "3小時", "", "", "", "", ""], sourceUrl, "v1");
  assert.equal(groupRecognizedCourses([first, second].filter(Boolean)).length, 2);
});

test("does not add the same official row twice across worksheets", () => {
  const first = recognizedCourseFromRow("110年", ["110/12/31", "台北", "跨年度重複課程", "", "3小時", "", "", "", "", ""], sourceUrl, "v1");
  const duplicate = recognizedCourseFromRow("111年", ["110/12/31", "台北", "跨年度重複課程", "", "3小時", "", "", "", "", ""], sourceUrl, "v1");
  const grouped = groupRecognizedCourses([first, duplicate].filter(Boolean));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].hours.hazmat, 3);
});

test("does not double-count a rescheduled row repeated on its new date", () => {
  const rescheduled = recognizedCourseFromRow("111年", ["111/05/31（改期111/08/19）", "台北", "化災實作課程", "", "6小時", "", "", "", "", ""], sourceUrl, "v1");
  const finalListing = recognizedCourseFromRow("111年", ["111/08/19", "台北", "化災實作課程", "", "6小時", "", "", "", "", ""], sourceUrl, "v1");
  const grouped = groupRecognizedCourses([rescheduled, finalListing].filter(Boolean));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].hours.hazmat, 6);
});

test("excludes cancelled courses when the cancellation is written in the title", () => {
  assert.equal(recognizedCourseFromRow("111年", ["111/03/01", "台中", "化災課程（課程取消）", "", "6小時", "", "", "", "", ""], sourceUrl, "v1"), null);
});

test("keeps self-closing spreadsheet cells empty instead of swallowing later values", () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="D1"/><c r="G1" t="s"><v>0</v></c><c r="H1"/><c r="I1" t="s"><v>1</v></c></row></sheetData></worksheet>';
  assert.deepEqual(worksheetRows(xml, ["2小時", "3小時"]), [["", "", "", "", "", "", "2小時", "", "3小時", ""]]);
});

test("cohort totals use 6/6/6 for 112-115 and count exercise types once", () => {
  const course = recognizedCourseFromRow("115年", ["115/03/02", "台北", "災難應變與醫療聯合討論會", "16小時", "6小時", "6小時", "6小時", "2天", "2天", "2天"], sourceUrl, "v1");
  const completion = { courseId: course.id, completedAt: "2026-03-02", certificateNumber: "", note: "", snapshot: course, updatedAt: "2026-03-02T00:00:00Z" };
  const summary = recognizedCourseSummary([completion], [course], 115);
  assert.deepEqual(summary.targets, { intro: 16, hazmat: 6, nuclear: 6, other: 6, exercises: 3, exerciseHours: 0, jointDiscussions: 3 });
  assert.equal(summary.exerciseCount, 3);
  assert.equal(summary.jointDiscussions, 1);
});

test("bundled official snapshot includes searchable historical years", () => {
  assert.ok(snapshot.courses.length >= 430);
  assert.ok(snapshot.courses.some((course) => course.rocYear === 113));
  assert.ok(snapshot.courses.some((course) => course.rocYear === 114));
  assert.ok(snapshot.courses.some((course) => course.rocYear === 115));
});

test("catalog route discovers the latest official workbook and keeps a fallback", async () => {
  const source = await readFile(new URL("../app/lib/sem-recognized-courses.server.ts", import.meta.url), "utf8");
  assert.match(source, /discoverRecognitionWorkbookUrl/u);
  assert.match(source, /住院醫師災難醫學訓練課程時數認證清單/u);
  assert.match(source, /mergeRecognizedCourses\(snapshot\.courses, liveCourses\)/u);
  assert.match(source, /CACHE_TTL_MS = 6 \* 60 \* 60 \* 1000/u);
});

test("workbook discovery chooses the newest official revision instead of page order", () => {
  const older = "https://tsem.blob.core.windows.net/docfilecontainer/%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E6%99%82%E6%95%B8%E8%AA%8D%E8%AD%89%E6%B8%85%E5%96%AE(1150212%E6%9B%B4%E6%96%B0).xlsx";
  const latest = "https://tsem.blob.core.windows.net/docfilecontainer/%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E6%99%82%E6%95%B8%E8%AA%8D%E8%AD%89%E6%B8%85%E5%96%AE(1150715%E6%9B%B4%E6%96%B0).xlsx";
  const html = `<a href="${older}">住院醫師災難醫學訓練課程時數認證清單</a><a href="${latest}">新版清單</a>`;
  assert.equal(discoverRecognitionWorkbookUrl(html), latest);
});

test("workbook discovery does not turn a fixed 115 fallback into a live result when the official index has no match", () => {
  const html = '<a href="https://www.sem.org.tw/Doc/Other.xlsx">其他表單</a>';
  assert.equal(discoverRecognitionWorkbookUrl(html), null);
});

test("a failed refresh retains the last successful 116 feed and retries on the short interval", async () => {
  let now = 0;
  let calls = 0;
  const live116 = {
    status: "live",
    updatedAt: "2027-02-03",
    sourceUrl: "https://tsem.blob.core.windows.net/docfilecontainer/recognized-1160203.xlsx",
    sourceRevision: "1160203",
    courses: [{
      id: "sem-course-116",
      sheet: "116年",
      rocYear: 116,
      dateRaw: "116/02/10",
      startDate: "2027-02-10",
      endDate: "2027-02-10",
      location: "台北",
      title: "116 年認證課程",
      hours: { intro: 0, hazmat: 6, nuclear: 0, other: 0 },
      exerciseHours: { dmat: 0, hospital: 0, special: 0 },
      exerciseKinds: [],
      rawRecognition: { intro: "", hazmat: "6小時", nuclear: "", other: "", dmat: "", hospital: "", special: "" },
      sourceUrl: "https://tsem.blob.core.windows.net/docfilecontainer/recognized-1160203.xlsx",
      sourceRevision: "1160203",
    }],
  };
  const loader = createSemRecognitionFeedLoader(async () => {
    calls += 1;
    if (calls === 1) return live116;
    throw new Error("temporary official-source failure");
  }, () => now);

  const live = await loader();
  assert.equal(live.status, "live");
  now = 6 * 60 * 60 * 1000 + 1;
  const stale = await loader();
  assert.equal(stale.status, "partial");
  assert.equal(stale.updatedAt, live116.updatedAt);
  assert.equal(stale.sourceUrl, live116.sourceUrl);
  assert.equal(stale.sourceRevision, live116.sourceRevision);
  assert.deepEqual(stale.courses, live116.courses);

  now += 19 * 60 * 1000;
  assert.equal(await loader(), stale);
  assert.equal(calls, 2);
  now += 2 * 60 * 1000;
  const retried = await loader();
  assert.equal(retried.status, "partial");
  assert.equal(retried.updatedAt, live116.updatedAt);
  assert.equal(calls, 3);
});

test("a cold refresh failure uses the bundled 115 snapshot without inventing a new source update time", async () => {
  const currentAttempt = Date.parse("2031-08-09T10:11:12Z");
  const loader = createSemRecognitionFeedLoader(
    async () => { throw new Error("official source unavailable"); },
    () => currentAttempt,
  );
  const fallback = await loader();
  assert.equal(fallback.status, "snapshot");
  assert.equal(fallback.updatedAt, snapshot.updatedAt);
  assert.equal(fallback.sourceUrl, snapshot.sourceUrl);
  assert.equal(fallback.sourceRevision, snapshot.sourceRevision);
  assert.deepEqual(fallback.courses, snapshot.courses);
  assert.notEqual(fallback.updatedAt, new Date(currentAttempt).toISOString());
});
