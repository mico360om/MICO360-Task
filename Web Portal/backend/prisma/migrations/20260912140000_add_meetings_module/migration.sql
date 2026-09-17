-- Meetings module: meetings, attendees, agenda, notes (+attachments/comments/checklist), action items,
-- decisions (+participants/attachments), minutes, templates. Generated via prisma migrate diff (MySQL).

-- CreateTable
CREATE TABLE `meetings` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `projectId` VARCHAR(191) NULL,
    `organizerId` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `onlineLink` VARCHAR(191) NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NULL,
    `timeZone` VARCHAR(191) NULL,
    `recurrenceRule` JSON NULL,
    `recurrenceParentId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,
    `transcript` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `meetings_projectId_idx`(`projectId`),
    INDEX `meetings_organizerId_idx`(`organizerId`),
    INDEX `meetings_status_idx`(`status`),
    INDEX `meetings_startAt_idx`(`startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_attendees` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `externalName` VARCHAR(191) NULL,
    `externalEmail` VARCHAR(191) NULL,
    `role` ENUM('REQUIRED', 'OPTIONAL') NOT NULL DEFAULT 'REQUIRED',
    `attendance` ENUM('INVITED', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED') NOT NULL DEFAULT 'INVITED',
    `department` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `meeting_attendees_meetingId_idx`(`meetingId`),
    INDEX `meeting_attendees_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenda_items` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `expectedMinutes` INTEGER NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `linkedPrevActionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agenda_items_meetingId_idx`(`meetingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_notes` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `agendaItemId` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `type` ENUM('DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION') NOT NULL DEFAULT 'DISCUSSION',
    `body` TEXT NOT NULL,
    `highlighted` BOOLEAN NOT NULL DEFAULT false,
    `taskId` VARCHAR(191) NULL,
    `actionItemId` VARCHAR(191) NULL,
    `decisionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    INDEX `meeting_notes_meetingId_idx`(`meetingId`),
    INDEX `meeting_notes_agendaItemId_idx`(`agendaItemId`),
    INDEX `meeting_notes_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_note_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `noteId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `meeting_note_attachments_noteId_idx`(`noteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_note_comments` (
    `id` VARCHAR(191) NOT NULL,
    `noteId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `meeting_note_comments_noteId_idx`(`noteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_note_checklist_items` (
    `id` VARCHAR(191) NOT NULL,
    `noteId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `done` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `meeting_note_checklist_items_noteId_idx`(`noteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `action_items` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NULL,
    `agendaItemId` VARCHAR(191) NULL,
    `sourceNoteId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `dueDate` DATETIME(3) NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `taskId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `action_items_meetingId_idx`(`meetingId`),
    INDEX `action_items_projectId_idx`(`projectId`),
    INDEX `action_items_assigneeId_idx`(`assigneeId`),
    INDEX `action_items_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decisions` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `decidedOn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `meetingId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `ownerId` VARCHAR(191) NULL,
    `status` ENUM('PROPOSED', 'DECIDED', 'SUPERSEDED', 'CANCELLED') NOT NULL DEFAULT 'DECIDED',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `decisions_meetingId_idx`(`meetingId`),
    INDEX `decisions_projectId_idx`(`projectId`),
    INDEX `decisions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decision_participants` (
    `decisionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `decision_participants_userId_idx`(`userId`),
    PRIMARY KEY (`decisionId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decision_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `decisionId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `decision_attachments_decisionId_idx`(`decisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_minutes` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'SENT') NOT NULL DEFAULT 'DRAFT',
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,

    UNIQUE INDEX `meeting_minutes_meetingId_key`(`meetingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_templates` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `defaults` JSON NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `meeting_templates_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `meeting_attendees` ADD CONSTRAINT `meeting_attendees_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_items` ADD CONSTRAINT `agenda_items_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meeting_notes` ADD CONSTRAINT `meeting_notes_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meeting_notes` ADD CONSTRAINT `meeting_notes_agendaItemId_fkey` FOREIGN KEY (`agendaItemId`) REFERENCES `agenda_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meeting_note_attachments` ADD CONSTRAINT `meeting_note_attachments_noteId_fkey` FOREIGN KEY (`noteId`) REFERENCES `meeting_notes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meeting_note_comments` ADD CONSTRAINT `meeting_note_comments_noteId_fkey` FOREIGN KEY (`noteId`) REFERENCES `meeting_notes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meeting_note_checklist_items` ADD CONSTRAINT `meeting_note_checklist_items_noteId_fkey` FOREIGN KEY (`noteId`) REFERENCES `meeting_notes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `action_items` ADD CONSTRAINT `action_items_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `action_items` ADD CONSTRAINT `action_items_agendaItemId_fkey` FOREIGN KEY (`agendaItemId`) REFERENCES `agenda_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `decisions` ADD CONSTRAINT `decisions_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `decision_participants` ADD CONSTRAINT `decision_participants_decisionId_fkey` FOREIGN KEY (`decisionId`) REFERENCES `decisions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `decision_attachments` ADD CONSTRAINT `decision_attachments_decisionId_fkey` FOREIGN KEY (`decisionId`) REFERENCES `decisions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meeting_minutes` ADD CONSTRAINT `meeting_minutes_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
