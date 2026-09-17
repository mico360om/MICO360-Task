-- AlterTable: track when meeting invitations and reminders were sent (calendar/.ics + reminder sweep)
ALTER TABLE `meetings`
  ADD COLUMN `invitesSentAt` DATETIME(3) NULL,
  ADD COLUMN `reminderSentAt` DATETIME(3) NULL;
