import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REMOC_CENTRAL_HOME_URL,
  REMOC_CENTRAL_POSTS_URL,
  REMOC_COURSE_LISTINGS_ENDPOINT,
  REMOC_NORTH_COURSES_URL,
  REMOC_SOUTH_COURSES_URL,
  normalizeRegionalCourseListingsPayload,
} from "../app/lib/remoc-course-listings.ts";
import {
  applyVerifiedNorthRegistration,
  createRegionalCourseListingsLoader,
  fallbackNorthCourseListings,
  parseCentralCourseDetail,
  parseCentralPostCandidates,
  parseCourseDateRange,
  parseNorthCourseListings,
  parseSouthCourseListings,
  refreshRegionalCourseListings,
} from "../app/lib/remoc-course-listings.server.ts";

const now = new Date("2026-07-19T12:00:00+08:00");

const southFixture = `
  <table class="course-table"><tbody>
    <tr class="red-color-tr"><td colspan="5" onclick="window.location='CourseInfo.php?courseid=south-1'">
      <img src="icon.png">115 年度災難醫療救護隊訓練（第二類）通識課程
    </td></tr>
    <tr><td>報名期限</td><td>課程日期</td><td>上課地點</td><td>報名狀況</td><td>簡章</td></tr>
    <tr><td>06-30~08-02</td><td>08-11~08-11</td><td>國立成功大學醫學院第一講堂</td><td>未額滿</td>
      <td><a href="../UploadFiles/Files/Course/course.pdf">簡章</a></td></tr>
    <tr class="red-color-tr"><td colspan="5" onclick="window.location='CourseInfo.php?courseid=south-2'">
      2026臺灣災難醫療國際研討會
    </td></tr>
    <tr><td>報名期限</td><td>課程日期</td><td>上課地點</td><td>報名狀況</td><td>簡章</td></tr>
    <tr><td>06-12~07-01</td><td>08-30~08-30</td><td>台南晶英酒店</td><td>未額滿</td><td></td></tr>
  </tbody></table>`;

const centralDetailFixture = ({
  title = "115年度化學物質緊急事件醫療應變訓練通識課程",
  place = "中山醫學大學誠愛樓10樓臨床技能中心(台中市南區建國北路一段110號)",
  time = "2026-08-31 08:30 至 2026-08-31 17:10",
  content = "課程時間：115年8月31日<br>課程地點：中山醫學大學誠愛樓10樓臨床技能中心<br>報名期限：即日起開放報名至額滿為止",
} = {}) => `
  <span id="ContentPlaceHolder1_lblTitle">${title}</span>
  ${place ? `<span id="ContentPlaceHolder1_lblPlace">${place}</span>` : ""}
  <span id="ContentPlaceHolder1_lblTime">${time}</span>
  <span id="ContentPlaceHolder1_lblContent">${content}</span>
  <table><tr><td>附件</td><td><a href="https://eoc.vghtc.gov.tw/FileHandler.ashx?Page=C&amp;PK=787&amp;FileName=course.pdf">簡章</a></td></tr></table>`;

const northRegistrationFixture = ({ date = "2026-10-28", location = "林口長庚紀念醫院", registered = 33 } = {}) => `
  <h1 class="title">115年度輻傷事件醫療應變訓練通識課程</h1>
  <h2 class="content">活動日期：${date}</h2>
  <div>課程場次：10月28日 ${location} 臨床技能訓練中心</div>
  <div>研習預定人數：每場60人</div>
  <span>目前報名數：${registered}</span>
  <input type="submit" value="送出">`;

test("South REMOC rows become bounded course listings with corrected registration dates", () => {
  const courses = parseSouthCourseListings(southFixture, now);
  assert.equal(courses.length, 2);
  assert.deepEqual(courses[0], {
    id: courses[0].id,
    title: "115 年度災難醫療救護隊訓練（第二類）通識課程",
    region: "south",
    startDate: "2026-08-11",
    endDate: "2026-08-11",
    dateLabel: "115/08/11",
    location: "國立成功大學醫學院第一講堂",
    registrationLabel: "未額滿",
    status: "open",
    deadline: "2026-08-02",
    sourceName: "南區緊急醫療應變中心",
    sourceUrl: REMOC_SOUTH_COURSES_URL,
    detailUrl: "https://seoc.hosp.ncku.edu.tw/Remoc/CourseInfo.php?courseid=south-1",
    brochureUrl: "https://seoc.hosp.ncku.edu.tw/UploadFiles/Files/Course/course.pdf",
    recognitionStatus: "pending",
  });
  assert.equal(courses[1].status, "closed");
  assert.equal(courses[1].registrationLabel, "報名已截止");
});

