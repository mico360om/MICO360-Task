-- External contacts on tasks (additive): the people outside the company who are responsible for a
-- task — name, company, designation, email, phone and remarks — kept apart from its assignees. Each
-- task keeps its own copies (no shared address book). Nothing else changes: existing tasks have none.

-- CreateTable
CREATE TABLE `task_external_contacts` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `company` VARCHAR(120) NULL,
    `designation` VARCHAR(120) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(40) NULL,
    `remarks` VARCHAR(1000) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_external_contacts_taskId_position_idx`(`taskId`, `position`),
    INDEX `task_external_contacts_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_external_contacts` ADD CONSTRAINT `task_external_contacts_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_external_contacts` ADD CONSTRAINT `task_external_contacts_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
