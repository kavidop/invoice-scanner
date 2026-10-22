CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`destination` text NOT NULL,
	`status` text NOT NULL,
	`external_id` text,
	`external_url` text,
	`request` text,
	`response` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exports_invoice_idx` ON `exports` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_hash` text,
	`mime_type` text,
	`supplier_id` text,
	`invoice_number` text,
	`issue_date` text,
	`currency` text,
	`total` real,
	`extracted` text,
	`reviewed` text,
	`model` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_source_hash_idx` ON `invoices` (`source_hash`);--> statement-breakpoint
CREATE INDEX `invoices_supplier_number_idx` ON `invoices` (`supplier_id`,`invoice_number`);--> statement-breakpoint
CREATE TABLE `supplier_links` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`destination` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_links_dest_idx` ON `supplier_links` (`supplier_id`,`destination`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`tax_id` text,
	`email` text,
	`phone` text,
	`website` text,
	`iban` text,
	`address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_tax_id_idx` ON `suppliers` (`tax_id`);--> statement-breakpoint
CREATE INDEX `suppliers_normalized_name_idx` ON `suppliers` (`normalized_name`);