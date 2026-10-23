-- A task moved to another project gets that project's next number (RIG-4 becomes OPS-17). Its old
-- key is kept here, so looking up RIG-4 still finds it. The unique index means a key is never given
-- to a second task; the project it belonged to keeps that number counted as used.
CREATE TABLE `task_key_aliases` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `task_key_aliases_key_key`(`key`),
    INDEX `task_key_aliases_taskId_idx`(`taskId`),
    INDEX `task_key_aliases_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_key_aliases` ADD CONSTRAINT `task_key_aliases_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_key_aliases` ADD CONSTRAINT `task_key_aliases_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
