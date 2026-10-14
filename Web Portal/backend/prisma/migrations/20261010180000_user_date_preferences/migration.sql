-- Personal date settings: an optional own time zone (NULL = the company's) and the first day of
-- the week (NULL = Sunday). The older, never-shown `timezone` column is left as it is.
ALTER TABLE `users` ADD COLUMN `preferredTimeZone` VARCHAR(64) NULL,
    ADD COLUMN `weekStart` INTEGER NULL;
