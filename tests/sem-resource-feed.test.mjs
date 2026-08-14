import assert from "node:assert/strict";
import test from "node:test";
import {
  createSemResourceFeedLoader,
  fallbackSemResourceFeed,
  parseSemAnnouncementHtml,
  parseSemCourseHtml,
  parseSemNewsHtml,
  preserveStaleSemResourceFeed,
  refreshSemResourceFeed,
  resourceFeedCacheControl,
} from "../app/lib/sem-resource-feed.ts";

test("parses official SEM activity cards without inferring training recognition", () => {
  const html = `
    <a href="/Activity/A/Details/33112" class="AHA-item">
      <p class="title">急性中毒救命課程（AILS Training Course）-115年第3場</p>
      <p class="description">台灣急診醫學會、中國醫藥大學附設醫院</p>
      <p class="date">2026/08/23 <span class="tag tag-score">積分 15</span><span class="tag tag-type">學會主辦</span><span class="tag tag-close">報名截止</span></p>
    </a>`;
  assert.deepEqual(parseSemCourseHtml(html), [{
    id: "A:33112",
    title: "急性中毒救命課程（AILS Training Course）-115年第3場",
    organizer: "台灣急診醫學會、中國醫藥大學附設醫院",
    date: "2026-08-23",
    credits: 15,
    sponsorType: "學會主辦",
    registrationStatus: "報名截止",
    url: "https://www.sem.org.tw/Activity/A/Details/33112",
    source: "sem-hosted",
  }]);
});

test("keeps an explicitly announced registration deadline warning", () => {
  const html = `<a href="/Activity/A/Details/33199" class="AHA-item"><p class="title">急診教育課程</p><p class="description">台灣急診醫學會</p><p class="date">2026/08/01 學會主辦 即將截止</p></a>`;
  assert.equal(parseSemCourseHtml(html)[0]?.registrationStatus, "即將截止");
});

test("parses and deduplicates the desktop and mobile SEM exam announcements", () => {
  const html = `
    <tr><td>專科醫師甄審委員會</td><td><a href="/News/7/Details/1619">公告115年度急診醫學科專科醫師甄審合格人員名單</a></td><td>2026/07/06</td></tr>
    <tr><td><span class="pull-right">2026/07/06</span></td></tr><tr><td><a href="/News/7/Details/1619">公告115年度急診醫學科專科醫師甄審合格人員名單</a></td></tr>`;
  assert.deepEqual(parseSemAnnouncementHtml(html), [{
    id: "1619",
    title: "公告115年度急診醫學科專科醫師甄審合格人員名單",
    date: "2026-07-06",
    url: "https://www.sem.org.tw/News/7/Details/1619",
  }]);
});

test("normalizes unpadded dates and rejects unsafe URLs, invalid dates, and inactive markup", () => {
  const html = `
    <script><a href="/Activity/A/Details/99999" class="AHA-item"><p class="title">fake</p><p class="date">2026/7/9</p></a></script>
    <a href="https://evil.example/Activity/A/Details/123" class="AHA-item"><p class="title">external</p><p class="date">2026/7/9</p></a>
    <a href="/Activity/A/Details/124" class="AHA-item"><p class="title">invalid date</p><p class="date">2026/02/31</p></a>
    <a href="/Activity/B/Details/125#fragment" class="AHA-item">
      <p class="title">安全活動 &#x110000;</p><p class="description">主辦 &amp; 協辦</p><p class="date">2026/7/9 積分 2 非學會主辦 報名中</p>
    </a>`;
  assert.deepEqual(parseSemCourseHtml(html), [{
    id: "B:125",
    title: "安全活動 &#x110000;",
    organizer: "主辦 & 協辦",
    date: "2026-07-09",
    credits: 2,
    sponsorType: "非學會主辦",
    registrationStatus: "報名中",
    url: "https://www.sem.org.tw/Activity/B/Details/125",
    source: "external-credit",
  }]);
});

