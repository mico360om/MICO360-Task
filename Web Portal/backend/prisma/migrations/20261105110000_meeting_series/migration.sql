-- 1.23 Meeting series (additive): a named series of related meetings ("Monthly OXY review") and the
-- series each meeting is in. A series belongs to a project, or (meetings without a project) to a
-- company; `auto` marks one made automatically for a repeating meeting. Deleting a series leaves its
-- meetings (their seriesId is cleared). The next migration (meeting_series_backfill) gives every
-- existing repeating meeting its series.

-- AlterTable
ALTER TABLE `meetings` ADD COLUMN `seriesId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `meeting_series` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `companyId` VARCHAR(191) NULL,
    `auto` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `meeting_series_projectId_idx`(`projectId`),
    INDEX `meeting_series_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `meetings_seriesId_idx` ON `meetings`(`seriesId`);

-- AddForeignKey
ALTER TABLE `meetings` ADD CONSTRAINT `meetings_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `meeting_series`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