test("North REMOC dates override stale registration text and never use an unverified outside link", () => {
  const html = `
    <h1>115年度課程日期</h1>
    <p>6/23 北區區域級災難醫療救護隊初階訓練課程〖苗栗縣政府衛生局〗課程報名中</p>
    <p>10/28 輻傷事件緊急醫療應變人員教育訓練模組實體訓練課程〖林口長庚紀念醫院〗課程報名中</p>`;
  const courses = parseNorthCourseListings(html, now);
  assert.equal(courses[0].status, "closed");
  assert.equal(courses[0].registrationLabel, "課程已結束");
  assert.equal(courses[1].status, "unknown");
  assert.equal(courses[1].detailUrl, REMOC_NORTH_COURSES_URL);

  const verified = applyVerifiedNorthRegistration(courses[1], northRegistrationFixture(), "https://www.beclass.com/rid=305264569e72b99a331a", now);
  assert.equal(verified.status, "open");
  assert.equal(verified.registrationLabel, "報名中（尚餘 27 名）");
  assert.equal(verified.detailUrl, "https://www.beclass.com/rid=305264569e72b99a331a");

  const mismatched = applyVerifiedNorthRegistration(courses[1], northRegistrationFixture({ date: "2026-07-09" }), "https://www.beclass.com/rid=305264569e72b99a331a", now);
  assert.equal(mismatched.status, "unknown");
  assert.equal(mismatched.detailUrl, REMOC_NORTH_COURSES_URL);
  assert.ok(fallbackNorthCourseListings(now).some((course) => course.startDate === "2026-10-28"));
});

test("Central post discovery is limited to official relevant details", () => {
  const rows = Array.from({ length: 15 }, (_, index) => `
    <tr><td class="TITLE"><a href="PostDetail.aspx?Type=P&amp;PK=${5000 + index}">[教育訓練] ${index + 1} 災難醫療應變訓練</a></td><td class="DATE">2026-07-01</td></tr>`).join("");
  const html = `<table id="ContentPlaceHolder1_gvwPost">${rows}<tr><td><a href="https://evil.example/PostDetail.aspx?Type=P&amp;PK=1">災難醫療</a></td></tr></table>`;
  const candidates = parseCentralPostCandidates(html);
  assert.equal(candidates.length, 12);
  assert.ok(candidates.every((candidate) => candidate.detailUrl.startsWith("https://eoc.vghtc.gov.tw/PostDetail.aspx?")));
});

test("Central details use the actual venue region and keep announcements separate from recognition", () => {
  const central = parseCentralCourseDetail(
    centralDetailFixture(),
    "https://eoc.vghtc.gov.tw/PostDetail.aspx?Type=C&PK=787",
    now,
  );
  assert.equal(central?.region, "central");
  assert.equal(central?.status, "open");
  assert.equal(central?.registrationLabel, "報名中");
  assert.equal(central?.recognitionStatus, "pending");

  const north = parseCentralCourseDetail(centralDetailFixture({
    title: "[教育訓練]訂於115年7月29日辦理「115年化學災害醫療應變醫護人員進階教育訓練(專業課程-新竹場次)」",
    place: "",
    time: "2026-06-03 至 2026-07-29",
    content: "報名期限：即日起至2026年7月25日",
  }), "https://eoc.vghtc.gov.tw/PostDetail.aspx?Type=P&PK=5233", now);
  assert.equal(north?.region, "north");
  assert.equal(north?.location, "新竹場次");
  assert.equal(north?.startDate, "2026-07-29");
  assert.equal(north?.deadline, "2026-07-25");

  const east = parseCentralCourseDetail(centralDetailFixture({
    title: "115年度花蓮縣災難醫療救護初階教育訓練",
    place: "花蓮慈濟醫院",
  }), "https://eoc.vghtc.gov.tw/PostDetail.aspx?Type=P&PK=5241", now);
  assert.equal(east, null);
});

test("course date parsing distinguishes ROC and Gregorian Chinese dates", () => {
  assert.deepEqual(parseCourseDateRange("課程時間：115年8月20日至8月21日"), { startDate: "2026-08-20", endDate: "2026-08-21" });
  assert.deepEqual(parseCourseDateRange("報名截止日期：2026年8月1日"), { startDate: "2026-08-01", endDate: "2026-08-01" });
  assert.deepEqual(parseCourseDateRange("2026-08-31 08:30 至 2026-08-31 17:10"), { startDate: "2026-08-31", endDate: "2026-08-31" });
});

