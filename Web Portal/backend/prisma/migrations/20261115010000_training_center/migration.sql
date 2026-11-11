-- Training Center (owner, 11 Nov 2026): courses, lessons, guide steps, private training files, quizzes,
-- assignments (following group membership), enrolments, progress, quiz attempts, certificates, onboarding
-- rules and feedback; on users: Reports to, the Training manager permission and the first-time tour.
-- Add-only; constant defaults only (MySQL 8 and MariaDB alike). Starter courses are loaded once by the
-- server after the upgrade (marked starterKey), not here.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `reportsToId` VARCHAR(191) NULL,
    ADD COLUMN `tourDoneAt` DATETIME(3) NULL,
    ADD COLUMN `trainingManager` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `training_courses` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `summary` TEXT NULL,
    `moduleKey` VARCHAR(24) NOT NULL,
    `audience` VARCHAR(8) NOT NULL DEFAULT 'STAFF',
    `roleKeys` JSON NULL,
    `difficulty` VARCHAR(16) NOT NULL DEFAULT 'BEGINNER',
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `completionRule` VARCHAR(16) NOT NULL DEFAULT 'ALL_LESSONS',
    `inOrder` BOOLEAN NOT NULL DEFAULT false,
    `certificateOn` BOOLEAN NOT NULL DEFAULT false,
    `certificateMonths` INTEGER NULL,
    `issuerUserId` VARCHAR(191) NULL,
    `issuerTitle` VARCHAR(120) NULL,
    `signatureFileId` VARCHAR(191) NULL,
    `companyIds` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `majorAt` DATETIME(3) NULL,
    `starterKey` VARCHAR(64) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `training_courses_starterKey_key`(`starterKey`),
    INDEX `training_courses_status_idx`(`status`),
    INDEX `training_courses_moduleKey_idx`(`moduleKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_lessons` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `kind` VARCHAR(12) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `minutes` INTEGER NOT NULL DEFAULT 5,
    `body` TEXT NULL,
    `videoProvider` VARCHAR(8) NULL,
    `videoId` VARCHAR(32) NULL,
    `videoHash` VARCHAR(32) NULL,
    `videoUrl` VARCHAR(500) NULL,
    `fileId` VARCHAR(191) NULL,
    `changedVersion` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `training_lessons_courseId_position_idx`(`courseId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_steps` (
    `id` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(160) NULL,
    `body` TEXT NULL,
    `imageFileId` VARCHAR(191) NULL,
    `imageAlt` VARCHAR(200) NULL,

    INDEX `training_steps_lessonId_position_idx`(`lessonId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_files` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NULL,
    `kind` VARCHAR(12) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(200) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `starter` BOOLEAN NOT NULL DEFAULT false,
    `uploadedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `training_files_storageKey_key`(`storageKey`),
    INDEX `training_files_courseId_kind_idx`(`courseId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_quizzes` (
    `id` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(191) NOT NULL,
    `passMark` INTEGER NOT NULL DEFAULT 70,
    `maxAttempts` INTEGER NULL,
    `shuffle` BOOLEAN NOT NULL DEFAULT false,
    `timeLimitMinutes` INTEGER NULL,
    `drawCount` INTEGER NULL,

    UNIQUE INDEX `training_quizzes_lessonId_key`(`lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_questions` (
    `id` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `kind` VARCHAR(12) NOT NULL,
    `prompt` TEXT NOT NULL,
    `explanation` TEXT NULL,

    INDEX `training_questions_quizId_position_idx`(`quizId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_options` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `text` VARCHAR(500) NOT NULL,
    `correct` BOOLEAN NOT NULL DEFAULT false,
    `feedback` VARCHAR(500) NULL,

    INDEX `training_options_questionId_position_idx`(`questionId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `targetKind` VARCHAR(12) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `mandatory` BOOLEAN NOT NULL DEFAULT true,
    `dueDay` VARCHAR(10) NULL,
    `dueDays` INTEGER NULL,
    `ruleId` VARCHAR(191) NULL,
    `newAccountsOnly` BOOLEAN NOT NULL DEFAULT false,
    `scopeCompanyIds` JSON NULL,
    `frozenAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `withdrawnAt` DATETIME(3) NULL,
    `withdrawnById` VARCHAR(191) NULL,

    INDEX `training_assignments_courseId_idx`(`courseId`),
    INDEX `training_assignments_ruleId_idx`(`ruleId`),
    INDEX `training_assignments_withdrawnAt_idx`(`withdrawnAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_assignees` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `mandatory` BOOLEAN NOT NULL DEFAULT true,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDay` VARCHAR(10) NULL,
    `withdrawnAt` DATETIME(3) NULL,

    INDEX `training_assignees_userId_courseId_idx`(`userId`, `courseId`),
    INDEX `training_assignees_courseId_idx`(`courseId`),
    UNIQUE INDEX `training_assignees_assignmentId_userId_key`(`assignmentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_enrolments` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `selfStarted` BOOLEAN NOT NULL DEFAULT false,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `completedVersion` INTEGER NULL,
    `progressPct` INTEGER NOT NULL DEFAULT 0,
    `lastLessonId` VARCHAR(191) NULL,
    `lastActivityAt` DATETIME(3) NULL,
    `reviewFrom` DATETIME(3) NULL,
    `reviewDueDay` VARCHAR(10) NULL,
    `reviewDoneAt` DATETIME(3) NULL,
    `retakeFrom` DATETIME(3) NULL,
    `withdrawnAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `training_enrolments_courseId_idx`(`courseId`),
    UNIQUE INDEX `training_enrolments_userId_courseId_key`(`userId`, `courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_progress` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(191) NOT NULL,
    `doneAt` DATETIME(3) NULL,
    `videoSeconds` INTEGER NOT NULL DEFAULT 0,
    `videoDuration` INTEGER NULL,
    `watchedPct` INTEGER NOT NULL DEFAULT 0,
    `stepIndex` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `training_progress_userId_courseId_idx`(`userId`, `courseId`),
    UNIQUE INDEX `training_progress_userId_lessonId_key`(`userId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `paper` JSON NOT NULL,
    `answers` JSON NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deadlineAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `scorePct` INTEGER NULL,
    `passed` BOOLEAN NULL,

    INDEX `training_attempts_userId_lessonId_idx`(`userId`, `lessonId`),
    INDEX `training_attempts_quizId_idx`(`quizId`),
    INDEX `training_attempts_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_certificates` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(24) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `learnerName` VARCHAR(200) NOT NULL,
    `courseTitle` VARCHAR(160) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `scorePct` INTEGER NULL,
    `issuerName` VARCHAR(200) NULL,
    `issuerTitle` VARCHAR(120) NULL,
    `signatureFileId` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(200) NULL,
    `revokedById` VARCHAR(191) NULL,

    UNIQUE INDEX `training_certificates_code_key`(`code`),
    INDEX `training_certificates_userId_idx`(`userId`),
    INDEX `training_certificates_courseId_idx`(`courseId`),
    INDEX `training_certificates_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_rules` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `targetKind` VARCHAR(12) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `courseIds` JSON NOT NULL,
    `mandatory` BOOLEAN NOT NULL DEFAULT true,
    `dueDays` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `scopeCompanyIds` JSON NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `rating` INTEGER NULL,
    `body` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `answer` TEXT NULL,
    `answeredById` VARCHAR(191) NULL,
    `answeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `training_feedback_courseId_kind_idx`(`courseId`, `kind`),
    INDEX `training_feedback_status_kind_idx`(`status`, `kind`),
    INDEX `training_feedback_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `users_reportsToId_idx` ON `users`(`reportsToId`);

-- AddForeignKey
ALTER TABLE `training_lessons` ADD CONSTRAINT `training_lessons_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `training_courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_steps` ADD CONSTRAINT `training_steps_lessonId_fkey` FOREIGN KEY (`lessonId`) REFERENCES `training_lessons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_quizzes` ADD CONSTRAINT `training_quizzes_lessonId_fkey` FOREIGN KEY (`lessonId`) REFERENCES `training_lessons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_questions` ADD CONSTRAINT `training_questions_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `training_quizzes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_options` ADD CONSTRAINT `training_options_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `training_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

