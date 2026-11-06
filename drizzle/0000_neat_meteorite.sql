CREATE TABLE `lojas` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`target_url` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`scans` integer DEFAULT 0 NOT NULL,
	`last_access` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lojas_code_unique` ON `lojas` (`code`);--> statement-breakpoint
CREATE INDEX `lojas_owner_idx` ON `lojas` (`owner_id`);