-- Task search index (additive): one normalised text per task — keys, title, description, comments,
-- checklist items, assignees, external contacts, tags and file names — searched with LIKE on binary
-- columns (exact for normalised text, and fast). Derived data: the server fills it at startup (and
-- `npm run search:rebuild` rebuilds it); nothing else changes.

-- CreateTable
CREATE TABLE `task_search_index` (
    `taskId` VARCHAR(191) NOT NULL,
    `head` BLOB NOT NULL,
    `doc` MEDIUMBLOB NOT NULL,
    `stamp` VARCHAR(512) NOT NULL,
    `version` INTEGER NOT NULL,
    `indexedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`taskId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_search_index` ADD CONSTRAINT `task_search_index_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
