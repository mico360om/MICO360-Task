-- 1.23.3 Nested checklists backfill (data only): every task that has checklist items gets one checklist
-- titled "Checklist", and its items go into it in their order (positions unchanged, all top level).
-- Safe to run again: the checklist's id comes from the task ('ckl' + its id) and is only added when the
-- task has no live checklist yet (INSERT IGNORE), and only items in no checklist are moved. The DB test
-- runs this file a second time and checks that nothing changes. Times are written in UTC, as Prisma
-- writes them. Portable: MySQL 8 and MariaDB (no window functions, no LIMIT inside IN).

-- 1. One "Checklist" per task with items in no checklist and no live checklist of its own.
INSERT IGNORE INTO `task_checklist_lists` (`id`, `taskId`, `title`, `position`, `createdById`, `createdAt`, `updatedAt`)
SELECT
  CONCAT('ckl', c.`taskId`),
  c.`taskId`,
  'Checklist',
  0,
  NULL,
  MIN(c.`createdAt`),
  UTC_TIMESTAMP(3)
FROM `task_checklists` c
WHERE c.`listId` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `task_checklist_lists` l
    WHERE l.`taskId` = c.`taskId` AND l.`deletedAt` IS NULL
  )
GROUP BY c.`taskId`;

-- 2. Each item in no checklist into its task's first live checklist.
UPDATE `task_checklists` c
SET c.`listId` = (
  SELECT l.`id` FROM `task_checklist_lists` l
  WHERE l.`taskId` = c.`taskId` AND l.`deletedAt` IS NULL
  ORDER BY l.`position` ASC, l.`createdAt` ASC, l.`id` ASC
  LIMIT 1
)
WHERE c.`listId` IS NULL
  AND EXISTS (
    SELECT 1 FROM `task_checklist_lists` l2
    WHERE l2.`taskId` = c.`taskId` AND l2.`deletedAt` IS NULL
  );
