import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { legacyUserMigrationPlan } from "../db/migrate-legacy-user.ts";

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migrationDir = new URL("../drizzle/", import.meta.url);
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const name of names) {
    const source = await readFile(new URL(name, migrationDir), "utf8");
    for (const sql of source.split("--> statement-breakpoint")) {
      if (sql.trim()) database.exec(sql);
    }
  }
  return database;
}

function executePlan(database, plan) {
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of plan) database.prepare(item.sql).run(...item.values);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

test("legacy email-hash ownership migrates transactionally to the stable Site user id", async () => {
  const database = await migratedDatabase();
  const legacy = "0123456789abcdef0123456789abcdef";
  const stable = "site-scoped-user-id";
  const now = "2026-08-10T12:00:00.000Z";

  database.prepare("INSERT INTO progress_reset_state (user_id, generation, updated_at) VALUES (?, 2, ?)").run(legacy, now);
  database.prepare("INSERT INTO question_progress (user_id, question_id, attempts, bookmarked, generation, updated_at) VALUES (?, '001-Q001', 1, 1, 2, ?)").run(legacy, now);
  database.prepare("INSERT INTO attempt_log (mutation_id, user_id, question_id, selected_keys, correct, generation, aggregate_applied, created_at) VALUES ('attempt_0001', ?, '001-Q001', '[\"A\"]', 1, 2, 1, ?)").run(legacy, now);
  database.prepare("INSERT INTO study_annotation (user_id, id, question_id, kind, body, revision, updated_at) VALUES (?, 'q_note', '001-Q001', 'question_note', 'legacy note', 1, ?)").run(legacy, now);
  database.prepare("INSERT INTO annotation_mutation (user_id, mutation_id, annotation_id, applied, created_at) VALUES (?, 'annotation_0001', 'q_note', 1, ?)").run(legacy, now);
  database.prepare("INSERT INTO guide_progress (user_id, chapter_id, note, bookmarked, updated_at) VALUES (?, 1, 'legacy guide note', 1, ?)").run(legacy, now);
  database.prepare("INSERT INTO guide_resource_progress (user_id, resource_id, bookmarked, updated_at) VALUES (?, 'guide-rosens-c001', 1, ?)").run(legacy, now);
  database.prepare("INSERT INTO audio_playlist (user_id, id, name, updated_at) VALUES (?, 'playlist_legacy1', 'Legacy list', ?)").run(legacy, now);
  database.prepare("INSERT INTO board_prep_profile (user_id, state, revision, updated_at) VALUES (?, '{}', 1, ?)").run(legacy, now);
  database.prepare("INSERT INTO disaster_course_completion (user_id, course_id, completed_at, course_snapshot, updated_at) VALUES (?, 'sem-course-test', '2026-01-01', '{}', ?)").run(legacy, now);
  database.prepare("INSERT INTO board_prep_evidence (user_id, id, record_key, object_key, filename, content_type, size, sha256, updated_at) VALUES (?, 'evidence_00000000-0000-0000-0000-000000000001', 'record', ?, 'proof.pdf', 'application/pdf', 10, 'abc', ?)").run(legacy, `${legacy}/board-prep/proof`, now);

  const plan = legacyUserMigrationPlan(stable, legacy, now);
  executePlan(database, plan);
  executePlan(database, plan);

  const ownedTables = [
    "question_progress", "attempt_log", "progress_reset_state", "study_annotation",
    "annotation_mutation", "guide_progress", "guide_resource_progress", "audio_playlist",
    "board_prep_profile", "disaster_course_completion", "board_prep_evidence",
    "board_prep_evidence_cleanup",
  ];
  for (const table of ownedTables) {
    const legacyCount = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`).get(legacy).count;
    assert.equal(legacyCount, 0, `${table} must not retain hidden legacy ownership`);
  }

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempt_log WHERE user_id = ?").get(stable).count, 1);
  assert.equal(database.prepare("SELECT attempts FROM question_progress WHERE user_id = ? AND question_id = '001-Q001'").get(stable).attempts, 1);
  assert.equal(database.prepare("SELECT body FROM study_annotation WHERE user_id = ? AND id = 'q_note'").get(stable).body, "legacy note");
  assert.equal(database.prepare("SELECT note FROM guide_progress WHERE user_id = ? AND chapter_id = 1").get(stable).note, "legacy guide note");
  assert.equal(
    database.prepare("SELECT object_key FROM board_prep_evidence WHERE user_id = ?").get(stable).object_key,
    `${legacy}/board-prep/proof`,
    "R2 bytes stay in place while D1 ownership moves to the stable user",
  );
  assert.equal(database.prepare("SELECT stable_user_id FROM user_identity_migration WHERE legacy_user_id = ?").get(legacy).stable_user_id, stable);
});

test("D1 guards stale progress generations and creates durable R2 cleanup tombstones", async () => {
  const database = await migratedDatabase();
  database.exec("INSERT INTO progress_reset_state (user_id, generation) VALUES ('user-1', 3)");
  assert.throws(
    () => database.exec("INSERT INTO question_progress (user_id, question_id, generation) VALUES ('user-1', '001-Q001', 2)"),
    /stale-progress-generation/u,
  );
  database.exec("INSERT INTO question_progress (user_id, question_id, generation) VALUES ('user-1', '001-Q001', 3)");
  assert.throws(
    () => database.exec("INSERT INTO attempt_log (mutation_id, user_id, question_id, selected_keys, generation) VALUES ('attempt_0001', 'user-1', '001-Q001', '[]', 2)"),
    /stale-progress-generation/u,
  );

  database.exec("INSERT INTO board_prep_evidence (user_id, id, record_key, object_key, filename, content_type, size, sha256) VALUES ('user-1', 'evidence_00000000-0000-0000-0000-000000000001', 'record', 'old-key', 'proof.pdf', 'application/pdf', 1, 'abc')");
  database.exec("UPDATE board_prep_evidence SET object_key = 'new-key', revision = 2 WHERE user_id = 'user-1'");
  assert.equal(database.prepare("SELECT reason FROM board_prep_evidence_cleanup WHERE user_id = 'user-1' AND object_key = 'old-key'").get().reason, "replaced");
  database.exec("UPDATE board_prep_evidence SET deleted_at = CURRENT_TIMESTAMP, revision = 3 WHERE user_id = 'user-1'");
  assert.equal(database.prepare("SELECT reason FROM board_prep_evidence_cleanup WHERE user_id = 'user-1' AND object_key = 'new-key'").get().reason, "deleted");
});

test("personal GET endpoints are dynamic and explicitly private/no-store", async () => {
  const helper = await readFile(new URL("../app/api/private-response.ts", import.meta.url), "utf8");
  assert.match(helper, /private, no-store/u);
  assert.match(helper, /Vary.*oai-authenticated-user-id/su);

  const routes = [
    "account-session", "annotations", "audio-playlists", "board-prep-evidence",
    "board-prep-state", "disaster-course-completions", "guide-progress",
    "guide-resource-progress", "progress",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /export const dynamic = "force-dynamic"/u, `${route} must opt out of static rendering`);
    assert.match(source, /privateJson/u, `${route} must apply the personal response cache policy`);
  }

  const session = await readFile(new URL("../app/api/account-session/route.ts", import.meta.url), "utf8");
  assert.match(session, /authenticated: false/u);
  assert.match(session, /authenticated: true/u);
  assert.match(session, /legacyAccountKey/u);
});

test("write routes retain atomic/idempotent and optimistic concurrency guards", async () => {
  const progress = await readFile(new URL("../app/api/progress/route.ts", import.meta.url), "utf8");
  const annotations = await readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8");
  const evidence = await readFile(new URL("../app/api/board-prep-evidence/route.ts", import.meta.url), "utf8");
  const boardState = await readFile(new URL("../app/api/board-prep-state/route.ts", import.meta.url), "utf8");
  assert.match(progress, /aggregateApplied: 0/u);
  assert.match(progress, /setWhere: pendingAttempt/u);
  assert.match(progress, /await db\.batch\(\[/u);
  assert.match(annotations, /applied: 0/u);
  assert.match(annotations, /await db\.batch\(queries\)/u);
  assert.match(evidence, /metadataCommitted/u);
  assert.match(evidence, /retryEvidenceCleanup/u);
  assert.match(boardState, /eq\(boardPrepProfile\.revision, Number\(body\.baseRevision\)\)/u);
});
