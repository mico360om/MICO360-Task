-- MICO AI: a card of proposed changes kept with its answer, its results once confirmed, and what Undo needs (additive).
-- CreateTable
CREATE TABLE `mico_ai_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PROPOSED',
    `items` JSON NOT NULL,
    `note` VARCHAR(300) NULL,
    `sendInvites` BOOLEAN NOT NULL DEFAULT true,
    `results` JSON NULL,
    `undo` JSON NULL,
    `confirmedAt` DATETIME(3) NULL,
    `undoUntil` DATETIME(3) NULL,
    `undoneAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mico_ai_proposals_messageId_key`(`messageId`),
    INDEX `mico_ai_proposals_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mico_ai_proposals` ADD CONSTRAINT `mico_ai_proposals_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `mico_ai_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
