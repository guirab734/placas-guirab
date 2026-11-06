CREATE TABLE `plate_code_aliases` (
	`code` text PRIMARY KEY NOT NULL,
	`plate_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`plate_id`) REFERENCES `lojas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plate_code_aliases_owner_plate_idx` ON `plate_code_aliases` (`owner_id`,`plate_id`);