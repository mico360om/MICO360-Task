-- CreateTable
CREATE TABLE `daily_task_emails` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `kind` ENUM('PENDING', 'COMPLETED') NOT NULL,
    `status` ENUM('SENDING', 'SENT', 'SKIPPED', 'RETRY', 'FAILED') NOT NULL DEFAULT 'SENDING',
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `taskCount` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_task_emails_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `daily_task_emails_day_idx`(`day`),
    UNIQUE INDEX `daily_task_emails_userId_day_kind_key`(`userId`, `day`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_task_emails` ADD CONSTRAINT `daily_task_emails_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

