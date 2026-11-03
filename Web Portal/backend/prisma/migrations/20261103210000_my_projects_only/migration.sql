-- "Show my projects only" (1.22): an administrator's own setting. When on, every list across the site
-- shows them only the projects they own, manage or are on the team of; opening one by its link and the
-- admin pages stay admin-wide. Off for everyone (nothing changes until an administrator turns it on).

-- AlterTable
ALTER TABLE `users` ADD COLUMN `myProjectsOnly` BOOLEAN NOT NULL DEFAULT false;