test("announcement parsing is row-bounded, case-insensitive, and same-origin only", () => {
  const html = `
    <SCRIPT><TR><TD><a href="/News/7/Details/999">fake</a></TD><TD>2026/7/9</TD></TR></SCRIPT>
    <TR><TD><a href="//evil.example/News/7/Details/1000">external</a></TD><TD>2026/7/9</TD></TR>
    <TR><TD><a href="/News/7/Details/1001#top">有效公告</a></TD><TD>2026/7/9</TD></TR>`;
  assert.deepEqual(parseSemAnnouncementHtml(html), [{
    id: "1001",
    title: "有效公告",
    date: "2026-07-09",
    url: "https://www.sem.org.tw/News/7/Details/1001",
  }]);
});

test("parses, sorts, and deduplicates general society news across official categories", () => {
  const html = `
    <tr><td><a href="/News/3/Details/1702">&amp; 學會公告</a></td><td>2027/01/03</td></tr>
    <tr><td><a href="/News/7/Details/1701#top">專科甄審公告</a></td><td>2027/01/04</td></tr>
    <tr><td><a href="/News/Details/1700">無分類最新消息</a></td><td>2027/01/05</td></tr>
    <tr><td><a href="https://www.sem.org.tw/News/Details/1702">另一種路徑的重複公告</a></td><td>2027/01/03</td></tr>
    <tr><td><a href="https://member@www.sem.org.tw/News/4/Details/1703">含帳號的連結</a></td><td>2027/01/05</td></tr>
    <tr><td><a href="https://evil.example/News/4/Details/1704">外站連結</a></td><td>2027/01/06</td></tr>
    <template><tr><td><a href="/News/5/Details/1705">未啟用公告</a></td><td>2027/01/07</td></tr></template>`;
  assert.deepEqual(parseSemNewsHtml(html), [
    {
      id: "1700",
      category: "all",
      title: "無分類最新消息",
      date: "2027-01-05",
      url: "https://www.sem.org.tw/News/Details/1700",
    },
    {
      id: "1701",
      category: "7",
      title: "專科甄審公告",
      date: "2027-01-04",
      url: "https://www.sem.org.tw/News/7/Details/1701",
    },
    {
      id: "1702",
      category: "3",
      title: "& 學會公告",
      date: "2027-01-03",
      url: "https://www.sem.org.tw/News/3/Details/1702",
    },
  ]);
});

test("exam announcement parsing accepts category 7 and its unclassified detail route", () => {
  const html = `
    <tr><td><a href="/News/3/Details/1702">學會公告</a></td><td>2027/01/03</td></tr>
    <tr><td><a href="/News/7/Details/1701">專科甄審公告</a></td><td>2027/01/04</td></tr>
    <tr><td><a href="/News/Details/1700">另一則甄審公告</a></td><td>2027/01/05</td></tr>`;
  assert.deepEqual(parseSemAnnouncementHtml(html), [
    { id: "1700", title: "另一則甄審公告", date: "2027-01-05", url: "https://www.sem.org.tw/News/Details/1700" },
    { id: "1701", title: "專科甄審公告", date: "2027-01-04", url: "https://www.sem.org.tw/News/7/Details/1701" },
  ]);
});

test("snapshot dates stay fixed and course expiry uses the Taiwan calendar date", () => {
  const beforeTaiwanMidnight = fallbackSemResourceFeed(new Date("2026-07-19T15:59:00.000Z"), ["offline"]);
  const afterTaiwanMidnight = fallbackSemResourceFeed(new Date("2026-07-19T16:01:00.000Z"), ["offline"]);
  assert.equal(beforeTaiwanMidnight.updatedAt, "2026-07-18T00:00:00+08:00");
  assert.ok(beforeTaiwanMidnight.courses.some((course) => course.date === "2026-07-19"));
  assert.ok(afterTaiwanMidnight.courses.every((course) => course.date >= "2026-07-20"));
  assert.deepEqual(afterTaiwanMidnight.sourceFailures, ["offline"]);
});

