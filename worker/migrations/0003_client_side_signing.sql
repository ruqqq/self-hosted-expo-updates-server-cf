-- Add client-side signing columns to uploads table
ALTER TABLE uploads ADD `signed_manifest` text;
ALTER TABLE uploads ADD `manifest_signature` text;

-- Remove server-side signing columns from apps table
-- SQLite 3.35.0+ supports DROP COLUMN
ALTER TABLE apps DROP COLUMN `private_key`;
ALTER TABLE apps DROP COLUMN `certificate`;
