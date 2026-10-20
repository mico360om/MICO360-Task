-- A task made from a meeting's Live note remembers that meeting, so the task links back to it.
ALTER TABLE `tasks` ADD COLUMN `meetingId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `tasks_meetingId_idx` ON `tasks`(`meetingId`);

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Tasks already made from a note link to that note's meeting.
UPDATE `tasks` AS t
  JOIN `meeting_notes` AS n ON n.`taskId` = t.`id`
  SET t.`meetingId` = n.`meetingId`
  WHERE t.`meetingId` IS NULL;
