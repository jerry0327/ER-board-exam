import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const questionProgress = sqliteTable(
  "question_progress",
  {
    userId: text("user_id").notNull(),
    questionId: text("question_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    correctAttempts: integer("correct_attempts").notNull().default(0),
    firstAttemptCorrect: integer("first_attempt_correct"),
    lastAnswer: text("last_answer"),
    lastCorrect: integer("last_correct"),
    lastConfidence: text("last_confidence"),
    bookmarked: integer("bookmarked").notNull().default(0),
    readState: text("read_state").notNull().default("unread"),
    wrongState: text("wrong_state").notNull().default("none"),
    streak: integer("streak").notNull().default(0),
    dueAt: text("due_at"),
    lastAttemptAt: text("last_attempt_at"),
    generation: integer("generation").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.questionId] }),
    index("question_progress_user_due_idx").on(table.userId, table.dueAt),
    index("question_progress_user_wrong_idx").on(table.userId, table.wrongState),
  ],
);

export const attemptLog = sqliteTable(
  "attempt_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mutationId: text("mutation_id"),
    userId: text("user_id").notNull(),
    questionId: text("question_id").notNull(),
    selectedKeys: text("selected_keys").notNull(),
    correct: integer("correct"),
    confidence: text("confidence").notNull().default("normal"),
    mode: text("mode").notNull().default("study"),
    generation: integer("generation").notNull().default(0),
    aggregateApplied: integer("aggregate_applied").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("attempt_log_user_created_idx").on(table.userId, table.createdAt),
    index("attempt_log_user_question_idx").on(table.userId, table.questionId),
    uniqueIndex("attempt_log_user_mutation_idx").on(table.userId, table.mutationId),
  ],
);

export const progressResetState = sqliteTable(
  "progress_reset_state",
  {
    userId: text("user_id").primaryKey(),
    generation: integer("generation").notNull().default(0),
    lastMutationId: text("last_mutation_id"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const studyAnnotation = sqliteTable(
  "study_annotation",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    questionId: text("question_id").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull().default(""),
    quote: text("quote").notNull().default(""),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    revision: integer("revision").notNull().default(1),
    lastMutationId: text("last_mutation_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("study_annotation_user_question_idx").on(table.userId, table.questionId, table.deletedAt),
    index("study_annotation_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const annotationMutation = sqliteTable(
  "annotation_mutation",
  {
    userId: text("user_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    annotationId: text("annotation_id").notNull(),
    applied: integer("applied").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.mutationId] }),
    index("annotation_mutation_user_annotation_idx").on(table.userId, table.annotationId),
  ],
);

export const guideProgress = sqliteTable(
  "guide_progress",
  {
    userId: text("user_id").notNull(),
    chapterId: integer("chapter_id").notNull(),
    readState: text("read_state").notNull().default("unread"),
    bookmarked: integer("bookmarked").notNull().default(0),
    note: text("note").notNull().default(""),
    contentHash: text("content_hash"),
    lastOpenedAt: text("last_opened_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    index("guide_progress_user_state_idx").on(table.userId, table.readState),
    index("guide_progress_user_opened_idx").on(table.userId, table.lastOpenedAt),
  ],
);

// Namespaced resources let additional textbooks use string chapter ids without
// changing the numeric Tintinalli progress contract above.
export const guideResourceProgress = sqliteTable(
  "guide_resource_progress",
  {
    userId: text("user_id").notNull(),
    resourceId: text("resource_id").notNull(),
    readState: text("read_state").notNull().default("unread"),
    bookmarked: integer("bookmarked").notNull().default(0),
    contentHash: text("content_hash"),
    lastOpenedAt: text("last_opened_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.resourceId] }),
    index("guide_resource_progress_user_state_idx").on(table.userId, table.readState),
    index("guide_resource_progress_user_opened_idx").on(table.userId, table.lastOpenedAt),
  ],
);

export const audioPlaylist = sqliteTable(
  "audio_playlist",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    itemIds: text("item_ids").notNull().default("[]"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("audio_playlist_user_updated_idx").on(table.userId, table.updatedAt),
    index("audio_playlist_user_active_idx").on(table.userId, table.deletedAt),
  ],
);

export const boardPrepProfile = sqliteTable(
  "board_prep_profile",
  {
    userId: text("user_id").primaryKey(),
    state: text("state").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const disasterCourseCompletion = sqliteTable(
  "disaster_course_completion",
  {
    userId: text("user_id").notNull(),
    courseId: text("course_id").notNull(),
    completedAt: text("completed_at").notNull(),
    certificateNumber: text("certificate_number").notNull().default(""),
    note: text("note").notNull().default(""),
    courseSnapshot: text("course_snapshot").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.courseId] }),
    index("disaster_completion_user_updated_idx").on(table.userId, table.updatedAt),
    index("disaster_completion_user_active_idx").on(table.userId, table.deletedAt),
  ],
);

export const boardPrepEvidence = sqliteTable(
  "board_prep_evidence",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    recordKey: text("record_key").notNull(),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("board_prep_evidence_user_record_idx").on(table.userId, table.recordKey, table.deletedAt),
    index("board_prep_evidence_user_active_updated_idx").on(table.userId, table.deletedAt, table.updatedAt),
  ],
);

export const boardPrepEvidenceCleanup = sqliteTable(
  "board_prep_evidence_cleanup",
  {
    userId: text("user_id").notNull(),
    objectKey: text("object_key").notNull(),
    reason: text("reason").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.objectKey] }),
    index("board_prep_evidence_cleanup_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const userIdentityMigration = sqliteTable(
  "user_identity_migration",
  {
    legacyUserId: text("legacy_user_id").primaryKey(),
    stableUserId: text("stable_user_id").notNull(),
    migratedAt: text("migrated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("user_identity_migration_stable_idx").on(table.stableUserId)],
);
