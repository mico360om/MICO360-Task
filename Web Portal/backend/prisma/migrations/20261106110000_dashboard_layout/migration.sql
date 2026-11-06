-- 1.23.4 Smarter Dashboard: each person's own arrangement of the Dashboard's widgets (shown or hidden,
-- their order, Small or Wide). Empty for everyone until they customize: they follow their group's
-- default (administrators' or everyone else's), which an administrator sets (system_settings
-- 'dashboard.defaultLayouts'; no table change). Add-only.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `dashboardLayout` JSON NULL;
