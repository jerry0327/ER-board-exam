import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationMigrationSnapshot,
  planAnonymousAnnotationMigration,
} from "../app/lib/annotation-migration.ts";
import { parseGuideAnnotationScope, parseReaderAnnotationScope } from "../app/lib/annotation-source.ts";

function annotation(overrides = {}) {
  return {
    id: "q_112-Q001",
    questionId: "112-Q001",
    kind: "question_note",
    body: "匿名筆記",
    quote: "",
    prefix: "",
    suffix: "",
    startOffset: null,
    endOffset: null,
    revision: 4,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: null,
    syncState: "pending",
    ...overrides,
  };
}

test("anonymous annotation import is durable-outbox ready and idempotent", () => {
  const source = annotation();
  const first = planAnonymousAnnotationMigration("account-1", [source], []);
  assert.equal(first.annotations.length, 1);
  assert.equal(first.annotations[0].id, source.id);
  assert.equal(first.annotations[0].revision, 1);
  assert.equal(first.annotations[0].syncState, "pending");
  assert.deepEqual(first.outbox.map(({ action, baseRevision, annotation: item }) => ({ action, baseRevision, id: item.id })), [
    { action: "upsert", baseRevision: 0, id: source.id },
  ]);
  assert.match(first.outbox[0].mutationId, /^am_[a-z0-9]{8,}$/u);

  const rerun = planAnonymousAnnotationMigration("account-1", [source], first.annotations);
  assert.deepEqual(rerun, { annotations: [], outbox: [] });
  assert.equal(
    planAnonymousAnnotationMigration("account-1", [source], []).outbox[0].mutationId,
    first.outbox[0].mutationId,
    "an interrupted migration must reuse one server mutation receipt",
  );
});

test("same-id account content is never overwritten and anonymous content receives one stable duplicate", () => {
  const source = annotation();
  const account = annotation({ body: "帳號原有筆記", revision: 9, syncState: "saved" });
  const first = planAnonymousAnnotationMigration("account-1", [source], [account]);
  assert.equal(first.annotations.length, 1);
  assert.match(first.annotations[0].id, /^q_m_[A-Za-z0-9_-]+$/u);
  assert.notEqual(first.annotations[0].id, account.id);
  assert.equal(first.annotations[0].body, source.body);

  const repeated = planAnonymousAnnotationMigration("account-1", [source], [account]);
  assert.equal(repeated.annotations[0].id, first.annotations[0].id);
  const editedImportedCopy = { ...first.annotations[0], body: "登入後又補充的內容", revision: 2 };
  assert.deepEqual(
    planAnonymousAnnotationMigration("account-1", [source], [account, editedImportedCopy]),
    { annotations: [], outbox: [] },
    "the deterministic duplicate id remains the migration marker after later edits",
  );
});

test("conflicting highlights keep their Reader or Guide source scope in the duplicate id", () => {
  for (const id of [
    "h_r_concise_standard_original-highlight",
    "h_gt057_detailed-focus_original-highlight",
    "h_c_legacy-highlight",
  ]) {
    const source = annotation({ id, kind: "highlight", quote: "重要內容", body: "匿名附註" });
    const account = annotation({ id, kind: "highlight", quote: "帳號內容", body: "帳號附註", revision: 8 });
    const migrated = planAnonymousAnnotationMigration("account-1", [source], [account]).annotations[0];
    const expectedPrefix = id.startsWith("h_r_")
      ? "h_r_concise_standard_"
      : id.startsWith("h_gt") ? "h_gt057_detailed-focus_" : "h_c_";
    assert.ok(migrated.id.startsWith(expectedPrefix), `${migrated.id} must retain ${expectedPrefix}`);
    if (id.startsWith("h_r_")) assert.deepEqual(parseReaderAnnotationScope(migrated.id), { kind: "reader", packId: "concise", mode: "standard" });
    if (id.startsWith("h_gt")) assert.deepEqual(parseGuideAnnotationScope(migrated.id), { kind: "guide", chapter: 57, packId: "detailed", mode: "focus" });
  }
});

test("identical account records are no-ops, tombstones stay deleted, and snapshot cleanup detects concurrent edits", () => {
  const source = annotation();
  assert.deepEqual(
    planAnonymousAnnotationMigration("account-1", [source], [{ ...source, revision: 12, syncState: "saved" }]),
    { annotations: [], outbox: [] },
  );
  assert.deepEqual(
    planAnonymousAnnotationMigration("account-1", [{ ...source, deletedAt: "2026-02-01T00:00:00.000Z" }], []),
    { annotations: [], outbox: [] },
  );
  assert.notEqual(annotationMigrationSnapshot(source), annotationMigrationSnapshot({ ...source, body: "同步期間的新內容" }));
});

test("a matching stale account cache cannot hide a different current server record", () => {
  const source = annotation();
  const staleCache = { ...source, revision: 2, syncState: "saved" };
  const currentServer = annotation({ body: "伺服器較新的不同內容", revision: 8, syncState: "saved" });
  const plan = planAnonymousAnnotationMigration("account-1", [source], [staleCache, currentServer]);
  assert.equal(plan.annotations.length, 1);
  assert.notEqual(plan.annotations[0].id, source.id);
  assert.equal(plan.annotations[0].body, source.body);
});
