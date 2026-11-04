-- 1.22 (§10): AI work that keeps running in the background — the jobs (a Final MOM "Draft with AI",
-- a MICO AI answer) and a question's id from the page that sent it (a resend joins its turn).

-- AlterTable
ALTER TABLE `mico_ai_messages` ADD COLUMN `clientId` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `ai_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `activeKey` VARCHAR(100) NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextTryAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(64) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `input` JSON NOT NULL,
    `result` JSON NULL,
    `outcome` VARCHAR(16) NULL,
    `outcomeAt` DATETIME(3) NULL,
    `error` JSON NULL,
    `watchedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_jobs_activeKey_key`(`activeKey`),
    INDEX `ai_jobs_status_nextTryAt_idx`(`status`, `nextTryAt`),
    INDEX `ai_jobs_kind_subjectId_createdAt_idx`(`kind`, `subjectId`, `createdAt`),
    INDEX `ai_jobs_meetingId_idx`(`meetingId`),
    INDEX `ai_jobs_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `mico_ai_messages_chatId_clientId_key` ON `mico_ai_messages`(`chatId`, `clientId`);

-- AddForeignKey
ALTER TABLE `ai_jobs` ADD CONSTRAINT `ai_jobs_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_jobs` ADD CONSTRAINT `ai_jobs_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `mico_ai_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

