-- Nightly backups: one row per copy (or try) — the nightly copy and "Back up now" (docs/BACKUPS.md).
-- CreateTable
CREATE TABLE `backup_runs` (
    `id` VARCHAR(191) NOT NULL,
    `trigger` ENUM('NIGHTLY', 'MANUAL') NOT NULL,
    `status` ENUM('RUNNING', 'OK', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `localDate` VARCHAR(10) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `fileName` VARCHAR(191) NULL,
    `sizeBytes` BIGINT NULL,
    `sha256` CHAR(64) NULL,
    `encrypted` BOOLEAN NOT NULL DEFAULT false,
    `tableCount` INTEGER NULL,
    `rowCount` INTEGER NULL,
    `fileCount` INTEGER NULL,
    `error` TEXT NULL,
    `driveStatus` ENUM('UPLOADED', 'FAILED', 'SKIPPED') NULL,
    `driveFileId` VARCHAR(191) NULL,
    `driveError` TEXT NULL,
    `requestedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `backup_runs_status_startedAt_idx`(`status`, `startedAt`),
    INDEX `backup_runs_localDate_idx`(`localDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
