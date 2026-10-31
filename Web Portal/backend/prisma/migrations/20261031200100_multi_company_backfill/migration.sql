-- Companies backfill (data only): everything on the site today goes into the first company,
-- "Prolens Projects LLC" (code PPL), so nothing anyone sees changes. Its settings are left empty,
-- which means "use the site's" (System Settings, MAIL_FROM, the built-in logo).
-- Every statement is safe to run again: it only fills in what is still missing, and leaves people,
-- projects and meetings that already have a company alone. The rehearsal script and the tests run
-- this file a second time and check that nothing changes.
-- Times are written in UTC (UTC_TIMESTAMP), as Prisma writes them; CURRENT_TIMESTAMP is the
-- server's local time, which would make the first company look newer than companies made later.

-- 1. The first company, only when there is none yet (a fresh install gets it too).
INSERT INTO `companies` (`id`, `name`, `code`, `status`, `createdAt`, `updatedAt`)
SELECT 'company_prolens', 'Prolens Projects LLC', 'PPL', 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `companies`);

-- 2. Everyone with no company (admins, inactive and deleted people too) joins it.
INSERT IGNORE INTO `company_members` (`companyId`, `userId`, `addedAt`)
SELECT c.`id`, u.`id`, UTC_TIMESTAMP(3)
FROM `users` u
JOIN `companies` c ON c.`id` = 'company_prolens'
WHERE NOT EXISTS (SELECT 1 FROM `company_members` cm WHERE cm.`userId` = u.`id`);

-- 3. Every project with no company (deleted ones too) belongs to it.
INSERT IGNORE INTO `project_companies` (`projectId`, `companyId`, `addedAt`)
SELECT p.`id`, c.`id`, UTC_TIMESTAMP(3)
FROM `projects` p
JOIN `companies` c ON c.`id` = 'company_prolens'
WHERE NOT EXISTS (SELECT 1 FROM `project_companies` pc WHERE pc.`projectId` = p.`id`);

-- 4. A project's main company: the company it was added to first.
UPDATE `projects` p
SET p.`mainCompanyId` = (
  SELECT pc.`companyId` FROM `project_companies` pc WHERE pc.`projectId` = p.`id` ORDER BY pc.`addedAt`, pc.`companyId` LIMIT 1
)
WHERE p.`mainCompanyId` IS NULL
  AND EXISTS (SELECT 1 FROM `project_companies` pc2 WHERE pc2.`projectId` = p.`id`);

-- 5. A person's primary company: the company they joined first.
UPDATE `users` u
SET u.`primaryCompanyId` = (
  SELECT cm.`companyId` FROM `company_members` cm WHERE cm.`userId` = u.`id` ORDER BY cm.`addedAt`, cm.`companyId` LIMIT 1
)
WHERE u.`primaryCompanyId` IS NULL
  AND EXISTS (SELECT 1 FROM `company_members` cm2 WHERE cm2.`userId` = u.`id`);

-- 6. A meeting without a project: its organizer's primary company, else the oldest company.
UPDATE `meetings` m
LEFT JOIN `users` o ON o.`id` = m.`organizerId`
SET m.`companyId` = COALESCE(o.`primaryCompanyId`, (SELECT c.`id` FROM `companies` c ORDER BY c.`createdAt`, c.`id` LIMIT 1))
WHERE m.`projectId` IS NULL
  AND m.`companyId` IS NULL;

-- 7. The project each notification is about: a task's project, a project, or a project channel's project.
UPDATE `notifications` n
JOIN `tasks` t ON t.`id` = n.`entityId`
SET n.`projectId` = t.`projectId`
WHERE n.`projectId` IS NULL
  AND n.`entityType` = 'task';

UPDATE `notifications` n
JOIN `projects` p ON p.`id` = n.`entityId`
SET n.`projectId` = p.`id`
WHERE n.`projectId` IS NULL
  AND n.`entityType` = 'project';

UPDATE `notifications` n
JOIN `conversations` cv ON cv.`id` = n.`entityId`
SET n.`projectId` = cv.`projectId`
WHERE n.`projectId` IS NULL
  AND n.`entityType` = 'conversation'
  AND cv.`projectId` IS NOT NULL;
