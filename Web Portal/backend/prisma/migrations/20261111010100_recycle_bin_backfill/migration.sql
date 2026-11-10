-- Recycle Bin backfill (data only, owner 10 Nov 2026). Portable: MySQL 8 and MariaDB (no window
-- functions, no LIMIT inside IN, no RETURNING, numbers read only from digit-only text). Safe to run again:
-- each statement only fills what is still empty, or raises a mark to what is already used.

-- 1. Tasks deleted before the Recycle Bin go into it with a full 60 days from the day of the upgrade
--    (nothing disappears suddenly): erased at the end of the 60th day (UTC midnight). Who deleted them
--    was never recorded, so it stays unknown. Merged tasks are not deleted tasks: they are left alone.
UPDATE `tasks`
SET `binExpiresAt` = DATE_ADD(UTC_DATE(), INTERVAL 61 DAY)
WHERE `deletedAt` IS NOT NULL
  AND `mergedIntoId` IS NULL
  AND `binExpiresAt` IS NULL;

-- 2. Each project's highest task number used so far: its tasks' numbers (deleted and merged ones too) ...
UPDATE `projects` p
SET p.`taskNumberMark` = GREATEST(p.`taskNumberMark`, COALESCE((
  SELECT MAX(CAST(SUBSTRING_INDEX(t.`key`, '-', -1) AS UNSIGNED))
  FROM `tasks` t
  WHERE t.`projectId` = p.`id`
    AND LOCATE('-', t.`key`) > 0
    AND SUBSTRING_INDEX(t.`key`, '-', -1) REGEXP '^[0-9]{1,9}$'
), 0));

-- 3. ... and the old numbers of tasks that moved to another project or were merged (task_key_aliases).
UPDATE `projects` p
SET p.`taskNumberMark` = GREATEST(p.`taskNumberMark`, COALESCE((
  SELECT MAX(CAST(SUBSTRING_INDEX(a.`key`, '-', -1) AS UNSIGNED))
  FROM `task_key_aliases` a
  WHERE a.`projectId` = p.`id`
    AND LOCATE('-', a.`key`) > 0
    AND SUBSTRING_INDEX(a.`key`, '-', -1) REGEXP '^[0-9]{1,9}$'
), 0));
