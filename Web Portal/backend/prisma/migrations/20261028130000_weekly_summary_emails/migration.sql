-- The weekly management summary email: one row per person and company week (sent once), its delivery log.
-- CreateTable
CREATE TABLE `weekly_summary_emails` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `week` VARCHAR(10) NOT NULL,
    `status` ENUM('SENDING', 'SENT', 'SKIPPED', 'RETRY', 'FAILED') NOT NULL DEFAULT 'SENDING',
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `projectCount` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `weekly_summary_emails_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    UNIQUE INDEX `weekly_summary_emails_userId_week_key`(`userId`, `week`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `weekly_summary_emails` ADD CONSTRAINT `weekly_summary_emails_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

