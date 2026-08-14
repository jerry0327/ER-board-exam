import assert from "node:assert/strict";
import test from "node:test";
import { taiwanDateKey } from "../app/lib/taiwan-date.ts";

test("uses the Taiwan calendar date instead of the UTC date near midnight", () => {
  assert.equal(taiwanDateKey(new Date("2026-07-27T15:59:59.000Z")), "2026-07-27");
  assert.equal(taiwanDateKey(new Date("2026-07-27T16:00:00.000Z")), "2026-07-28");
});
