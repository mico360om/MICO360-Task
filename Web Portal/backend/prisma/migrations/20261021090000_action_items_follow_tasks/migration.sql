-- Meeting action items now follow the board task they are tracked as (completed when it is done).
-- Items whose task is already done are completed now, so the minutes and "My Action Items" agree.
UPDATE `action_items` AS a
  JOIN `tasks` AS t ON t.`id` = a.`taskId`
  JOIN `kanban_columns` AS c ON c.`id` = t.`columnId`
  SET a.`status` = 'COMPLETED',
      a.`completedAt` = COALESCE(t.`completedAt`, CURRENT_TIMESTAMP(3)),
      a.`progress` = 100,
      a.`updatedAt` = CURRENT_TIMESTAMP(3)
  WHERE c.`category` = 'DONE'
    AND t.`deletedAt` IS NULL
    AND a.`status` NOT IN ('COMPLETED', 'CANCELLED');
