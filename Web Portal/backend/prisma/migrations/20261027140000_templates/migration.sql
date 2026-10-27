-- Templates (additive): company-wide starting points for new projects (a board, roles and standard
-- tasks) and for single tasks. Nothing else changes: a project made from a template keeps no link to
-- it, so changing or deleting a template never touches a project.

-- CreateTable: a project template; its board is a JSON list of { name, category, color }.
CREATE TABLE `project_templates` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `columns` JSON NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_templates_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: the roles a template's tasks name instead of a person ("Inspector").
CREATE TABLE `project_template_roles` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `project_template_roles_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: a template's standard tasks, due a number of days after the project's start (NULL: no date).
CREATE TABLE `project_template_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `dueOffsetDays` INTEGER NULL,
    `roleId` VARCHAR(191) NULL,
    `checklist` JSON NOT NULL,

    INDEX `project_template_tasks_templateId_position_idx`(`templateId`, `position`),
    INDEX `project_template_tasks_roleId_idx`(`roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: task templates (the New task form's "Start from a template").
CREATE TABLE `task_templates` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `checklist` JSON NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_templates_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: deleting a template deletes its roles and tasks; deleting a role leaves its tasks without one.
ALTER TABLE `project_template_roles` ADD CONSTRAINT `project_template_roles_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `project_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_template_tasks` ADD CONSTRAINT `project_template_tasks_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `project_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_template_tasks` ADD CONSTRAINT `project_template_tasks_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `project_template_roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
