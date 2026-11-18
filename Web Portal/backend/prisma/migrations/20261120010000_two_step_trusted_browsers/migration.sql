-- Two-step sign-in for administrators (1.24.0): the browsers an administrator trusted at the code step.
-- The browser keeps a signed cookie naming its row. A row counts only while it isn't revoked ("Forget all
-- trusted browsers"), hasn't passed its 30 days and was made under the person's current session version.
-- Add-only (one new table), nothing existing changes.

-- CreateTable
CREATE TABLE `trusted_browsers` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionVersion` INTEGER NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    INDEX `trusted_browsers_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `trusted_browsers` ADD CONSTRAINT `trusted_browsers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
