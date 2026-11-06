ALTER TABLE `lojas` ADD `google_place_id` text;--> statement-breakpoint
ALTER TABLE `lojas` ADD `google_profile_url` text;--> statement-breakpoint
ALTER TABLE `lojas` ADD `google_rating` real;--> statement-breakpoint
ALTER TABLE `lojas` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `lojas` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `lojas` ADD `google_synced_at` text;--> statement-breakpoint
ALTER TABLE `lojas` ADD `business_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `lojas` ADD `review_source` text DEFAULT 'manual' NOT NULL;