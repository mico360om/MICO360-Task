-- A project's own number (e.g. the client's job or contract number), shown beside its code. Optional.
ALTER TABLE `projects` ADD COLUMN `number` VARCHAR(40) NULL;
