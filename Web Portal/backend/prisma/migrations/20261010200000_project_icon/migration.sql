-- A project's chosen icon (one of the web app's icons; NULL = its initials are shown).
ALTER TABLE `projects` ADD COLUMN `icon` VARCHAR(32) NULL;
