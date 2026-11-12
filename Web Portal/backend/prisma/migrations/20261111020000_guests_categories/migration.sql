-- 1.24 Guests on tasks + task categories (additive: new tables and new nullable/defaulted columns only).
-- Guests: each company keeps a reusable list (guest_contacts); a task's external-contact rows become its
-- links to guests (task_external_contacts.guestId) and keep a copy of the guest's details, so the Android
-- app, the extension and an older server read them as before. Today's contacts are turned into guests by
-- the server when it starts (and by its minute sweep): rows with no guestId yet — nothing here moves data.
-- Categories: each project's own list (project_categories), a task's categories (task_categories), the
-- project's "Every task needs a category" switch (off) and a project template's list (JSON, null = none).
-- Portable: MySQL 8 and MariaDB (plain DDL, constant defaults only).

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `requireCategory` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `task_external_contacts` ADD COLUMN `guestId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `project_templates` ADD COLUMN `categories` JSON NULL;

-- CreateTable
CREATE TABLE `guest_contacts` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `company` VARCHAR(120) NULL,
    `designation` VARCHAR(120) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(40) NULL,
    `notes` VARCHAR(2000) NULL,
    `nameKey` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `retiredAt` DATETIME(3) NULL,
    `mergedIntoId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `guest_contacts_companyId_nameKey_idx`(`companyId`, `nameKey`),
    INDEX `guest_contacts_companyId_retiredAt_idx`(`companyId`, `retiredAt`),
    INDEX `guest_contacts_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_categories` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `nameKey` VARCHAR(160) NOT NULL,
    `color` VARCHAR(20) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `retiredAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_categories_projectId_position_idx`(`projectId`, `position`),
    UNIQUE INDEX `project_categories_projectId_nameKey_key`(`projectId`, `nameKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_categories` (
    `taskId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `addedById` VARCHAR(191) NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_categories_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`taskId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `task_external_contacts_guestId_idx` ON `task_external_contacts`(`guestId`);

-- AddForeignKey
ALTER TABLE `task_external_contacts` ADD CONSTRAINT `task_external_contacts_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guest_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_contacts` ADD CONSTRAINT `guest_contacts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_contacts` ADD CONSTRAINT `guest_contacts_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_categories` ADD CONSTRAINT `project_categories_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_categories` ADD CONSTRAINT `task_categories_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_categories` ADD CONSTRAINT `task_categories_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `project_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

