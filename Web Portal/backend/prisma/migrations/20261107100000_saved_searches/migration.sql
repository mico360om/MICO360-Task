-- 1.23.6 Advanced search & smart filters (additive): saved searches — a person's search (the words as
-- typed, the page's filters, the reader's chips taken off) under a name, optionally shared with one
-- project's team — and the ones each person pinned to the side menu (up to 5). Nothing else changes.

-- CreateTable
CREATE TABLE `saved_searches` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `q` VARCHAR(200) NOT NULL,
    `filters` JSON NULL,
    `projectId` VARCHAR(191) NULL,
    `sharedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `saved_searches_ownerId_idx`(`ownerId`),
    INDEX `saved_searches_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_search_pins` (
    `userId` VARCHAR(191) NOT NULL,
    `savedSearchId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `saved_search_pins_savedSearchId_idx`(`savedSearchId`),
    PRIMARY KEY (`userId`, `savedSearchId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `saved_searches` ADD CONSTRAINT `saved_searches_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_searches` ADD CONSTRAINT `saved_searches_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_search_pins` ADD CONSTRAINT `saved_search_pins_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_search_pins` ADD CONSTRAINT `saved_search_pins_savedSearchId_fkey` FOREIGN KEY (`savedSearchId`) REFERENCES `saved_searches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
