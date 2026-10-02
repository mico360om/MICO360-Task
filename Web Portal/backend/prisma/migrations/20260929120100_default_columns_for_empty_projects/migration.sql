-- Projects with no board columns (created before new projects got the default board) get the
-- default board, so they can be used. Projects that have any column are left untouched, and running
-- this on a database without such projects changes nothing. Mirrors DEFAULT_COLUMNS in
-- src/modules/projects/project-repository.ts.
INSERT INTO `kanban_columns` (`id`, `projectId`, `name`, `category`, `position`, `color`, `enabled`)
SELECT CONCAT('col', REPLACE(UUID(), '-', '')), p.`id`, d.`name`, d.`category`, d.`position`, d.`color`, true
FROM `projects` p
CROSS JOIN (
  SELECT 'Backlog' AS `name`, 'BACKLOG' AS `category`, 0 AS `position`, '#948985' AS `color`
  UNION ALL SELECT 'To Do', 'TODO', 1, '#3A6EA5'
  UNION ALL SELECT 'In Progress', 'IN_PROGRESS', 2, '#B87611'
  UNION ALL SELECT 'Review', 'REVIEW', 3, '#7A5AA8'
  UNION ALL SELECT 'Done', 'DONE', 4, '#2E7D53'
) d
WHERE NOT EXISTS (SELECT 1 FROM `kanban_columns` c WHERE c.`projectId` = p.`id`);
