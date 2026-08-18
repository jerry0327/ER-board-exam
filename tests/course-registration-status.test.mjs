import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { courseRegistrationTone, remocRegistrationTone } from "../app/lib/course-registration-status.ts";

test("maps course registration labels to distinct semantic tones", () => {
  assert.equal(courseRegistrationTone("報名中"), "open");
  assert.equal(courseRegistrationTone("即將截止"), "closing");
  assert.equal(courseRegistrationTone("已額滿"), "full");
  assert.equal(courseRegistrationTone("報名截止"), "closed");
  assert.equal(courseRegistrationTone("尚未開放"), "not-open");
  assert.equal(courseRegistrationTone("已取消"), "cancelled");
  assert.equal(courseRegistrationTone("報名狀態未標示"), "unknown");
});

test("derives REMOC deadline warnings without changing registration eligibility", () => {
  assert.equal(remocRegistrationTone("open", "報名中", "2026-07-26", "2026-07-19"), "closing");
  assert.equal(remocRegistrationTone("open", "報名中", "2026-07-27", "2026-07-19"), "open");
  assert.equal(remocRegistrationTone("full", "已額滿", "2026-07-19", "2026-07-19"), "full");
  assert.equal(remocRegistrationTone("closed", "報名截止", "2026-07-19", "2026-07-19"), "closed");
});

test("society and REMOC cards share the same status badge contract", async () => {
  const [view, remoc, css] = await Promise.all([
    readFile(new URL("../app/views/board-prep-view.impl.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/board-prep-remoc.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/board-prep.css", import.meta.url), "utf8"),
  ]);
  assert.match(view, /className="course-registration-badge" data-status=\{courseRegistrationTone/u);
  assert.match(remoc, /className="course-registration-badge" data-status=\{remocRegistrationTone/u);
  for (const tone of ["open", "closing", "full", "closed", "not-open", "cancelled", "unknown"]) {
    assert.match(css, new RegExp(`course-registration-badge\\[data-status="${tone}"\\]`, "u"));
  }
});
