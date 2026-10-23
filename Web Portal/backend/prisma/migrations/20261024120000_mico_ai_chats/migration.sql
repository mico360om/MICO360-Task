-- MICO AI: each person's private chats with the assistant, and their messages (additive).
-- CreateTable
CREATE TABLE `mico_ai_chats` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `summary` TEXT NULL,
    `summarizedCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mico_ai_chats_userId_lastMessageAt_idx`(`userId`, `lastMessageAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mico_ai_messages` (
    `id` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `text` MEDIUMTEXT NOT NULL,
    `content` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DONE',
    `step` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mico_ai_messages_chatId_createdAt_idx`(`chatId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mico_ai_messages` ADD CONSTRAINT `mico_ai_messages_chatId_fkey` FOREIGN KEY (`chatId`) REFERENCES `mico_ai_chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

