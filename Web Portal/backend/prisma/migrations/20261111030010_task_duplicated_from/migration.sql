-- Duplicate Task (additive): a task made with "Duplicate" remembers the task it was copied from, so the
-- copy shows "Duplicated from MSSP-34" and the original lists its copies. Nullable, no default, no
-- foreign key (the original may later be deleted or merged; the reference then simply finds nothing).
-- Existing tasks were copied from nothing. MariaDB-safe: one ADD COLUMN and one index.

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `duplicatedFromId` VARCHAR(191) NULL;

-- CreateIndex (an original's copies)
CREATE INDEX `tasks_duplicatedFromId_idx` ON `tasks`(`duplicatedFromId`);
