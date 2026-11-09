-- 1.23.7 Granular Client Portal permissions, add-only. Nothing changes for anyone until the backfill (next
-- migration) and the new server use these: constant defaults only (MySQL 8 and MariaDB alike).

-- A client's role on each project (Viewer / Contributor / Approver / Custom) and two new permissions:
-- upload documents, receive notifications. `role` is NULL only on a grant from before 1.23.7 until the
-- backfill makes it CUSTOM (exactly its current access, with notifications on).
ALTER TABLE `client_project_grants` ADD COLUMN `canNotify` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `canUpload` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `role` ENUM('VIEWER', 'CONTRIBUTOR', 'APPROVER', 'CUSTOM') NULL;

-- A task's file uploaded by a client in the Client portal, and the team's "Show to client" tick on any file.
-- Both start false: no existing file is shown to a client.
ALTER TABLE `task_attachments` ADD COLUMN `clientVisible` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `fromClient` BOOLEAN NOT NULL DEFAULT false;

-- A client account's portal bell.
CREATE TABLE `client_notices` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `meetingId` VARCHAR(191) NULL,
    `attachmentId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(500) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_notices_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `client_notices_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Which kinds of notice a client wants (no row: every kind on).
CREATE TABLE `client_notice_settings` (
    `userId` VARCHAR(191) NOT NULL,
    `reply` BOOLEAN NOT NULL DEFAULT true,
    `signOff` BOOLEAN NOT NULL DEFAULT true,
    `minutes` BOOLEAN NOT NULL DEFAULT true,
    `document` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `client_notices` ADD CONSTRAINT `client_notices_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `client_notices` ADD CONSTRAINT `client_notices_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `client_notice_settings` ADD CONSTRAINT `client_notice_settings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
