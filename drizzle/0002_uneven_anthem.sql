CREATE TABLE `tax_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`destination` text NOT NULL,
	`rate_key` text NOT NULL,
	`external_tax_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_mappings_dest_rate_idx` ON `tax_mappings` (`destination`,`rate_key`);--> statement-breakpoint
ALTER TABLE `supplier_links` ADD `default_account_id` text;