-- Compact / comfortable rows (1.23.0): each person's own choice of how dense the website's lists,
-- tables and boards are. Comfortable (today's look) for everyone until they pick compact; phones and
-- touch screens always stay comfortable.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `density` VARCHAR(16) NOT NULL DEFAULT 'comfortable';
