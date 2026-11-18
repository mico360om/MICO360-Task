-- Employee Appreciation (1.24.0): the Appreciation manager permission, the templates and one record per
-- person appreciated. Add-only; constant defaults only (MySQL 8 and MariaDB alike). The six built-in
-- templates are added by the server at boot, not here.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `appreciationManager` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `appreciation_templates` (
    `id` VARCHAR(191) NOT NULL,
    `builtInKey` VARCHAR(32) NULL,
    `name` VARCHAR(80) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `message` TEXT NOT NULL,
    `theme` VARCHAR(16) NOT NULL,
    `icon` VARCHAR(16) NOT NULL,
    `animation` VARCHAR(16) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `appreciation_templates_builtInKey_key`(`builtInKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appreciations` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,
    `title` VARCHAR(120) NOT NULL,
    `message` TEXT NOT NULL,
    `theme` VARCHAR(16) NOT NULL,
    `icon` VARCHAR(16) NOT NULL,
    `animation` VARCHAR(16) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `activatedAt` DATETIME(3) NULL,
    `expiredAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `popupClosedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `appreciations_recipientId_startsAt_idx`(`recipientId`, `startsAt`),
    INDEX `appreciations_batchId_idx`(`batchId`),
    INDEX `appreciations_startsAt_idx`(`startsAt`),
    INDEX `appreciations_companyId_startsAt_idx`(`companyId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
