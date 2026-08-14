import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  createSemDisasterCourseFeedLoader,
  disasterCourseCacheControl,
  fallbackSemDisasterCourseFeed,
  parseLatestRecognitionWorkbookLink,
  parseSemDisasterCourseWorkbook,
  refreshSemDisasterCourseFeed,
  SEM_DISASTER_FORMS_URL,
} from "../app/lib/sem-disaster-courses.ts";

const workbookLink = {
  url: "https://tsem.blob.core.windows.net/docfilecontainer/%E4%BD%8F%E9%99%A2%E9%86%AB%E5%B8%AB%E7%81%BD%E9%9B%A3%E9%86%AB%E5%AD%B8%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E6%99%82%E6%95%B8%E8%AA%8D%E8%AD%89%E6%B8%85%E5%96%AE(1150715%E6%9B%B4%E6%96%B0).xlsx",
  updatedAt: "2026-07-15",
  version: "1150715",
};

function inlineCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function fixtureWorkbook() {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
      <sheet name="114年" sheetId="1" r:id="rId1"/><sheet name="115" sheetId="2" r:id="rId2"/>
    </sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
    <row r="1">${inlineCell("A1", "課程日期")}${inlineCell("B1", "課程地點")}${inlineCell("C1", "課程名稱")}</row>
    <row r="2">${inlineCell("E2", "毒化災")}${inlineCell("F2", "核災")}${inlineCell("G2", "其他")}${inlineCell("J2", "特殊災害演習")}</row>
    <row r="3">${inlineCell("A3", "115/07/29")}${inlineCell("B3", "新竹市六樓多媒體會議室")}${inlineCell("C3", "化學災害醫療應變醫護人員進階教育訓練")}<c r="D3"/>${inlineCell("E3", "6小時")}<c r="F3"/><c r="G3"/><c r="H3"/><c r="I3"/>${inlineCell("J3", "桌上模擬演習2小時(毒化災)")}</row>
    <row r="4">${inlineCell("A4", "115/8/11-115/8/13")}${inlineCell("B4", "苗栗縣")}${inlineCell("C4", "115年度中區與北區DMAT聯合演練")}<c r="D4"/><c r="E4"/><c r="F4"/>${inlineCell("G4", "2小時")}${inlineCell("H4", "14.5小時")}<c r="I4"/><c r="J4"/></row>
    <row r="5">${inlineCell("A5", "115/9/1")}${inlineCell("B5", "林口長庚")}${inlineCell("C5", "尚未認列的預告課程")}<c r="D5"/><c r="E5"/>${inlineCell("F5", "未認列")}</row>
  </sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData/></worksheet>"),
    "xl/worksheets/sheet2.xml": strToU8(sheet),
  });
}

