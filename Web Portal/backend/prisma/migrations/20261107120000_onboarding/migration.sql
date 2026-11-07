-- Onboarding (the release after 1.23.2), add-only: three new columns on users and one new table.
-- Nothing changes for anyone until the backfill (next migration) and the new sign-in step use them.

-- When a person's first invitation (welcome email) went, when the account became theirs (first sign-in, or
-- a password they set with an emailed link), and when they proved the mailbox is theirs. NULL means not yet.
ALTER TABLE `users` ADD COLUMN `invitedAt` DATETIME(3) NULL,
    ADD COLUMN `activatedAt` DATETIME(3) NULL,
    ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;

-- One sign-in challenge: the password was right, and a 6-digit code emailed to `sentTo` finishes the sign-in.
-- Only hashes are stored (the token's SHA-256, the code's keyed HMAC), never a code or a token.
CREATE TABLE `sign_in_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `sentTo` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `sends` INTEGER NOT NULL DEFAULT 1,
    `lastSentAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sign_in_challenges_tokenHash_key`(`tokenHash`),
    INDEX `sign_in_challenges_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sign_in_challenges` ADD CONSTRAINT `sign_in_challenges_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
