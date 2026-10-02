-- Each copy of a recurring task records the task it was made from. The unique index means a task
-- can never get two next copies, even when it is completed from two apps at the same moment.
ALTER TABLE `tasks` ADD COLUMN `recurrenceSourceId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `tasks_recurrenceSourceId_key` ON `tasks`(`recurrenceSourceId`);
