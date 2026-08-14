ALTER TABLE `attempt_log` ADD `mutation_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_log_user_mutation_idx` ON `attempt_log` (`user_id`,`mutation_id`);