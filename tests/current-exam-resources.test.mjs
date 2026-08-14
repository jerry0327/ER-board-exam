import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRocExamYear,
  resolveCurrentExamResources,
} from "../app/lib/current-exam-resources.ts";

function announcement(id, title, date) {
  return { id, title, date, url: `https://www.sem.org.tw/News/7/Details/${id}` };
}

test("selects a coherent 116 exam cycle from mixed 115 and 116 announcements", () => {
  const announcements = [
    announcement("1517", "115年度急診醫學科專科醫師甄審初審簡章公告", "2025-12-24"),
    announcement("1581", "公告115年度急診醫學科專科醫師甄審口試程序說明", "2026-05-11"),
    announcement("1701", "116年度急診醫學科專科醫師甄審初審簡章公告", "2026-12-20"),
    announcement("1702", "公告116年度急診醫學科專科醫師甄審筆試試題及答案", "2027-05-09"),
    announcement("1703", "公告116年度急診醫學科專科醫師甄審口試程序說明", "2027-05-11"),
    announcement("1704", "公告116年度急診醫學科專科醫師甄審合格人員名單", "2027-07-06"),
  ];

  const resolved = resolveCurrentExamResources(announcements);

  assert.equal(resolved.year, 116);
  assert.deepEqual(
    [resolved.notice?.announcement.id, resolved.oralProcedure?.announcement.id, resolved.writtenExam?.announcement.id, resolved.qualifiedList?.announcement.id],
    ["1701", "1703", "1702", "1704"],
  );
  assert.equal(resolved.notice?.label, "116 年甄審簡章");
  assert.equal(resolved.notice?.year, 116);
  assert.equal(resolved.notice?.url, announcements[2].url);
  assert.strictEqual(resolved.notice?.announcement, announcements[2]);
});

test("continues to resolve 117 and later years without a hard-coded current year", () => {
  const resolved117 = resolveCurrentExamResources([
    announcement("1801", "公告117年度急診醫學科專科醫師甄審初審簡章", "2027-12-22"),
  ]);
  const resolved128 = resolveCurrentExamResources([
    announcement("2801", "公告128年度急診醫學科專科醫師甄審口試程序說明", "2039-05-10"),
  ]);

  assert.equal(resolved117.year, 117);
  assert.equal(resolved117.notice?.label, "117 年甄審簡章");
  assert.equal(resolved128.year, 128);
  assert.equal(resolved128.oralProcedure?.label, "128 年口試程序說明");
});

test("recognizes official resource terms when title order and punctuation vary", () => {
  const resolved = resolveCurrentExamResources([
    announcement("1901", "急診醫學科專科醫師－118 年度初審甄審簡章公告", "2028-12-20"),
    announcement("1902", "口試流程公告：急診醫學科專科醫師 118 年度甄審", "2029-05-10"),
    announcement("1903", "筆試答案暨試題公告｜118年度急診醫學科專科醫師甄審", "2029-05-09"),
    announcement("1904", "合格人員名單－急診醫學科專科醫師甄審（118 年度）", "2029-07-02"),
  ]);

  assert.equal(resolved.year, 118);
  assert.deepEqual(
    [resolved.notice?.announcement.id, resolved.oralProcedure?.announcement.id, resolved.writtenExam?.announcement.id, resolved.qualifiedList?.announcement.id],
    ["1901", "1902", "1903", "1904"],
  );
});

test("recognizes structurally equivalent future titles without requiring one exact phrase", () => {
  const resolved = resolveCurrentExamResources([
    announcement("1951", "公告 122 年度急診專科醫師報名簡章", "2032-12-18"),
    announcement("1952", "122 年急診醫學科專科醫師個別面試時程及注意事項", "2033-05-10"),
    announcement("1953", "急診醫學科專科醫師 122 年度筆試參考答案與試題", "2033-05-09"),
    announcement("1954", "122 年度急診醫學科專科醫師通過人員公告", "2033-07-03"),
  ]);

  assert.equal(resolved.year, 122);
  assert.deepEqual(
    [resolved.notice?.announcement.id, resolved.oralProcedure?.announcement.id, resolved.writtenExam?.announcement.id, resolved.qualifiedList?.announcement.id],
    ["1951", "1952", "1953", "1954"],
  );
});

test("uses date then announcement id to choose duplicate resources deterministically", () => {
  const olderInputOrder = announcement("2001", "119年度急診醫學科專科醫師甄審初審簡章公告", "2030-01-02");
  const lowerSameDayId = announcement("2002", "119年度急診醫學科專科醫師甄審初審簡章（修正版）", "2030-01-03");
  const higherSameDayId = announcement("2010", "119年度急診醫學科專科醫師甄審初審簡章（第二版）", "2030-01-03");

  const resolved = resolveCurrentExamResources([lowerSameDayId, olderInputOrder, higherSameDayId]);

  assert.strictEqual(resolved.notice?.announcement, higherSameDayId);
});

test("leaves missing newer-year resources null instead of falling back to the old cycle", () => {
  const resolved = resolveCurrentExamResources([
    announcement("2101", "120年度急診醫學科專科醫師甄審初審簡章公告", "2030-12-20"),
    announcement("2002", "公告119年度急診醫學科專科醫師甄審口試程序說明", "2030-05-10"),
    announcement("2003", "公告119年度急診醫學科專科醫師甄審筆試試題及答案", "2030-05-09"),
    announcement("2004", "公告119年度急診醫學科專科醫師甄審合格人員名單", "2030-07-02"),
  ]);

  assert.equal(resolved.year, 120);
  assert.equal(resolved.notice?.announcement.id, "2101");
  assert.equal(resolved.oralProcedure, null);
  assert.equal(resolved.writtenExam, null);
  assert.equal(resolved.qualifiedList, null);
});

test("rejects malformed, implausible, and ambiguous ROC years", () => {
  assert.equal(parseRocExamYear("公告０１１６年度急診醫學科專科醫師甄審簡章"), null);
  assert.equal(parseRocExamYear("公告999年度急診醫學科專科醫師甄審簡章"), null);
  assert.equal(parseRocExamYear("公告999999999999999年度急診醫學科專科醫師甄審簡章"), null);
  assert.equal(parseRocExamYear("公告116年及117年度急診醫學科專科醫師甄審簡章"), null);
  assert.equal(parseRocExamYear("公告一百一十六年度急診醫學科專科醫師甄審簡章"), null);

  const resolved = resolveCurrentExamResources([
    announcement("evil", "公告999999999999999年度急診醫學科專科醫師甄審合格名單", "9999-12-31"),
    announcement("valid", "公告116年度急診醫學科專科醫師甄審初審簡章", "2026-12-20"),
  ]);
  assert.equal(resolved.year, 116);
});

test("does not mistake appeals, initial-review results, or unrelated specialties for target resources", () => {
  const resolved = resolveCurrentExamResources([
    announcement("2201", "公告121年度急診醫學科專科醫師甄審試題申覆程序及答案", "2032-05-09"),
    announcement("2202", "公告121年度急診醫學科專科醫師甄審初審合格名單", "2032-03-01"),
    announcement("2203", "公告121年度內科專科醫師甄審筆試試題及答案", "2032-05-09"),
    announcement("2204", "公告121年度急診醫學科專科醫師甄審口試日期", "2032-05-10"),
    announcement("2205", "公告121年度急診醫學科專科醫師訓練醫院認定合格名單", "2032-07-10"),
  ]);

  assert.deepEqual(resolved, {
    year: null,
    notice: null,
    oralProcedure: null,
    writtenExam: null,
    qualifiedList: null,
  });
});
