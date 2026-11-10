-- Recycle Bin (additive): a deleted task is kept 60 days and can be restored, then it is erased for good.
-- Who deleted it, when it is erased and the delete it went with (a series deleted as a whole restores as
-- a whole); each project's highest task number used, so erasing a task never frees its number; and an
-- inspection whose task was erased keeps saying which task that was. Merged tasks get none of these.

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `binExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `deleteBatchId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `tasks_binExpiresAt_idx` ON `tasks`(`binExpiresAt`);

-- CreateIndex
CREATE INDEX `tasks_deleteBatchId_idx` ON `tasks`(`deleteBatchId`);

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `taskNumberMark` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `inspections` ADD COLUMN `erasedTask` VARCHAR(300) NULL;
