-- Notification & Scheduling centre: each company's notification rules, its holidays and reminder
-- schedules, a project's and a task's reminder schedule and a project's own escalation numbers, and the
-- pushes / emails held by quiet hours. Add-only; constant defaults only (MySQL 8 and MariaDB alike).
-- Today's settings carry over where they are (working hours, week start, meeting reminder times, each
-- person's lead time and muted types); the starter holidays and the two schedules are added by the
-- server at start-up, once per company.

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `reminderScheduleId` VARCHAR(191) NULL,
    ADD COLUMN `escalationDays` JSON NULL;

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `reminderScheduleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `notification_policies` (
    `companyId` VARCHAR(191) NOT NULL,
    `policy` JSON NOT NULL,
    `holidaysSeededAt` DATETIME(3) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_holidays` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `recurring` BOOLEAN NOT NULL DEFAULT false,
    `source` VARCHAR(16) NOT NULL DEFAULT 'ADMIN',
    `expected` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `company_holidays_companyId_day_idx`(`companyId`, `day`),
    UNIQUE INDEX `company_holidays_companyId_day_name_key`(`companyId`, `day`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reminder_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `steps` JSON NOT NULL,
    `builtIn` VARCHAR(16) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reminder_schedules_companyId_idx`(`companyId`),
    UNIQUE INDEX `reminder_schedules_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_holds` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `notificationId` VARCHAR(191) NULL,
    `channel` VARCHAR(8) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `body` TEXT NULL,
    `entityType` VARCHAR(40) NULL,
    `entityId` VARCHAR(191) NULL,
    `releaseAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `doneAt` DATETIME(3) NULL,
    `outcome` VARCHAR(16) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_holds_doneAt_releaseAt_idx`(`doneAt`, `releaseAt`),
    INDEX `notification_holds_userId_doneAt_idx`(`userId`, `doneAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_policies` ADD CONSTRAINT `notification_policies_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_holidays` ADD CONSTRAINT `company_holidays_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_schedules` ADD CONSTRAINT `reminder_schedules_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
