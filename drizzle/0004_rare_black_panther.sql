CREATE TABLE `guide_progress` (
	`user_id` text NOT NULL,
	`chapter_id` integer NOT NULL,
	`read_state` text DEFAULT 'unread' NOT NULL,
	`bookmarked` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`content_hash` text,
	`last_opened_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`)
);
--> statement-breakpoint
CREATE INDEX `guide_progress_user_state_idx` ON `guide_progress` (`user_id`,`read_state`);--> statement-breakpoint
CREATE INDEX `guide_progress_user_opened_idx` ON `guide_progress` (`user_id`,`last_opened_at`);