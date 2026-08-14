CREATE TABLE `audio_playlist` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`item_ids` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `audio_playlist_user_updated_idx` ON `audio_playlist` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `audio_playlist_user_active_idx` ON `audio_playlist` (`user_id`,`deleted_at`);