test("combined feed keeps source health, validates North registration, and remains pending for SEM recognition", async () => {
  const centralList = `<table id="ContentPlaceHolder1_gvwPost"><tr><td class="TITLE"><a href="PostDetail.aspx?Type=C&amp;PK=787">化學物質緊急事件醫療應變訓練</a></td></tr></table>`;
  const pages = new Map([
    [REMOC_CENTRAL_POSTS_URL, centralList],
    ["https://eoc.vghtc.gov.tw/PostDetail.aspx?Type=C&PK=787", centralDetailFixture()],
    [REMOC_SOUTH_COURSES_URL, southFixture],
    ["https://www.beclass.com/rid=305264569e72b99a331a", northRegistrationFixture()],
  ]);
  const feed = await refreshRegionalCourseListings(async (url) => {
    if (url === REMOC_NORTH_COURSES_URL) throw new Error("410");
    const page = pages.get(url);
    if (!page) throw new Error(`missing ${url}`);
    return page;
  }, now);
  assert.equal(feed.feedStatus, "partial");
  assert.deepEqual(feed.sources.map((source) => source.status), ["snapshot", "live", "live"]);
  assert.ok(feed.courses.some((course) => course.detailUrl.startsWith("https://www.beclass.com/") && course.status === "open"));
  assert.ok(feed.courses.every((course) => course.recognitionStatus === "pending"));
  assert.ok(normalizeRegionalCourseListingsPayload(feed));
});

test("client payload normalization accepts only bounded official course data", () => {
  assert.equal(REMOC_COURSE_LISTINGS_ENDPOINT, "/api/remoc-course-listings");
  const value = normalizeRegionalCourseListingsPayload({
    feedStatus: "live",
    updatedAt: "2026-07-19",
    sources: [{ region: "central", sourceName: "中區緊急醫療應變中心", sourceUrl: REMOC_CENTRAL_HOME_URL, status: "live" }],
    courses: [{
      id: "course-1",
      title: "化學物質緊急事件醫療應變訓練",
      region: "central",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      dateLabel: "115/08/31",
      location: "台中市",
      registrationLabel: "報名中",
      status: "open",
      sourceName: "中區緊急醫療應變中心",
      sourceUrl: REMOC_CENTRAL_HOME_URL,
      detailUrl: "https://eoc.vghtc.gov.tw/PostDetail.aspx?Type=C&PK=787",
      recognitionStatus: "pending",
    }, {
      id: "evil",
      title: "外部資料",
      region: "central",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      dateLabel: "115/08/31",
      location: "台中市",
      registrationLabel: "報名中",
      status: "open",
      sourceName: "外部",
      sourceUrl: "https://evil.example/course",
      detailUrl: "https://evil.example/course",
      recognitionStatus: "pending",
    }],
  });
  assert.equal(value?.courses.length, 1);
  assert.equal(value?.courses[0].id, "course-1");
});

test("a temporary regional source failure retains that region's last course list", async () => {
  let tick = 0;
  let refreshCount = 0;
  const centralCourse = {
    id: "central-last-good",
    title: "中區化災訓練",
    region: "central",
    startDate: "2026-08-31",
    endDate: "2026-08-31",
    dateLabel: "115/08/31",
    location: "台中市",
    registrationLabel: "報名中",
    status: "open",
    sourceName: "中區緊急醫療應變中心",
    sourceUrl: REMOC_CENTRAL_HOME_URL,
    detailUrl: "https://eoc.vghtc.gov.tw/PostDetail.aspx?Type=C&PK=787",
    recognitionStatus: "pending",
  };
  const sources = (centralStatus) => [
    { region: "north", sourceName: "北區 REMOC", sourceUrl: REMOC_NORTH_COURSES_URL, status: "live" },
    { region: "central", sourceName: "中區緊急醫療應變中心", sourceUrl: REMOC_CENTRAL_HOME_URL, status: centralStatus },
    { region: "south", sourceName: "南區 REMOC", sourceUrl: REMOC_SOUTH_COURSES_URL, status: "live" },
  ];
  const load = createRegionalCourseListingsLoader(async () => {
    refreshCount += 1;
    return refreshCount === 1
      ? { feedStatus: "live", updatedAt: "2026-07-19", sources: sources("live"), courses: [centralCourse] }
      : { feedStatus: "partial", updatedAt: "2026-07-19", sources: sources("unavailable"), courses: [] };
  }, () => tick);
  assert.equal((await load()).courses.length, 1);
  tick = 60 * 60 * 1000 + 1;
  const refreshed = await load();
  assert.equal(refreshed.courses[0].id, centralCourse.id);
  assert.equal(refreshed.sources.find((source) => source.region === "central")?.status, "snapshot");
});

test("API route uses strict request allowlisting, timeouts, response bounds, and edge caching", async () => {
  const route = await readFile(new URL("../app/api/remoc-course-listings/route.ts", import.meta.url), "utf8");
  assert.match(route, /FETCH_TIMEOUT_MS = 8_000/u);
  assert.match(route, /MAX_HTML_BYTES = 2_000_000/u);
  assert.match(route, /unexpected source URL/u);
  assert.match(route, /unexpected redirect origin/u);
  assert.match(route, /Content-Length/u);
  assert.match(route, /regionalCourseListingsCacheControl/u);
});
