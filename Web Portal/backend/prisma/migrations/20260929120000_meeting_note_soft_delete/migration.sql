-- Meeting notes are soft-deleted so a delete can be undone (MTG-07). Deleted notes keep their row
-- with deletedAt set and are left out of the meeting, its minutes and search.
ALTER TABLE `meeting_notes` ADD COLUMN `deletedAt` DATETIME(3) NULL;
