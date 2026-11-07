-- 1.23.8 Visual consistency: each person's own (add-only, MariaDB 11 and MySQL 8 alike).
--  * sidebarCollapsed: the website's side menu folded to its icons on a desktop screen (open by default);
--  * boardColumnWidth: the Kanban board's column width, 'narrow' | 'normal' | 'wide' (normal by default).
-- The row mode (users.density, VARCHAR(16)) also takes 'detailed' now: no column change needed.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `sidebarCollapsed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `boardColumnWidth` VARCHAR(16) NOT NULL DEFAULT 'normal';
