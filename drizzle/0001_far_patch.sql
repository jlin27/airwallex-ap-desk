CREATE TABLE `ap_beneficiary_resolutions` (
	`bill_id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`beneficiary_id` text,
	`beneficiary_name` text,
	`note` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
