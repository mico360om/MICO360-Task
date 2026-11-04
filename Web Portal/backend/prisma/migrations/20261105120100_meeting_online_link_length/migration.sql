-- 1.23: a meeting's online link may be as long as the API has always allowed (2048 characters) — a
-- Microsoft Teams join link is about 250, more than the old 191. Only widens the column: nothing is
-- lost, and the previous version runs on it unchanged.

-- AlterTable
ALTER TABLE `meetings` MODIFY `onlineLink` VARCHAR(2048) NULL;
