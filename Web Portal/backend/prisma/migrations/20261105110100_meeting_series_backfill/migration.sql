-- 1.23 Meeting series backfill (data only): every existing repeating meeting is in a series of its own.
-- One series per repeat family (its first meeting and the meetings made from it) and place (the
-- project, or the company of meetings without a project), named after its earliest meeting still
-- there, and marked `auto`. A family that was split earlier (a new schedule for a series that had
-- started) is two families, so it becomes two series; the series page's "Merge another series into
-- this one" joins them. Deleted meetings are left alone.
-- Safe to run again: the series ids come from the family and place ('ms_' + md5), series already there
-- are kept (INSERT IGNORE), and only meetings in no series yet are linked. The DB test runs this file a
-- second time and checks that nothing changes. Times are written in UTC, as Prisma writes them.

-- 1. The series: one row per family and place, from that group's earliest meeting.
INSERT IGNORE INTO `meeting_series` (`id`, `name`, `projectId`, `companyId`, `auto`, `createdById`, `createdAt`, `updatedAt`)
SELECT
  CONCAT('ms_', MD5(CONCAT(COALESCE(m.`recurrenceParentId`, m.`id`), '|', COALESCE(m.`projectId`, CONCAT('c:', COALESCE(m.`companyId`, '')))))),
  LEFT(m.`title`, 200),
  m.`projectId`,
  IF(m.`projectId` IS NULL, m.`companyId`, NULL),
  true,
  m.`createdById`,
  UTC_TIMESTAMP(3),
  UTC_TIMESTAMP(3)
FROM `meetings` m
WHERE m.`deletedAt` IS NULL
  AND m.`seriesId` IS NULL
  AND (m.`recurrenceParentId` IS NOT NULL OR (m.`recurrenceRule` IS NOT NULL AND CAST(m.`recurrenceRule` AS CHAR) <> 'null'))
  AND NOT EXISTS (
    SELECT 1 FROM `meetings` e
    WHERE e.`deletedAt` IS NULL
      AND (e.`recurrenceParentId` IS NOT NULL OR (e.`recurrenceRule` IS NOT NULL AND CAST(e.`recurrenceRule` AS CHAR) <> 'null'))
      AND (e.`id` = COALESCE(m.`recurrenceParentId`, m.`id`) OR e.`recurrenceParentId` = COALESCE(m.`recurrenceParentId`, m.`id`))
      AND e.`projectId` <=> m.`projectId`
      AND (m.`projectId` IS NOT NULL OR e.`companyId` <=> m.`companyId`)
      AND (e.`startAt` < m.`startAt` OR (e.`startAt` = m.`startAt` AND e.`id` < m.`id`))
  );

-- 2. Each repeating meeting into its family's series.
UPDATE `meetings` m
JOIN `meeting_series` s
  ON s.`id` = CONCAT('ms_', MD5(CONCAT(COALESCE(m.`recurrenceParentId`, m.`id`), '|', COALESCE(m.`projectId`, CONCAT('c:', COALESCE(m.`companyId`, ''))))))
SET m.`seriesId` = s.`id`
WHERE m.`deletedAt` IS NULL
  AND m.`seriesId` IS NULL
  AND (m.`recurrenceParentId` IS NOT NULL OR (m.`recurrenceRule` IS NOT NULL AND CAST(m.`recurrenceRule` AS CHAR) <> 'null'));
