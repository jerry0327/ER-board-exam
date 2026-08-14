CREATE TABLE `board_prep_evidence_cleanup` (
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`reason` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `object_key`)
);
--> statement-breakpoint
CREATE INDEX `board_prep_evidence_cleanup_user_updated_idx` ON `board_prep_evidence_cleanup` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_identity_migration` (
	`legacy_user_id` text PRIMARY KEY NOT NULL,
	`stable_user_id` text NOT NULL,
	`migrated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_identity_migration_stable_idx` ON `user_identity_migration` (`stable_user_id`);--> statement-breakpoint
ALTER TABLE `annotation_mutation` ADD `applied` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `attempt_log` ADD `generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `attempt_log` ADD `aggregate_applied` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `question_progress` ADD `generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `study_annotation` ADD `last_mutation_id` text;--> statement-breakpoint
CREATE INDEX `board_prep_evidence_user_active_updated_idx` ON `board_prep_evidence` (`user_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `question_progress_generation_insert_guard`
BEFORE INSERT ON `question_progress`
WHEN NEW.`generation` <> COALESCE((
	SELECT `generation` FROM `progress_reset_state` WHERE `user_id` = NEW.`user_id`
), 0)
BEGIN
	SELECT RAISE(ABORT, 'stale-progress-generation');
END;--> statement-breakpoint
CREATE TRIGGER `question_progress_generation_update_guard`
BEFORE UPDATE ON `question_progress`
WHEN NEW.`generation` <> COALESCE((
	SELECT `generation` FROM `progress_reset_state` WHERE `user_id` = NEW.`user_id`
), 0)
BEGIN
	SELECT RAISE(ABORT, 'stale-progress-generation');
END;--> statement-breakpoint
CREATE TRIGGER `attempt_log_generation_insert_guard`
BEFORE INSERT ON `attempt_log`
WHEN NEW.`generation` <> COALESCE((
	SELECT `generation` FROM `progress_reset_state` WHERE `user_id` = NEW.`user_id`
), 0)
BEGIN
	SELECT RAISE(ABORT, 'stale-progress-generation');
END;--> statement-breakpoint
CREATE TRIGGER `board_prep_evidence_replacement_cleanup`
AFTER UPDATE OF `object_key` ON `board_prep_evidence`
WHEN OLD.`object_key` <> NEW.`object_key`
BEGIN
	INSERT OR IGNORE INTO `board_prep_evidence_cleanup`
		(`user_id`, `object_key`, `reason`, `attempts`, `created_at`, `updated_at`)
	VALUES
		(NEW.`user_id`, OLD.`object_key`, 'replaced', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
END;--> statement-breakpoint
CREATE TRIGGER `board_prep_evidence_delete_cleanup`
AFTER UPDATE OF `deleted_at` ON `board_prep_evidence`
WHEN OLD.`deleted_at` IS NULL AND NEW.`deleted_at` IS NOT NULL
BEGIN
	INSERT OR IGNORE INTO `board_prep_evidence_cleanup`
		(`user_id`, `object_key`, `reason`, `attempts`, `created_at`, `updated_at`)
	VALUES
		(NEW.`user_id`, NEW.`object_key`, 'deleted', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
END;--> statement-breakpoint
PRAGMA optimize;
