-- 1.22.1: who last changed what a meeting note says (the author, the organizer or an administrator).
ALTER TABLE `meeting_notes` ADD COLUMN `editedById` VARCHAR(191) NULL;
