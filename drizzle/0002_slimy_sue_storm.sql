CREATE TABLE `annotation_mutation` (
	`user_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`annotation_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE INDEX `annotation_mutation_user_annotation_idx` ON `annotation_mutation` (`user_id`,`annotation_id`);--> statement-breakpoint
CREATE TABLE `study_annotation` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`question_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`suffix` text DEFAULT '' NOT NULL,
	`start_offset` integer,
	`end_offset` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `study_annotation_user_question_idx` ON `study_annotation` (`user_id`,`question_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `study_annotation_user_updated_idx` ON `study_annotation` (`user_id`,`updated_at`);