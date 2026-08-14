import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemocCourseCompletionRecord,
  completedExerciseEntries,
  normalizeRemocCourseCompletionRecords,
  recognizedHoursFromText,
  remocCourseCompletionKey,
  remocCourseProgressTargets,
  summarizeRemocCourseProgress,
} from "../app/lib/remoc-course-progress.ts";

const course = {
  id: "recognized-1",
  title: "115 年度中區與北區災難醫療救護隊（DMAT）聯合演練",
  dateLabel: "115/8/11–115/8/13",
  startDate: "2026-08-11",
  endDate: "2026-08-13",
  location: "苗栗縣",
  regions: ["north", "central"],
  sourceUrl: "https://www.sem.org.tw/Doc/example",
  recognitionStatus: "recognized",
  recognitions: [
    { kind: "other", label: "其他認證課程", hoursText: "8/13：2 小時（DMAT 演練）", checklistItemId: "disaster.other-6h" },
    { kind: "exercise-dmat", label: "災難醫療隊／大量傷患演習", hoursText: "8/11：6 小時；8/12：8.5 小時", checklistItemId: "disaster.drills-3" },
  ],
};

test("recognized hour text sums every official hour entry without treating dates as hours", () => {
  assert.equal(recognizedHoursFromText("8/11：6 小時；8/12：8.5 小時"), 14.5);
  assert.equal(recognizedHoursFromText("桌上模擬演習 2 小時（毒化災）"), 2);
  assert.equal(recognizedHoursFromText("總計 6 小時，其中講授 4 小時、演習 2 小時"), 6);
  assert.equal(recognizedHoursFromText("尚待認列"), 0);
});

test("one cross-region course has one stable completion key and one recognized exercise type", () => {
  const key = remocCourseCompletionKey(course);
  assert.equal(key, remocCourseCompletionKey({ ...course, regions: ["south"] }));
  assert.equal(key, remocCourseCompletionKey({ ...course, location: "苗栗縣聯合演練場地" }));
  const record = buildRemocCourseCompletionRecord(course, "2026-08-13");
  assert.ok(record);
  const summary = summarizeRemocCourseProgress([record]);
  assert.equal(summary.courseCount, 1);
  assert.equal(summary.otherHours, 2);
  assert.equal(summary.exerciseHours, 14.5);
  assert.equal(summary.exerciseCount, 1);
  assert.deepEqual(summary.exerciseKinds, ["exercise-dmat"]);
});

test("pending courses cannot enter recognized progress", () => {
  assert.equal(buildRemocCourseCompletionRecord({ ...course, recognitionStatus: "pending" }, "2026-08-13"), null);
});

test("stored completion records are bounded and normalized", () => {
  const record = buildRemocCourseCompletionRecord(course, "2026-08-13");
  const normalized = normalizeRemocCourseCompletionRecords({ wrong: { ...record, sourceUrl: "javascript:alert(1)" }, valid: record });
  assert.deepEqual(Object.keys(normalized), [record.key]);
});

test("hour targets follow the selected training cohort", () => {
  assert.deepEqual(remocCourseProgressTargets(115), { mode: "modern", introHours: 16, hazmatHours: 6, nuclearHours: 6, otherHours: 6, exerciseCount: 3 });
  assert.deepEqual(remocCourseProgressTargets(110), { mode: "special-24h", introHours: 16, hazmatHours: 8, nuclearHours: 8, otherHours: 8, specialHours: 24, exerciseCount: 3 });
  assert.deepEqual(remocCourseProgressTargets(107), { mode: "basic-14h", courseHours: 14, exerciseHours: 8 });
});

test("exercise progress counts distinct official types, not the number of courses", () => {
  const base = buildRemocCourseCompletionRecord(course, "2026-08-13");
  const sameType = { ...base, key: "same-type", title: "另一堂 DMAT", recognitions: [base.recognitions[1]] };
  assert.equal(summarizeRemocCourseProgress([base, sameType]).exerciseCount, 1);

  const threeKinds = {
    ...base,
    recognitions: [
      base.recognitions[1],
      { kind: "exercise-hospital", label: "醫院緊急應變演習", hoursText: "2 小時", checklistItemId: "disaster.drills-3" },
      { kind: "exercise-special", label: "特殊災害演習", hoursText: "1 小時", checklistItemId: "disaster.drills-3" },
    ],
  };
  assert.equal(summarizeRemocCourseProgress([threeKinds]).exerciseCount, 3);
  assert.deepEqual(completedExerciseEntries([threeKinds]).map((entry) => entry.kind), ["exercise-dmat", "exercise-hospital", "exercise-special"]);
});
