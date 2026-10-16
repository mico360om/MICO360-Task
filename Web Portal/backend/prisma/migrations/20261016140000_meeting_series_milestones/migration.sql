-- Repeating meetings: each meeting of a series remembers the start its rule gave it, and a
-- series has one meeting per start (so creating the next meetings twice can't duplicate them).
ALTER TABLE `meetings` ADD COLUMN `recurrenceStart` DATETIME(3) NULL;
CREATE UNIQUE INDEX `meetings_recurrenceParentId_recurrenceStart_key` ON `meetings`(`recurrenceParentId`, `recurrenceStart`);

-- Milestones: a task can be marked as a key date or deliverable of its project.
ALTER TABLE `tasks` ADD COLUMN `isMilestone` BOOLEAN NOT NULL DEFAULT false;
