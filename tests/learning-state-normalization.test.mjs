import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGuideOutboxEntry,
  normalizeGuideProgressRecords,
  normalizeGuideResourceProgressRecords,
  normalizeProgressOutboxEntry,
  normalizeProgressSnapshot,
} from "../app/lib/learning-state-normalization.ts";

test("malformed progress snapshots are normalized before entering React state", () => {
  const normalized = normalizeProgressSnapshot({
    progress: [null, {}, {
      questionId: "113-Q037",
      attempts: 3,
      correctAttempts: 9,
      note: "legacy",
    }],
    attempts: [null, {}, {
      questionId: "113-Q037",
      createdAt: "not-a-date",
    }, {
      questionId: "113-Q037",
      createdAt: "2026-08-06T00:00:00.000Z",
      selectedKeys: "not-json",
    }],
  });
  assert.equal(normalized.progress.length, 1);
  assert.equal(normalized.progress[0].correctAttempts, 3);
  assert.equal(normalized.progress[0].readState, "unread");
  assert.equal(normalized.attempts.length, 1);
  assert.equal(normalized.attempts[0].selectedKeys, "[]");
});

test("legacy guide progress without note receives the v99-safe empty value", () => {
  const records = normalizeGuideProgressRecords([{ chapterId: 1 }]);
  assert.equal(records.length, 1);
  assert.equal(records[0].note, "");
  assert.deepEqual(normalizeGuideProgressRecords([null, { chapterId: 0 }, { chapterId: 304 }]), []);
});

test("invalid mutations and guide resource ids are not replayed", () => {
  assert.equal(normalizeProgressOutboxEntry({
    id: "bad",
    queuedAt: "not-a-date",
    generation: 0,
    action: { action: "bookmark", questionId: "113-Q037", value: true },
  }), null);
  assert.equal(normalizeProgressOutboxEntry({
    id: "bad-attempt",
    queuedAt: "2026-08-06T00:00:00.000Z",
    generation: 0,
    action: { action: "attempt", questionId: "113-Q037" },
  }), null);
  assert.equal(normalizeGuideOutboxEntry({
    id: "bad-guide",
    queuedAt: "2026-08-06T00:00:00.000Z",
    action: { action: "read", chapterId: 304, value: "done" },
  }), null);
  assert.deepEqual(normalizeGuideResourceProgressRecords([{ resourceId: "private-resource" }]), []);
});