test("a failed refresh preserves prior official data and its real update time", () => {
  const previous = {
    status: "live",
    updatedAt: "2026-07-18T02:00:00.000Z",
    courses: [
      { id: "old", title: "expired", organizer: "", date: "2026-07-18", credits: null, sponsorType: "", registrationStatus: "", url: "https://www.sem.org.tw/Activity/A/Details/1", source: "sem-hosted" },
      { id: "future", title: "keep", organizer: "", date: "2026-07-20", credits: null, sponsorType: "", registrationStatus: "", url: "https://www.sem.org.tw/Activity/A/Details/2", source: "sem-hosted" },
    ],
    announcements: [],
    news: [{ id: "1702", category: "3", title: "keep news", date: "2026-07-18", url: "https://www.sem.org.tw/News/3/Details/1702" }],
    sourceFailures: [],
    recognitionNotice: "notice",
  };
  const snapshot = fallbackSemResourceFeed(new Date("2026-07-19T04:00:00.000Z"), ["all failed"]);
  const preserved = preserveStaleSemResourceFeed(previous, snapshot, new Date("2026-07-19T04:00:00.000Z"));
  assert.equal(preserved.status, "snapshot");
  assert.equal(preserved.updatedAt, previous.updatedAt);
  assert.ok(!preserved.courses.some((course) => course.id === "old"));
  assert.ok(preserved.courses.some((course) => course.id === "future"));
  assert.equal(preserved.news[0]?.id, "1702");
  assert.deepEqual(preserved.sourceFailures, ["all failed"]);
});

test("refresh returns a fixed snapshot when every official source fails", async () => {
  const feed = await refreshSemResourceFeed(async () => { throw new Error("offline"); }, new Date("2026-07-18T04:00:00.000Z"));
  assert.equal(feed.status, "snapshot");
  assert.equal(feed.updatedAt, "2026-07-18T00:00:00+08:00");
  assert.equal(feed.sourceFailures.length, 5);
  assert.ok(feed.courses.length > 0);
  assert.ok(feed.announcements.length > 0);
  assert.deepEqual(feed.news, []);
});

test("partial refreshes expose failures but use the successful check time", async () => {
  const courseHtml = `<a href="/Activity/A/Details/33112" class="AHA-item"><p class="title">Live</p><p class="description">SEM</p><p class="date">2026/08/23 積分 1 學會主辦 報名中</p></a>`;
  const checkedAt = new Date("2026-07-18T04:00:00.000Z");
  const feed = await refreshSemResourceFeed(async (url) => {
    if (url.includes("/Activity/A/Index")) return courseHtml;
    throw new Error("offline");
  }, checkedAt);
  assert.equal(feed.status, "partial");
  assert.equal(feed.updatedAt, checkedAt.toISOString());
  assert.equal(feed.courses[0]?.title, "Live");
  assert.equal(feed.sourceFailures.length, 4);
});

test("a partial refresh keeps prior 116 announcements when the exam announcement source fails", async () => {
  let now = Date.parse("2026-07-18T00:00:00.000Z");
  let calls = 0;
  const previousAnnouncement = {
    id: "1701",
    title: "公告116年度急診醫學科專科醫師甄審口試程序說明",
    date: "2027-05-10",
    url: "https://www.sem.org.tw/News/7/Details/1701",
  };
  const liveCourseHtml = `<a href="/Activity/A/Details/2" class="AHA-item"><p class="title">新課程</p><p class="description">SEM</p><p class="date">2027/07/21 積分 2 學會主辦 報名中</p></a>`;
  const refresh = async (checkedAt) => {
    calls += 1;
    if (calls === 1) {
      return {
        status: "live",
        updatedAt: checkedAt.toISOString(),
        courses: [{ id: "old-course", title: "舊課程", organizer: "SEM", date: "2027-07-20", credits: 1, sponsorType: "學會主辦", registrationStatus: "報名中", url: "https://www.sem.org.tw/Activity/A/Details/1", source: "sem-hosted" }],
        announcements: [previousAnnouncement],
        news: [],
        sourceFailures: [],
        recognitionNotice: "notice",
      };
    }
    return refreshSemResourceFeed(async (url) => {
      if (url.includes("/Activity/A/Index")) return liveCourseHtml;
      throw new Error("offline");
    }, checkedAt);
  };
  const load = createSemResourceFeedLoader(refresh, () => now);

  await load();
  now += 6 * 60 * 60 * 1000;
  const partial = await load();

  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.announcements, [previousAnnouncement]);
  assert.deepEqual(partial.courses.map((course) => course.id), ["A:2"]);
  assert.ok(!partial.courses.some((course) => course.id === "old-course"));
  assert.ok(partial.sourceFailures.includes("專科甄審公告"));
  assert.equal(partial.updatedAt, new Date(now).toISOString());
});

