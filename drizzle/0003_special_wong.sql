CREATE TABLE `progress_reset_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`last_mutation_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
