-- 1.23: automatic Teams links. Each person's own Microsoft connection (its refresh token sealed with
-- MS_TOKEN_KEY), and on meetings: whether the online link is a Teams one, the Teams meeting's id and whose
-- account made it. Add-only.

-- AlterTable
ALTER TABLE `meetings` ADD COLUMN `onlineMeetingId` VARCHAR(512) NULL,
    ADD COLUMN `onlineMeetingOwnerId` VARCHAR(191) NULL,
    ADD COLUMN `onlineMeetingProvider` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `microsoft_connections` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `microsoftUserId` VARCHAR(64) NOT NULL,
    `email` VARCHAR(320) NULL,
    `displayName` VARCHAR(200) NULL,
    `refreshTokenEnc` TEXT NULL,
    `problem` VARCHAR(300) NULL,
    `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `microsoft_connections_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `meetings_onlineMeetingId_idx` ON `meetings`(`onlineMeetingId`);

