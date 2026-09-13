CREATE TABLE `ap_resolutions` (
	`bill_id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`matching_bill_id` text,
	`actor` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
