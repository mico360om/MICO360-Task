-- Adds User.lastActiveAt: the last time a user held a live socket connection.
-- Drives presence "last active" in chat and the "delivered" receipt state.
ALTER TABLE `users` ADD COLUMN `lastActiveAt` DATETIME(3) NULL;
