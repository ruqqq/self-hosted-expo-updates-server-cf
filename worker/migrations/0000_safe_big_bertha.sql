CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`private_key` text,
	`certificate` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`version` text,
	`platform` text,
	`release_channel` text,
	`embedded_update` text,
	`current_update` text,
	`update_count` integer DEFAULT 0,
	`first_seen` integer,
	`last_seen` integer,
	FOREIGN KEY (`project`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`version` text NOT NULL,
	`release_channel` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`r2_path` text NOT NULL,
	`metadata_json` text,
	`app_json` text,
	`update_id` text,
	`git_branch` text,
	`git_commit` text,
	`original_filename` text,
	`size` integer,
	`created_at` integer,
	`released_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `clients_project_platform_idx` ON `clients` (`project`,`platform`);--> statement-breakpoint
CREATE INDEX `clients_last_seen_idx` ON `clients` (`last_seen`);--> statement-breakpoint
CREATE INDEX `uploads_project_version_channel_idx` ON `uploads` (`project`,`version`,`release_channel`,`status`);--> statement-breakpoint
CREATE INDEX `uploads_project_created_idx` ON `uploads` (`project`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);