-- The first task of a recurring series links to itself once it has a copy, so every app shows it as
-- part of its series after its repeat rule moves on to the newest copy. Repairs existing series.
UPDATE `tasks` t
JOIN (SELECT DISTINCT `recurrenceParentId` AS `id` FROM `tasks` WHERE `recurrenceParentId` IS NOT NULL) s ON s.`id` = t.`id`
SET t.`recurrenceParentId` = t.`id`
WHERE t.`recurrenceParentId` IS NULL;
