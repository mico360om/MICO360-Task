-- 1.23 Search everything (additive). Derived data only: the server fills these at startup and keeps
-- them fresh (`npm run search:rebuild` rebuilds them); nothing else changes.

-- Tasks: the normalised description on its own, so a match there ranks above one in a comment.
ALTER TABLE `task_search_index` ADD COLUMN `lead` MEDIUMBLOB NULL;

-- Everything else that is searched (projects, meetings, meeting notes, final minutes, task files and
-- inspections): one normalised text per item, in binary columns (LIKE compares bytes: fast, and exact
-- for normalised text). `limited` is what an invitee from another company may search of a meeting.
CREATE TABLE `search_index` (
    `kind` VARCHAR(16) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `meetingId` VARCHAR(191) NULL,
    `taskId` VARCHAR(191) NULL,
    `personId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NULL,
    `at` DATETIME(3) NULL,
    `head` BLOB NOT NULL,
    `lead` MEDIUMBLOB NULL,
    `doc` MEDIUMBLOB NOT NULL,
    `limited` MEDIUMBLOB NULL,
    `stamp` VARCHAR(512) NOT NULL,
    `version` INTEGER NOT NULL,
    `indexedAt` DATETIME(3) NOT NULL,

    INDEX `search_index_meetingId_idx`(`meetingId`),
    INDEX `search_index_taskId_idx`(`taskId`),
    INDEX `search_index_projectId_idx`(`projectId`),
    PRIMARY KEY (`kind`, `recordId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The text read from each task file (PDF, Word, Excel, PowerPoint, CSV, text — or by AI OCR), as
-- shown (capped at 200 KB), and how reading it went.
CREATE TABLE `search_file_texts` (
    `fileId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `method` VARCHAR(8) NULL,
    `text` MEDIUMTEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextTryAt` DATETIME(3) NULL,
    `error` VARCHAR(300) NULL,
    `readAt` DATETIME(3) NOT NULL,

    INDEX `search_file_texts_status_nextTryAt_idx`(`status`, `nextTryAt`),
    PRIMARY KEY (`fileId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `search_file_texts` ADD CONSTRAINT `search_file_texts_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `task_attachments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The words in the index (normalised), for the spelling-mistake pass.
CREATE TABLE `search_words` (
    `word` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,

    PRIMARY KEY (`word`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Meaning search (only when an embedding model is set up): one vector per item.
CREATE TABLE `search_embeddings` (
    `kind` VARCHAR(16) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `dims` INTEGER NOT NULL,
    `vector` MEDIUMBLOB NOT NULL,
    `textHash` VARCHAR(16) NOT NULL,
    `embeddedAt` DATETIME(3) NOT NULL,

    INDEX `search_embeddings_model_idx`(`model`),
    PRIMARY KEY (`kind`, `recordId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
