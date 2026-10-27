-- Inspection checklists (additive: five new tables, nothing existing changes).

-- CreateTable: checklist templates (forms). Deleting a form keeps the inspections made from it.
CREATE TABLE `inspection_forms` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `sections` JSON NOT NULL,
    `clientSignature` VARCHAR(10) NOT NULL DEFAULT 'NONE',
    `supervisorSignature` VARCHAR(10) NOT NULL DEFAULT 'NONE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `inspection_forms_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: inspections carried out on a project; each keeps a copy of its form's checklist.
CREATE TABLE `inspections` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NULL,
    `formVersion` INTEGER NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `structure` JSON NOT NULL,
    `place` VARCHAR(200) NULL,
    `taskId` VARCHAR(191) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS',
    `inspectorId` VARCHAR(191) NOT NULL,
    `startedById` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `finishId` VARCHAR(64) NULL,
    `itemCount` INTEGER NOT NULL DEFAULT 0,
    `passedCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `naCount` INTEGER NOT NULL DEFAULT 0,
    `clientVisible` BOOLEAN NOT NULL DEFAULT false,
    `clientVisibleProjectId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `inspections_projectId_deletedAt_idx`(`projectId`, `deletedAt`),
    INDEX `inspections_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: one answer per item; a write is kept only if it was made later on its device (editedAt).
CREATE TABLE `inspection_answers` (
    `id` VARCHAR(191) NOT NULL,
    `inspectionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(40) NOT NULL,
    `result` VARCHAR(4) NULL,
    `reading` VARCHAR(32) NULL,
    `note` TEXT NULL,
    `editedAt` DATETIME(3) NOT NULL,
    `answeredById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inspection_answers_inspectionId_itemId_key`(`inspectionId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: the signatures a finished inspection carries (at most one per role).
CREATE TABLE `inspection_signatures` (
    `id` VARCHAR(191) NOT NULL,
    `inspectionId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(12) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `method` VARCHAR(6) NOT NULL,
    `image` MEDIUMBLOB NULL,
    `signedAt` DATETIME(3) NOT NULL,
    `capturedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inspection_signatures_inspectionId_role_key`(`inspectionId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: the follow-up task of a failed item (at most one per item).
CREATE TABLE `inspection_follow_ups` (
    `id` VARCHAR(191) NOT NULL,
    `inspectionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(40) NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inspection_follow_ups_taskId_key`(`taskId`),
    UNIQUE INDEX `inspection_follow_ups_inspectionId_itemId_key`(`inspectionId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: deleting a project removes its inspections; a deleted form or task leaves them in place.
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `inspection_forms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspections` ADD CONSTRAINT `inspections_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_answers` ADD CONSTRAINT `inspection_answers_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_signatures` ADD CONSTRAINT `inspection_signatures_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_follow_ups` ADD CONSTRAINT `inspection_follow_ups_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_follow_ups` ADD CONSTRAINT `inspection_follow_ups_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
