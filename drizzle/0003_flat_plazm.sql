CREATE TABLE `product_links` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`destination` text NOT NULL,
	`external_item_id` text NOT NULL,
	`external_item_name` text NOT NULL,
	`external_sku` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_links_dest_idx` ON `product_links` (`product_id`,`destination`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`supplier_code` text,
	`description` text NOT NULL,
	`normalized_description` text NOT NULL,
	`unit` text,
	`last_unit_price` real,
	`currency` text,
	`times_seen` integer DEFAULT 0 NOT NULL,
	`last_invoice_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_supplier_code_idx` ON `products` (`supplier_id`,`supplier_code`);--> statement-breakpoint
CREATE INDEX `products_supplier_description_idx` ON `products` (`supplier_id`,`normalized_description`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `destination` text;