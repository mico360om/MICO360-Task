-- Learning Hub as one course (1.23.30): modules inside a course, recorded module completion, a lesson's
-- module, the certificate's completion day and covered modules, and an assignment batch id.
-- Add-only; constant defaults only (MySQL 8 and MariaDB alike). The built-in courses are converted once
-- by the server after the upgrade, not here.

-- AlterTable
ALTER TABLE `training_lessons` ADD COLUMN `moduleId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `training_assignments` ADD COLUMN `batchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `training_certificates` ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `moduleIds` JSON NULL;

-- CreateTable
CREATE TABLE `training_modules` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(160) NOT NULL,
    `moduleKey` VARCHAR(24) NOT NULL DEFAULT 'general',
    `roleKeys` JSON NULL,
    `companyIds` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `offReason` VARCHAR(16) NULL,
    `starterKey` VARCHAR(64) NULL,
    `fromCourseId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `training_modules_courseId_position_idx`(`courseId`, `position`),
    UNIQUE INDEX `training_modules_courseId_starterKey_key`(`courseId`, `starterKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_module_done` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `moduleId` VARCHAR(191) NOT NULL,
    `doneAt` DATETIME(3) NOT NULL,
    `via` VARCHAR(12) NOT NULL DEFAULT 'LEARNED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `training_module_done_userId_courseId_idx`(`userId`, `courseId`),
    INDEX `training_module_done_courseId_idx`(`courseId`),
    UNIQUE INDEX `training_module_done_userId_moduleId_key`(`userId`, `moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `training_lessons_moduleId_idx` ON `training_lessons`(`moduleId`);

-- CreateIndex
CREATE INDEX `training_assignments_batchId_idx` ON `training_assignments`(`batchId`);

-- AddForeignKey
ALTER TABLE `training_modules` ADD CONSTRAINT `training_modules_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `training_courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

