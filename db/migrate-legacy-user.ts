type MigrationStatement = { sql: string; values: unknown[] };

const migrationGuard = `EXISTS (
  SELECT 1 FROM user_identity_migration
  WHERE legacy_user_id = ? AND stable_user_id = ?
)`;

function statement(sql: string, ...values: unknown[]): MigrationStatement {
  return { sql, values };
}

/**
 * Builds an idempotent, transaction-safe migration from the former email hash
 * owner key to the stable, Site-scoped ChatGPT user id.
 *
 * The mapping row is written first. Every following statement is guarded by
 * that exact mapping, so two different accounts can never claim the same
 * legacy email hash during concurrent requests. D1 executes the plan via one
 * batch, which is transactional.
 */
export function legacyUserMigrationPlan(
  stableUserId: string,
  legacyUserId: string,
  migratedAt: string,
): MigrationStatement[] {
  const plan: MigrationStatement[] = [
    statement(
      `INSERT INTO user_identity_migration (legacy_user_id, stable_user_id, migrated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(legacy_user_id) DO NOTHING`,
      legacyUserId,
      stableUserId,
      migratedAt,
    ),
    statement(
      `INSERT INTO progress_reset_state (user_id, generation, last_mutation_id, updated_at)
       SELECT ?, generation, last_mutation_id, updated_at
       FROM progress_reset_state
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id) DO UPDATE SET
         generation = CASE
           WHEN excluded.generation > progress_reset_state.generation THEN excluded.generation
           ELSE progress_reset_state.generation
         END,
         last_mutation_id = CASE
           WHEN excluded.generation > progress_reset_state.generation THEN excluded.last_mutation_id
           ELSE progress_reset_state.last_mutation_id
         END,
         updated_at = MAX(progress_reset_state.updated_at, excluded.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO board_prep_evidence_cleanup
         (user_id, object_key, reason, attempts, created_at, updated_at)
       SELECT ?, object_key, reason, attempts, created_at, updated_at
       FROM board_prep_evidence_cleanup
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, object_key) DO UPDATE SET
         attempts = MAX(board_prep_evidence_cleanup.attempts, excluded.attempts),
         updated_at = MAX(board_prep_evidence_cleanup.updated_at, excluded.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO attempt_log
         (mutation_id, user_id, question_id, selected_keys, correct, confidence, mode,
          generation, aggregate_applied, created_at)
       SELECT mutation_id, ?, question_id, selected_keys, correct, confidence, mode,
         COALESCE((SELECT generation FROM progress_reset_state WHERE user_id = ?), 0),
         aggregate_applied, created_at
       FROM attempt_log
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT DO NOTHING`,
      stableUserId,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO question_progress
         (user_id, question_id, attempts, correct_attempts, first_attempt_correct,
          last_answer, last_correct, last_confidence, bookmarked, read_state,
          wrong_state, streak, due_at, last_attempt_at, generation, updated_at)
       SELECT ?, question_id, attempts, correct_attempts, first_attempt_correct,
         last_answer, last_correct, last_confidence, bookmarked, read_state,
         wrong_state, streak, due_at, last_attempt_at,
         COALESCE((SELECT generation FROM progress_reset_state WHERE user_id = ?), 0),
         updated_at
       FROM question_progress
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         bookmarked = MAX(question_progress.bookmarked, excluded.bookmarked),
         read_state = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.read_state ELSE question_progress.read_state END,
         wrong_state = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.wrong_state ELSE question_progress.wrong_state END,
         streak = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.streak ELSE question_progress.streak END,
         due_at = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.due_at ELSE question_progress.due_at END,
         last_answer = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.last_answer ELSE question_progress.last_answer END,
         last_correct = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.last_correct ELSE question_progress.last_correct END,
         last_confidence = CASE WHEN excluded.updated_at > question_progress.updated_at THEN excluded.last_confidence ELSE question_progress.last_confidence END,
         last_attempt_at = CASE
           WHEN excluded.last_attempt_at IS NOT NULL
             AND (question_progress.last_attempt_at IS NULL OR excluded.last_attempt_at > question_progress.last_attempt_at)
           THEN excluded.last_attempt_at ELSE question_progress.last_attempt_at
         END,
         generation = excluded.generation,
         updated_at = MAX(question_progress.updated_at, excluded.updated_at)`,
      stableUserId,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `UPDATE question_progress
       SET attempts = (
             SELECT COUNT(*) FROM attempt_log
             WHERE attempt_log.user_id = question_progress.user_id
               AND attempt_log.question_id = question_progress.question_id
           ),
           correct_attempts = (
             SELECT COUNT(*) FROM attempt_log
             WHERE attempt_log.user_id = question_progress.user_id
               AND attempt_log.question_id = question_progress.question_id
               AND attempt_log.correct = 1
           ),
           first_attempt_correct = (
             SELECT correct FROM attempt_log
             WHERE attempt_log.user_id = question_progress.user_id
               AND attempt_log.question_id = question_progress.question_id
               AND attempt_log.correct IS NOT NULL
             ORDER BY created_at ASC, id ASC LIMIT 1
           )
       WHERE user_id = ? AND ${migrationGuard}`,
      stableUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO study_annotation
         (user_id, id, question_id, kind, body, quote, prefix, suffix, start_offset,
          end_offset, revision, last_mutation_id, created_at, updated_at, deleted_at)
       SELECT ?, id, question_id, kind, body, quote, prefix, suffix, start_offset,
          end_offset, revision, last_mutation_id, created_at, updated_at, deleted_at
       FROM study_annotation
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, id) DO UPDATE SET
         question_id = excluded.question_id,
         kind = excluded.kind,
         body = excluded.body,
         quote = excluded.quote,
         prefix = excluded.prefix,
         suffix = excluded.suffix,
         start_offset = excluded.start_offset,
         end_offset = excluded.end_offset,
         revision = excluded.revision,
         last_mutation_id = excluded.last_mutation_id,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at
       WHERE excluded.revision > study_annotation.revision
          OR (excluded.revision = study_annotation.revision AND excluded.updated_at > study_annotation.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO annotation_mutation
         (user_id, mutation_id, annotation_id, applied, created_at)
       SELECT ?, mutation_id, annotation_id, applied, created_at
       FROM annotation_mutation
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, mutation_id) DO NOTHING`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
  ];

  const latestRowTables = [
    {
      table: "guide_progress",
      key: "chapter_id",
      columns: "chapter_id, read_state, bookmarked, note, content_hash, last_opened_at, completed_at, updated_at",
      update: "read_state = CASE WHEN excluded.updated_at > guide_progress.updated_at THEN excluded.read_state ELSE guide_progress.read_state END, bookmarked = MAX(guide_progress.bookmarked, excluded.bookmarked), note = CASE WHEN excluded.updated_at > guide_progress.updated_at THEN excluded.note ELSE guide_progress.note END, content_hash = CASE WHEN excluded.updated_at > guide_progress.updated_at THEN excluded.content_hash ELSE guide_progress.content_hash END, last_opened_at = CASE WHEN excluded.updated_at > guide_progress.updated_at THEN excluded.last_opened_at ELSE guide_progress.last_opened_at END, completed_at = CASE WHEN excluded.updated_at > guide_progress.updated_at THEN excluded.completed_at ELSE guide_progress.completed_at END, updated_at = MAX(guide_progress.updated_at, excluded.updated_at)",
    },
    {
      table: "guide_resource_progress",
      key: "resource_id",
      columns: "resource_id, read_state, bookmarked, content_hash, last_opened_at, completed_at, updated_at",
      update: "read_state = CASE WHEN excluded.updated_at > guide_resource_progress.updated_at THEN excluded.read_state ELSE guide_resource_progress.read_state END, bookmarked = MAX(guide_resource_progress.bookmarked, excluded.bookmarked), content_hash = CASE WHEN excluded.updated_at > guide_resource_progress.updated_at THEN excluded.content_hash ELSE guide_resource_progress.content_hash END, last_opened_at = CASE WHEN excluded.updated_at > guide_resource_progress.updated_at THEN excluded.last_opened_at ELSE guide_resource_progress.last_opened_at END, completed_at = CASE WHEN excluded.updated_at > guide_resource_progress.updated_at THEN excluded.completed_at ELSE guide_resource_progress.completed_at END, updated_at = MAX(guide_resource_progress.updated_at, excluded.updated_at)",
    },
  ] as const;

  for (const item of latestRowTables) {
    plan.push(statement(
      `INSERT INTO ${item.table} (user_id, ${item.columns})
       SELECT ?, ${item.columns} FROM ${item.table}
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, ${item.key}) DO UPDATE SET ${item.update}`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ));
  }

  plan.push(
    statement(
      `INSERT INTO audio_playlist
         (user_id, id, name, item_ids, revision, created_at, updated_at, deleted_at)
       SELECT ?, id, name, item_ids, revision, created_at, updated_at, deleted_at
       FROM audio_playlist
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, id) DO UPDATE SET
         name = excluded.name, item_ids = excluded.item_ids, revision = excluded.revision,
         created_at = excluded.created_at, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at
       WHERE excluded.revision > audio_playlist.revision
          OR (excluded.revision = audio_playlist.revision AND excluded.updated_at > audio_playlist.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO board_prep_profile (user_id, state, revision, updated_at)
       SELECT ?, state, revision, updated_at FROM board_prep_profile
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id) DO UPDATE SET
         state = excluded.state, revision = excluded.revision, updated_at = excluded.updated_at
       WHERE excluded.revision > board_prep_profile.revision
          OR (excluded.revision = board_prep_profile.revision AND excluded.updated_at > board_prep_profile.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO disaster_course_completion
         (user_id, course_id, completed_at, certificate_number, note, course_snapshot,
          revision, created_at, updated_at, deleted_at)
       SELECT ?, course_id, completed_at, certificate_number, note, course_snapshot,
          revision, created_at, updated_at, deleted_at
       FROM disaster_course_completion
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, course_id) DO UPDATE SET
         completed_at = excluded.completed_at,
         certificate_number = excluded.certificate_number,
         note = excluded.note,
         course_snapshot = excluded.course_snapshot,
         revision = excluded.revision,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at
       WHERE excluded.revision > disaster_course_completion.revision
          OR (excluded.revision = disaster_course_completion.revision AND excluded.updated_at > disaster_course_completion.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO board_prep_evidence
         (user_id, id, record_key, object_key, filename, content_type, size, sha256,
          revision, created_at, updated_at, deleted_at)
       SELECT ?, id, record_key, object_key, filename, content_type, size, sha256,
          revision, created_at, updated_at, deleted_at
       FROM board_prep_evidence
       WHERE user_id = ? AND ${migrationGuard}
       ON CONFLICT(user_id, id) DO UPDATE SET
         record_key = excluded.record_key,
         object_key = excluded.object_key,
         filename = excluded.filename,
         content_type = excluded.content_type,
         size = excluded.size,
         sha256 = excluded.sha256,
         revision = excluded.revision,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at
       WHERE excluded.revision > board_prep_evidence.revision
          OR (excluded.revision = board_prep_evidence.revision AND excluded.updated_at > board_prep_evidence.updated_at)`,
      stableUserId,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ),
    statement(
      `INSERT INTO board_prep_evidence_cleanup
         (user_id, object_key, reason, attempts, created_at, updated_at)
       SELECT ?, legacy.object_key, 'identity-migration', 0, ?, ?
       FROM board_prep_evidence AS legacy
       WHERE legacy.user_id = ? AND ${migrationGuard}
         AND NOT EXISTS (
           SELECT 1 FROM board_prep_evidence AS current
           WHERE current.user_id = ? AND current.object_key = legacy.object_key
         )
       ON CONFLICT(user_id, object_key) DO NOTHING`,
      stableUserId,
      migratedAt,
      migratedAt,
      legacyUserId,
      legacyUserId,
      stableUserId,
      stableUserId,
    ),
  );

  const ownedTables = [
    "question_progress",
    "attempt_log",
    "progress_reset_state",
    "study_annotation",
    "annotation_mutation",
    "guide_progress",
    "guide_resource_progress",
    "audio_playlist",
    "board_prep_profile",
    "disaster_course_completion",
    "board_prep_evidence",
    "board_prep_evidence_cleanup",
  ];
  for (const table of ownedTables) {
    plan.push(statement(
      `DELETE FROM ${table} WHERE user_id = ? AND ${migrationGuard}`,
      legacyUserId,
      legacyUserId,
      stableUserId,
    ));
  }

  return plan;
}

export async function migrateLegacyUserData(
  stableUserId: string,
  legacyUserId: string,
  database?: D1Database,
): Promise<void> {
  if (!stableUserId || !legacyUserId || stableUserId === legacyUserId) return;
  const d1 = database ?? await (async () => {
    const { getD1Database } = await import("./index.ts");
    return getD1Database();
  })();
  const mapped = await d1
    .prepare("SELECT stable_user_id FROM user_identity_migration WHERE legacy_user_id = ?")
    .bind(legacyUserId)
    .first<{ stable_user_id: string }>();
  if (mapped) return;

  const plan = legacyUserMigrationPlan(stableUserId, legacyUserId, new Date().toISOString());
  await d1.batch(plan.map((item) => d1.prepare(item.sql).bind(...item.values)));
}
