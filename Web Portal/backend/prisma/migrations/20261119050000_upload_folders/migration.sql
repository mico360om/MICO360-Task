-- 1.23.38 Upload folders: old stored names and where their files moved (add-only; the files are moved by
-- the server after the upgrade, not here).

-- CreateTable
CREATE TABLE `file_key_aliases` (
    `id` VARCHAR(191) NOT NULL,
    `area` VARCHAR(16) NOT NULL,
    `oldKey` VARCHAR(200) NOT NULL,
    `newKey` VARCHAR(200) NOT NULL,
    `movedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `originalRemovedAt` DATETIME(3) NULL,

    INDEX `file_key_aliases_originalRemovedAt_movedAt_idx`(`originalRemovedAt`, `movedAt`),
    UNIQUE INDEX `file_key_aliases_area_oldKey_key`(`area`, `oldKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