test("a partial refresh keeps prior general news when the all-news source fails", async () => {
  let now = Date.parse("2027-01-05T00:00:00.000Z");
  let calls = 0;
  const previousNews = {
    id: "1702",
    category: "3",
    title: "學會新公告",
    date: "2027-01-03",
    url: "https://www.sem.org.tw/News/3/Details/1702",
  };
  const liveCourseHtml = `<a href="/Activity/A/Details/2" class="AHA-item"><p class="title">新課程</p><p class="description">SEM</p><p class="date">2027/07/21 積分 2 學會主辦 報名中</p></a>`;
  const liveExamHtml = `<tr><td><a href="/News/7/Details/1701">116 年甄審公告</a></td><td>2027/01/04</td></tr>`;
  const refresh = async (checkedAt) => {
    calls += 1;
    if (calls === 1) {
      return {
        status: "live",
        updatedAt: checkedAt.toISOString(),
        courses: [],
        announcements: [],
        news: [previousNews],
        sourceFailures: [],
        recognitionNotice: "notice",
      };
    }
    return refreshSemResourceFeed(async (url) => {
      if (url.endsWith("/News")) throw new Error("all-news offline");
      if (url.includes("/News/7/Index")) return liveExamHtml;
      return liveCourseHtml;
    }, checkedAt);
  };
  const load = createSemResourceFeedLoader(refresh, () => now);

  await load();
  now += 6 * 60 * 60 * 1000;
  const partial = await load();

  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.news, [previousNews]);
  assert.equal(partial.announcements[0]?.id, "1701");
  assert.ok(partial.sourceFailures.includes("學會新聞公告"));
  assert.equal(partial.updatedAt, new Date(now).toISOString());
});

test("per-isolate loader deduplicates refreshes, retains stale data, and retries snapshots sooner", async () => {
  let now = Date.parse("2026-07-18T00:00:00.000Z");
  let calls = 0;
  let nextStatus = "live";
  const refresh = async (checkedAt) => {
    calls += 1;
    if (nextStatus === "throw") throw new Error("offline");
    if (nextStatus === "snapshot") return fallbackSemResourceFeed(checkedAt, ["offline"]);
    return {
      status: "live",
      updatedAt: checkedAt.toISOString(),
      courses: [{ id: "live", title: "Live", organizer: "SEM", date: "2026-07-20", credits: 1, sponsorType: "學會主辦", registrationStatus: "報名中", url: "https://www.sem.org.tw/Activity/A/Details/1", source: "sem-hosted" }],
      announcements: [], news: [], sourceFailures: [], recognitionNotice: "notice",
    };
  };
  const load = createSemResourceFeedLoader(refresh, () => now);
  const [first, concurrent] = await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  assert.deepEqual(concurrent, first);
  await load();
  assert.equal(calls, 1);

  now += 6 * 60 * 60 * 1000;
  nextStatus = "snapshot";
  const stale = await load();
  assert.equal(calls, 2);
  assert.equal(stale.status, "snapshot");
  assert.equal(stale.updatedAt, first.updatedAt);
  assert.ok(stale.courses.some((course) => course.id === "live"));

  now += 14 * 60 * 1000;
  await load();
  assert.equal(calls, 2, "snapshot cache should prevent a tight retry loop");
  now += 2 * 60 * 1000;
  nextStatus = "throw";
  const fallback = await load();
  assert.equal(calls, 3);
  assert.equal(fallback.updatedAt, first.updatedAt);
});

test("HTTP cache policy shortens partial and snapshot edge freshness", () => {
  assert.match(resourceFeedCacheControl("live"), /s-maxage=21600/u);
  assert.match(resourceFeedCacheControl("partial"), /s-maxage=1800/u);
  assert.match(resourceFeedCacheControl("snapshot"), /s-maxage=300/u);
});
