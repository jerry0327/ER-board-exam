import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateEmergencyBoardDates,
  nextEmergencyBoardEstimate,
} from "../app/lib/exam-date-estimate.ts";

test("estimates the 116 exam cycle from the recurring historical weekday pattern", () => {
  assert.deepEqual(estimateEmergencyBoardDates(2027), {
    writtenDate: "2027-05-08",
    oralDate: "2027-06-05",
  });
  assert.deepEqual(nextEmergencyBoardEstimate("2026-07-29"), {
    writtenDate: "2027-05-08",
    oralDate: "2027-06-05",
    targetYear: 2027,
    rocYear: 116,
    milestone: "written",
    targetDate: "2027-05-08",
    daysRemaining: 283,
  });
});

test("moves from written to oral and then rolls the estimate to the following year", () => {
  assert.equal(nextEmergencyBoardEstimate("2027-05-09").milestone, "oral");
  assert.deepEqual(estimateEmergencyBoardDates(2028), {
    writtenDate: "2028-05-06",
    oralDate: "2028-06-03",
  });
  assert.equal(nextEmergencyBoardEstimate("2027-06-06").targetYear, 2028);
});
