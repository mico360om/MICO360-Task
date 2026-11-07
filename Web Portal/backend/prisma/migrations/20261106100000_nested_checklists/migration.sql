-- 1.23.3 Nested checklists (additive): a task has several checklists, each with a title
-- (task_checklist_lists), and its items nest (parentId), may be for one person (assigneeId) by a day
-- (dueDate), remember who ticked them (completedAt, completedById) and are kept 30 days when deleted
-- (deletedAt, deletedById, deletedBatchId). parentId has no foreign key on purpose: the server keeps the
-- tree, and a deep tree must never meet the database's cascade depth. Existing items are put in one
-- checklist titled "Checklist" by the next migration (the backfill). Portable: MySQL 8 and MariaDB.

-- AlterTable
ALTER TABLE `task_checklists` ADD COLUMN `assigneeId` VARCHAR(191) NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `completedById` VARCHAR(191) NULL,
    ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedBatchId` VARCHAR(191) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `dueDate` DATETIME(3) NULL,
    ADD COLUMN `listId` VARCHAR(191) NULL,
    ADD COLUMN `parentId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `task_checklist_lists` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` VARCHAR(191) NULL,
    `deletedBatchId` VARCHAR(191) NULL,

    INDEX `task_checklist_lists_taskId_idx`(`taskId`),
    INDEX `task_checklist_lists_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `task_checklists_listId_idx` ON `task_checklists`(`listId`);

-- CreateIndex
CREATE INDEX `task_checklists_parentId_idx` ON `task_checklists`(`parentId`);

-- CreateIndex
CREATE INDEX `task_checklists_assigneeId_idx` ON `task_checklists`(`assigneeId`);

-- CreateIndex
CREATE INDEX `task_checklists_dueDate_idx` ON `task_checklists`(`dueDate`);

-- CreateIndex
CREATE INDEX `task_checklists_deletedAt_idx` ON `task_checklists`(`deletedAt`);

-- AddForeignKey
ALTER TABLE `task_checklist_lists` ADD CONSTRAINT `task_checklist_lists_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_checklists` ADD CONSTRAINT `task_checklists_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `task_checklist_lists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