function workbookWithRows(rows) {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
      <sheet name="115 年" sheetId="1" r:id="rId1"/>
    </sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheetRows = rows.map((values, offset) => {
    const row = offset + 3;
    return `<row r="${row}">${values.map((value, column) => value ? inlineCell(`${String.fromCharCode(65 + column)}${row}`, value) : "").join("")}</row>`;
  }).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
    <row r="1">${inlineCell("A1", "課程日期")}${inlineCell("B1", "課程地點")}${inlineCell("C1", "課程名稱")}</row>
    <row r="2">${inlineCell("E2", "毒化災")}${inlineCell("F2", "核災")}${inlineCell("G2", "其他")}</row>
    ${sheetRows}
  </sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

function regionalCompletenessWorkbook() {
  return workbookWithRows([
    ["115/01/05", "花蓮觀光糖廠多功能會議室", "2026災難醫療協調中心實務工作坊暨馬太鞍災難醫療論壇", "", "", "", "1小時"],
    ["115/02/07", "中國醫藥大學附設醫院癌症中心大樓1樓階梯教室", "2026台灣新視野緊急救護協會年會暨災難大量傷患應變實務研討會", "", "", "", "2小時"],
    ["115/02/12", "台大醫院國際會議中心202會議廳", "台大醫院急救站整備及人員訓練", "", "", "", "2小時"],
    ["115/02/25", "Webex視訊軟體", "115年災難應變與醫療聯合討論會(萬芳場)", "", "1小時", "1小時"],
    ["115/03/14", "國立虎尾科技大學第三校區圓形國際會議廳", "國際外傷救護與韌性醫療新進展國際學術研討會", "", "", "", "3小時"],
    ["115/04/01", "線上課程", "115 年度化災醫療應變訓練初階線上課程", "", "4小時"],
    ["115/04/20", "線上課程", "115年度醫院安全與緊急應變訓練線上課程", "", "", "", "4小時"],
    ["115/04/22", "Webex視訊軟體", "115年災難應變與醫療聯合討論會(高長場)", "", "", "2小時"],
    ["115/05/12", "花蓮縣衛生局", "115年花蓮縣衛生局災難醫療隊-計畫組訓練第一場次", "", "", "", "4.5小時"],
    ["115/06/07", "新光醫院B1大會議室", "從世界看台灣的韌性醫療", "", "", "", "4小時"],
    ["115/06/08", "大里仁愛醫院第一醫療大樓10樓泉生大講堂", "115年度災難醫療救護隊訓練（第二類）通識課程", "", "", "", "6小時"],
    ["115/06/09", "天主教輔仁大學附設醫院6F任顯群講堂", "大量傷患化災桌上型演練", "", "", "", "", "1小時"],
    ["115/06/12", "輔大醫院急診室", "大量傷患實際演習", "", "", "", "", "1.5小時"],
    ["115/06/24", "Webex視訊軟體", "115年災難應變與醫療聯合討論會(淡馬場)", "", "", "2小時"],
    ["115/06/29", "慈濟大學中央校區和敬樓B104階梯教室", "115年度花蓮縣災難醫療救護初階教育訓練", "", "", "", "3小時"],
    ["115/07/31", "花蓮慈濟醫院協力樓協力講堂", "115年度化學物質緊急事件醫療應變訓練", "", "4小時"],
    ["115/08/01", "醫療大樓七樓第一會議室", "醫院緊急災害應變系統(HICS)教育訓練", "", "", "", "7小時"],
    ["115/08/12", "衛生福利部臺東醫院5樓圖書室", "115年度醫院安全與緊急應變訓練課程部東場", "", "", "", "5小時"],
  ]);
}

test("discovers the newest recognition workbook from the official forms page", () => {
  const html = `
    <a href="https://tsem.blob.core.windows.net/docfilecontainer/${encodeURIComponent("住院醫師災難醫學訓練課程時數認證清單(1150706更新).xlsx")}">舊版</a>
    <a href="${workbookLink.url}">住院醫師災難醫學訓練課程時數認證清單(1150715更新)</a>
    <a href="https://evil.example/${encodeURIComponent("住院醫師災難醫學訓練課程時數認證清單(9991231更新).xlsx")}">外部檔案</a>`;
  assert.deepEqual(parseLatestRecognitionWorkbookLink(html), workbookLink);
});

test("reads the newest annual sheet and maps only recognized hours to checklist items", () => {
  const courses = parseSemDisasterCourseWorkbook(fixtureWorkbook(), workbookLink);
  assert.equal(courses.length, 2);
  assert.deepEqual(courses[0], {
    id: courses[0].id,
    title: "化學災害醫療應變醫護人員進階教育訓練",
    dateLabel: "115/07/29",
    startDate: "2026-07-29",
    endDate: "2026-07-29",
    location: "新竹市六樓多媒體會議室",
    regions: ["north"],
    recognitions: [
      { kind: "hazmat", label: "毒化災課程", hoursText: "6小時", checklistItemId: "disaster.hazmat-6h" },
      { kind: "exercise-special", label: "特殊災害演習", hoursText: "桌上模擬演習2小時(毒化災)", checklistItemId: "disaster.drills-3" },
    ],
    sourceUrl: workbookLink.url,
  });
  assert.deepEqual(courses[1].regions, ["north", "central"]);
  assert.equal(courses[1].endDate, "2026-08-13");
  assert.deepEqual(courses[1].recognitions.map((entry) => entry.checklistItemId), ["disaster.other-6h", "disaster.drills-3"]);
});

test("files common hospital aliases and region-neutral online courses without misfiling east-region rows", () => {
  const courses = parseSemDisasterCourseWorkbook(regionalCompletenessWorkbook(), workbookLink);
  const byTitle = new Map(courses.map((course) => [course.title, course]));

  assert.equal(courses.length, 12);
  assert.deepEqual(byTitle.get("2026台灣新視野緊急救護協會年會暨災難大量傷患應變實務研討會")?.regions, ["central"]);
  assert.deepEqual(byTitle.get("台大醫院急救站整備及人員訓練")?.regions, ["north"]);
  assert.deepEqual(byTitle.get("115年災難應變與醫療聯合討論會(萬芳場)")?.regions, ["north"]);
  assert.deepEqual(byTitle.get("國際外傷救護與韌性醫療新進展國際學術研討會")?.regions, ["south"]);
  assert.deepEqual(byTitle.get("115年災難應變與醫療聯合討論會(高長場)")?.regions, ["south"]);
  assert.deepEqual(byTitle.get("115年度災難醫療救護隊訓練（第二類）通識課程")?.regions, ["central"]);
  assert.deepEqual(byTitle.get("大量傷患實際演習")?.regions, ["north"]);
  assert.deepEqual(byTitle.get("115年災難應變與醫療聯合討論會(淡馬場)")?.regions, ["north"]);

  const online = byTitle.get("115 年度化災醫療應變訓練初階線上課程");
  assert.deepEqual(online?.regions, ["north", "central", "south"]);
  assert.equal(online?.recognitions[0]?.hoursText, "4小時");

  const assignmentCounts = Object.fromEntries(["north", "central", "south"].map((region) => [
    region,
    courses.filter((course) => course.regions.includes(region)).length,
  ]));
  assert.deepEqual(assignmentCounts, { north: 8, central: 4, south: 4 });

  const deliberatelyExcluded = [
    "2026災難醫療協調中心實務工作坊暨馬太鞍災難醫療論壇",
    "115年花蓮縣衛生局災難醫療隊-計畫組訓練第一場次",
    "115年度花蓮縣災難醫療救護初階教育訓練",
    "115年度化學物質緊急事件醫療應變訓練",
    "115年度醫院安全與緊急應變訓練課程部東場",
    "醫院緊急災害應變系統(HICS)教育訓練",
  ];
  for (const title of deliberatelyExcluded) assert.equal(byTitle.has(title), false, title);
});

test("rejects an oversized selected XML entry before workbook parsing", () => {
  const oversizedWorkbook = zipSync({
    "xl/sharedStrings.xml": new Uint8Array(30_000_001),
  });
  assert.throws(
    () => parseSemDisasterCourseWorkbook(oversizedWorkbook, workbookLink),
    /workbook too large/u,
  );
});

test("refresh follows the discovered workbook URL and a failed refresh retains a bounded fallback", async () => {
  const html = `<a href="${workbookLink.url}">住院醫師災難醫學訓練課程時數認證清單(1150715更新)</a>`;
  const requested = [];
  const live = await refreshSemDisasterCourseFeed(
    async (url) => { requested.push(url); return html; },
    async (url) => { requested.push(url); return fixtureWorkbook(); },
  );
  assert.deepEqual(requested, [SEM_DISASTER_FORMS_URL, workbookLink.url]);
  assert.equal(live.status, "live");
  assert.equal(live.updatedAt, "2026-07-15");

  let now = 0;
  let calls = 0;
  const loader = createSemDisasterCourseFeedLoader(async () => {
    calls += 1;
    throw new Error("temporary failure");
  }, () => now);
  const fallback = await loader();
  assert.deepEqual(fallback, fallbackSemDisasterCourseFeed());
  now = 60_000;
  assert.equal(await loader(), fallback);
  assert.equal(calls, 1);
  assert.match(disasterCourseCacheControl("live"), /s-maxage=21600/u);
  assert.match(disasterCourseCacheControl("snapshot"), /s-maxage=300/u);
});
