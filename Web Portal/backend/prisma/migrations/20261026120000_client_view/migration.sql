-- Client view: a read-only page where a client follows one project without an account (additive).

-- What the client page may show: only tasks (milestones are tasks) and approved final minutes that
-- someone who runs the project marked. Nothing is shown by default.
ALTER TABLE `tasks` ADD COLUMN `clientVisible` BOOLEAN NOT NULL DEFAULT false;
-- Approved minutes are shown for the project they were marked on (re-filing the meeting hides them),
-- and their "Risks & open issues" only when that was ticked.
ALTER TABLE `meeting_minutes` ADD COLUMN `clientVisible` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `clientVisibleProjectId` VARCHAR(191) NULL,
    ADD COLUMN `clientShowRisks` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: the clients a project is shared with (one row per project and email address).
CREATE TABLE `client_shares` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `linkHash` CHAR(64) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `linkSentAt` DATETIME(3) NULL,
    `lastViewedAt` DATETIME(3) NULL,
    `lockoutNotedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_shares_linkHash_key`(`linkHash`),
    UNIQUE INDEX `client_shares_projectId_email_key`(`projectId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: one-time codes emailed to a shared client (hashed; kept apart from staff sign-in codes).
CREATE TABLE `client_access_codes` (
    `id` VARCHAR(191) NOT NULL,
    `shareId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(100) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_access_codes_shareId_createdAt_idx`(`shareId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: devices signed in to a client page (hashed cookie tokens, 30 days).
CREATE TABLE `client_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `shareId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_sessions_tokenHash_key`(`tokenHash`),
    INDEX `client_sessions_shareId_idx`(`shareId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: removing a client (or deleting the project) removes their codes and sessions at once.
ALTER TABLE `client_shares` ADD CONSTRAINT `client_shares_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `client_access_codes` ADD CONSTRAINT `client_access_codes_shareId_fkey` FOREIGN KEY (`shareId`) REFERENCES `client_shares`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `client_sessions` ADD CONSTRAINT `client_sessions_shareId_fkey` FOREIGN KEY (`shareId`) REFERENCES `client_shares`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
