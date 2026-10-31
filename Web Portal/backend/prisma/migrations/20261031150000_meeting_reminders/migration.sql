-- Automatic meeting reminders: one row per reminder sent to one person one way (the bell with its phone
-- push, or email), unique per meeting, person, reminder time, the start it was for and way (no double sends).
-- CreateTable
CREATE TABLE `meeting_reminder_sends` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `recipientKey` VARCHAR(255) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `email` VARCHAR(255) NULL,
    `offsetMinutes` INTEGER NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `channel` ENUM('APP', 'EMAIL') NOT NULL,
    `status` ENUM('SENDING', 'SENT', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'SENDING',
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `meeting_reminder_sends_startAt_idx`(`startAt`),
    UNIQUE INDEX `meeting_reminder_sends_meetingId_recipientKey_offsetMinutes__key`(`meetingId`, `recipientKey`, `offsetMinutes`, `startAt`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `meeting_reminder_sends` ADD CONSTRAINT `meeting_reminder_sends_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

