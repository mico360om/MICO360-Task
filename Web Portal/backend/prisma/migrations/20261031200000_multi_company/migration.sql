-- Companies (additive): several companies on one site. A company table, who belongs to which company
-- (company_members), which companies each project belongs to (project_companies), and four new
-- nullable columns: a person's primary company, a project's main company, a no-project meeting's
-- company and the project a notification is about. Nothing existing changes; the next migration
-- (multi_company_backfill) puts everything that is there today into the first company.

-- AlterTable
ALTER TABLE `meetings` ADD COLUMN `companyId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `projectId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `mainCompanyId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `primaryCompanyId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `companies` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `logoUrl` VARCHAR(500) NULL,
    `weekStart` INTEGER NULL,
    `workingHours` JSON NULL,
    `senderName` VARCHAR(120) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `archivedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_name_key`(`name`),
    UNIQUE INDEX `companies_code_key`(`code`),
    INDEX `companies_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_members` (
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `addedById` VARCHAR(191) NULL,

    INDEX `company_members_userId_idx`(`userId`),
    PRIMARY KEY (`companyId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_companies` (
    `projectId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_companies_companyId_idx`(`companyId`),
    PRIMARY KEY (`projectId`, `companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `meetings_companyId_idx` ON `meetings`(`companyId`);

-- CreateIndex
CREATE INDEX `notifications_userId_projectId_idx` ON `notifications`(`userId`, `projectId`);

-- CreateIndex
CREATE INDEX `projects_mainCompanyId_idx` ON `projects`(`mainCompanyId`);

-- CreateIndex
CREATE INDEX `users_primaryCompanyId_idx` ON `users`(`primaryCompanyId`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_primaryCompanyId_fkey` FOREIGN KEY (`primaryCompanyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_members` ADD CONSTRAINT `company_members_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_members` ADD CONSTRAINT `company_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_companies` ADD CONSTRAINT `project_companies_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_companies` ADD CONSTRAINT `project_companies_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_mainCompanyId_fkey` FOREIGN KEY (`mainCompanyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meetings` ADD CONSTRAINT `meetings_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
