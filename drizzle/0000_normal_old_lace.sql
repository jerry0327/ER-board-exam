CREATE TABLE `attempt_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`selected_keys` text NOT NULL,
	`correct` integer,
	`confidence` text DEFAULT 'normal' NOT NULL,
	`mode` text DEFAULT 'study' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempt_log_user_created_idx` ON `attempt_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `attempt_log_user_question_idx` ON `attempt_log` (`user_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `question_progress` (
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`correct_attempts` integer DEFAULT 0 NOT NULL,
	`first_attempt_correct` integer,
	`last_answer` text,
	`last_correct` integer,
	`last_confidence` text,
	`bookmarked` integer DEFAULT 0 NOT NULL,
	`read_state` text DEFAULT 'unread' NOT NULL,
	`wrong_state` text DEFAULT 'none' NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`due_at` text,
	`last_attempt_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `question_progress_user_due_idx` ON `question_progress` (`user_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `question_progress_user_wrong_idx` ON `question_progress` (`user_id`,`wrong_state`);