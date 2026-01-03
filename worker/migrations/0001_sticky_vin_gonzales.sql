DROP INDEX IF EXISTS `uploads_project_version_channel_idx`;--> statement-breakpoint
ALTER TABLE uploads ADD `platform` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
CREATE INDEX `uploads_project_version_channel_idx` ON `uploads` (`project`,`version`,`release_channel`,`platform`,`status`);