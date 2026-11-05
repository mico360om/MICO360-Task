-- 1.23.1 Merge tasks (additive): two or more tasks combined into one main task. Each merged task keeps
-- its own row as a read-only merged record (mergedIntoId, mergedAt, mergedById, mergeId — and it is
-- hidden like a deleted one), its number becomes an alias of the main task, and every row the merge
-- moved to the main task is remembered (task_merge_items) so Undo can give it back. Nothing else
-- changes: existing tasks are merged into nothing.

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `mergedIntoId` VARCHAR(191) NULL,
    ADD COLUMN `mergedAt` DATETIME(3) NULL,
    ADD COLUMN `mergedById` VARCHAR(191) NULL,
    ADD COLUMN `mergeId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `tasks_mergedIntoId_idx` ON `tasks`(`mergedIntoId`);

-- CreateIndex (the notices about one task: a merge re-points them to the main task, Undo back)
CREATE INDEX `notifications_entityId_idx` ON `notifications`(`entityId`);

-- CreateTable
CREATE TABLE `task_merges` (
    `id` VARCHAR(191) NOT NULL,
    `mainTaskId` VARCHAR(191) NOT NULL,
    `mainKeyBefore` VARCHAR(191) NOT NULL,
    `mainKeyAfter` VARCHAR(191) NOT NULL,
    `mainProjectBefore` VARCHAR(191) NOT NULL,
    `mainProjectAfter` VARCHAR(191) NOT NULL,
    `taskIds` JSON NOT NULL,
    `changes` JSON NOT NULL,
    `summary` JSON NOT NULL,
    `mergedById` VARCHAR(191) NOT NULL,
    `mergedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `undoneAt` DATETIME(3) NULL,
    `undoneById` VARCHAR(191) NULL,

    INDEX `task_merges_mainTaskId_idx`(`mainTaskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_merge_items` (
    `id` VARCHAR(191) NOT NULL,
    `mergeId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `rowId` VARCHAR(191) NOT NULL,
    `fromTaskId` VARCHAR(191) NOT NULL,
    `data` JSON NULL,

    INDEX `task_merge_items_mergeId_idx`(`mergeId`),
    INDEX `task_merge_items_kind_rowId_idx`(`kind`, `rowId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_merge_items` ADD CONSTRAINT `task_merge_items_mergeId_fkey` FOREIGN KEY (`mergeId`) REFERENCES `task_merges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
