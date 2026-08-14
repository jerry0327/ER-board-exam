import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  executeLegacyGuideNoteMigration,
  guideNoteMigrationScopesAligned,
  legacyGuideNoteMigrationPlan,
} from "../app/lib/guide-note-migration.ts";

function progress(chapterId, note) {
  return {
    userId: "cached",
    chapterId,
    readState: "unread",
    bookmarked: 0,
    note,
    contentHash: null,
    lastOpenedAt: null,
    completedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("all legacy guide notes are planned without requiring their chapters to be opened", () => {
  const existing = {
    id: "q_guide-tintinalli-002",
    questionId: "guide-tintinalli-002",
    kind: "question_note",
    body: "共享內容",
    quote: "",
    prefix: "",
    suffix: "",
    startOffset: null,
    endOffset: null,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  assert.deepEqual(
    legacyGuideNoteMigrationPlan([
      progress(1, " 第一章 "),
      progress(2, "舊版第二章"),
      progress(3, ""),
      progress(304, "超出目錄"),
    ], [existing]),
    [
      { chapterId: 1, resourceId: "guide-tintinalli-001", annotationId: "q_guide-tintinalli-001", body: "第一章", sharedAnnotationExists: false },
      { chapterId: 2, resourceId: "guide-tintinalli-002", annotationId: "q_guide-tintinalli-002", body: "舊版第二章", sharedAnnotationExists: true },
    ],
  );
});

test("legacy notes clear only when annotation and progress stores prove the same persistence scope", () => {
  assert.equal(guideNoteMigrationScopesAligned("account-a", "synced", "account-a", "synced"), true);
  assert.equal(guideNoteMigrationScopesAligned("anonymous-device", "local", "anonymous-device", "offline"), true);
  assert.equal(guideNoteMigrationScopesAligned("account-a", "local", "account-a", "synced"), false);
  assert.equal(guideNoteMigrationScopesAligned("account-a", "synced", "account-a", "offline"), false);
  assert.equal(guideNoteMigrationScopesAligned("anonymous-device", "error", "anonymous-device", "offline"), false);
  assert.equal(guideNoteMigrationScopesAligned("anonymous-device", "local", "account-a", "synced"), false);
  assert.equal(guideNoteMigrationScopesAligned(null, "loading", null, "loading"), false);
});

test("app-level migration writes before clearing and Guide has no current-chapter migration fork", async () => {
  const [hook, app, guide] = await Promise.all([
    readFile(new URL("../app/hooks/use-guide-note-migration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /useGuideNoteMigration\(\{[\s\S]{0,300}progress: guideProgress\.records[\s\S]{0,300}onClearLegacyNote: guideProgress\.saveChapterNote/u);
  assert.match(app, /progressAccountKey: guideProgress\.accountKey/u);
  assert.match(app, /annotationAccountKey: annotations\.accountKey/u);
  assert.match(hook, /guideNoteMigrationScopesAligned\([\s\S]{0,180}annotationAccountKey[\s\S]{0,180}progressAccountKey/u);
  assert.match(hook, /executeLegacyGuideNoteMigration\([\s\S]{0,700}return onClearLegacyNote\(chapterId, ""\)/u);
  assert.match(hook, /if \(!scopeStillAligned\(\)\) throw new Error\("guide note migration scope changed"\)/u);
  assert.match(hook, /const mountedRef = useRef\(false\)/u);
  assert.match(hook, /retryTimerRef\.current = window\.setTimeout/u);
  assert.doesNotMatch(guide, /guideLegacyAnnotationId|migratedLegacyNotesRef|onClearLegacyChapterNote/u);
});

test("a multi-note migration stops safely on failure and can resume without overwriting an upserted note", async () => {
  const items = [1, 2, 3].map((chapterId) => ({
    chapterId,
    resourceId: `guide-tintinalli-00${chapterId}`,
    annotationId: `q_guide-tintinalli-00${chapterId}`,
    body: `note ${chapterId}`,
    sharedAnnotationExists: false,
  }));
  const events = [];
  await assert.rejects(executeLegacyGuideNoteMigration(
    items,
    async (item) => { events.push(`upsert:${item.chapterId}`); },
    async (chapterId) => {
      events.push(`clear:${chapterId}`);
      if (chapterId === 2) throw new Error("temporary storage failure");
    },
  ));
  assert.deepEqual(events, ["upsert:1", "clear:1", "upsert:2", "clear:2"]);

  const resumed = [{ ...items[1], sharedAnnotationExists: true }, items[2]];
  await executeLegacyGuideNoteMigration(
    resumed,
    async (item) => { events.push(`retry-upsert:${item.chapterId}`); },
    async (chapterId) => { events.push(`retry-clear:${chapterId}`); },
  );
  assert.deepEqual(events.slice(4), ["retry-clear:2", "retry-upsert:3", "retry-clear:3"]);
});

test("legacy records with missing or non-string notes cannot blank the app", () => {
  const records = [progress(1, undefined), progress(2, null), progress(3, 42)];
  assert.doesNotThrow(() => legacyGuideNoteMigrationPlan(records, []));
  assert.deepEqual(legacyGuideNoteMigrationPlan(records, []), []);
});
