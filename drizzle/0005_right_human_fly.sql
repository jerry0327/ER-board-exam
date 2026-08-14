CREATE TABLE `board_prep_evidence` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`record_key` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `board_prep_evidence_user_record_idx` ON `board_prep_evidence` (`user_id`,`record_key`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `board_prep_profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `disaster_course_completion` (
	`user_id` text NOT NULL,
	`course_id` text NOT NULL,
	`completed_at` text NOT NULL,
	`certificate_number` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`course_snapshot` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`user_id`, `course_id`)
);
--> statement-breakpoint
CREATE INDEX `disaster_completion_user_updated_idx` ON `disaster_course_completion` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `disaster_completion_user_active_idx` ON `disaster_course_completion` (`user_id`,`deleted_at`);