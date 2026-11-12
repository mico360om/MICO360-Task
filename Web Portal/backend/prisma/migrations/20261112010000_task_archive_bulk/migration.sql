-- Task archive + bulk changes (additive). An archived task is hidden but kept: archivedAt / archivedById
-- (nullable, no default — every existing task is not archived). Bulk changes keep one row per bulk action
-- for its Undo (the values before and after) and the audit. MariaDB-safe: ADD COLUMN, CREATE INDEX,
-- CREATE TABLE only; no defaults from expressions.

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `archivedById` VARCHAR(191) NULL;

-- CreateIndex (a project's archived tasks, and its live ones)
CREATE INDEX `tasks_projectId_archivedAt_idx` ON `tasks`(`projectId`, `archivedAt`);

-- CreateTable
CREATE TABLE `task_bulk_actions` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `changed` INTEGER NOT NULL DEFAULT 0,
    `undoData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `undoUntil` DATETIME(3) NOT NULL,
    `undoneAt` DATETIME(3) NULL,

    INDEX `task_bulk_actions_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
