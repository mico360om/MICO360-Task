-- The minutes email's sent log (1.22): one row per send of a meeting's minutes — who sent it and when,
-- the draft or the final minutes, its To and Cc lines and each address's result (the meeting's "Sent").
-- CreateTable
CREATE TABLE `meeting_minutes_sends` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `sentById` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `final` BOOLEAN NOT NULL DEFAULT false,
    `toAddresses` JSON NOT NULL,
    `ccAddresses` JSON NOT NULL,
    `results` JSON NOT NULL,

    INDEX `meeting_minutes_sends_meetingId_sentAt_idx`(`meetingId`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `meeting_minutes_sends` ADD CONSTRAINT `meeting_minutes_sends_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
