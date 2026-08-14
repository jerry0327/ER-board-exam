CREATE TABLE `guide_resource_progress` (
	`user_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`read_state` text DEFAULT 'unread' NOT NULL,
	`bookmarked` integer DEFAULT 0 NOT NULL,
	`content_hash` text,
	`last_opened_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX `guide_resource_progress_user_state_idx` ON `guide_resource_progress` (`user_id`,`read_state`);--> statement-breakpoint
CREATE INDEX `guide_resource_progress_user_opened_idx` ON `guide_resource_progress` (`user_id`,`last_opened_at`);