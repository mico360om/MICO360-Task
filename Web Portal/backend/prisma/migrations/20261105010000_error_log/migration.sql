-- 1.22.4: the Error log (System Settings → Error log) — one row per distinct error, browsers' and the
-- server's, and each row's newest occurrences. Two new tables; nothing else changes.

-- CreateTable
CREATE TABLE `error_groups` (
    `id` VARCHAR(191) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `topFile` VARCHAR(300) NULL,
    `topLine` INTEGER NULL,
    `topFunction` VARCHAR(120) NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `people` JSON NULL,
    `peopleCount` INTEGER NOT NULL DEFAULT 0,
    `firstSeenAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL,
    `lastVersion` VARCHAR(32) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'OPEN',
    `fixedAt` DATETIME(3) NULL,
    `fixedById` VARCHAR(191) NULL,
    `fixedInVersion` VARCHAR(32) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `error_groups_fingerprint_key`(`fingerprint`),
    INDEX `error_groups_lastSeenAt_idx`(`lastSeenAt`),
    INDEX `error_groups_status_kind_lastSeenAt_idx`(`status`, `kind`, `lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `error_events` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `detail` VARCHAR(32) NULL,
    `message` VARCHAR(500) NOT NULL,
    `stack` TEXT NULL,
    `page` VARCHAR(300) NULL,
    `job` VARCHAR(100) NULL,
    `resource` VARCHAR(300) NULL,
    `value` DOUBLE NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `version` VARCHAR(32) NULL,
    `browser` VARCHAR(60) NULL,
    `system` VARCHAR(40) NULL,
    `screen` VARCHAR(20) NULL,
    `userId` VARCHAR(191) NULL,
    `signedIn` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `error_events_groupId_at_idx`(`groupId`, `at`),
    INDEX `error_events_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `error_events` ADD CONSTRAINT `error_events_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `error_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
