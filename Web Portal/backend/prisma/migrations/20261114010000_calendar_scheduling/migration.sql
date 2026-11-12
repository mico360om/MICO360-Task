-- Calendar scheduling: time planned to work on a task (work blocks), people's own reminders about tasks,
-- and each person's Calendar choices. Add-only; constant defaults only (MySQL 8 and MariaDB alike). A
-- task's blocks and reminders go with it when it is erased for good (ON DELETE CASCADE); a binned,
-- archived or done task keeps them (hidden) until then.

-- CreateTable
CREATE TABLE `task_work_blocks` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `plannedById` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_work_blocks_userId_startAt_idx`(`userId`, `startAt`),
    INDEX `task_work_blocks_taskId_idx`(`taskId`),
    INDEX `task_work_blocks_startAt_idx`(`startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_reminders` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `setById` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NULL,
    `anchor` VARCHAR(8) NULL,
    `offsetMinutes` INTEGER NULL,
    `nextAt` DATETIME(3) NULL,
    `mutedAt` DATETIME(3) NULL,
    `snoozedUntil` DATETIME(3) NULL,
    `sentFor` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_reminders_userId_nextAt_idx`(`userId`, `nextAt`),
    INDEX `task_reminders_taskId_idx`(`taskId`),
    INDEX `task_reminders_setById_idx`(`setById`),
    INDEX `task_reminders_nextAt_idx`(`nextAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_preferences` (
    `userId` VARCHAR(191) NOT NULL,
    `prefs` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex (the tasks a calendar range shows by their start; the reminder sweep's "tasks changed since")
CREATE INDEX `tasks_startDate_idx` ON `tasks`(`startDate`);

-- CreateIndex
CREATE INDEX `tasks_updatedAt_idx` ON `tasks`(`updatedAt`);

-- AddForeignKey
ALTER TABLE `task_work_blocks` ADD CONSTRAINT `task_work_blocks_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_reminders` ADD CONSTRAINT `task_reminders_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
