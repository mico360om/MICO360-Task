-- users.tokenVersion: embedded in access tokens; bumping it revokes every outstanding access
-- token for that user (status / role change, delete, password change).
ALTER TABLE `users` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;

-- refresh_tokens.familyId: rotation family, so reuse of an already-rotated refresh token can
-- revoke the whole family.
ALTER TABLE `refresh_tokens` ADD COLUMN `familyId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `refresh_tokens_familyId_idx` ON `refresh_tokens`(`familyId`);

-- idempotency_keys: stored first responses for retried writes (Idempotency-Key header).
CREATE TABLE `idempotency_keys` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `responseBody` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idempotency_keys_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `idempotency_keys_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
