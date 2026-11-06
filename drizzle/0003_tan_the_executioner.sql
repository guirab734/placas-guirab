CREATE TABLE `plate_history` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`plate_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`plate_id`) REFERENCES `lojas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plate_history_owner_plate_idx` ON `plate_history` (`owner_id`,`plate_id`);--> statement-breakpoint
CREATE TABLE `visitas` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`geometry` text NOT NULL,
	`status` text NOT NULL,
	`visited_at` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visitas_owner_idx` ON `visitas` (`owner_id`);--> statement-breakpoint
ALTER TABLE `lojas` ADD `plate_number` integer;--> statement-breakpoint
ALTER TABLE `lojas` ADD `legacy_code` text;--> statement-breakpoint
ALTER TABLE `lojas` ADD `joined_at` text;--> statement-breakpoint
ALTER TABLE `lojas` ADD `initial_reviews` integer;--> statement-breakpoint
ALTER TABLE `lojas` ADD `current_reviews` integer;--> statement-breakpoint
ALTER TABLE `lojas` ADD `reviews_updated_at` text;--> statement-breakpoint
ALTER TABLE `lojas` ADD `owner_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `lojas` ADD `owner_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `lojas` ADD `address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `lojas` ADD `neighborhood` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `lojas` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `lojas` ADD `next_contact_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `lojas_plate_number_unique` ON `lojas` (`plate_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `lojas_legacy_code_unique` ON `lojas` (`legacy_code`);