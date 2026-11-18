-- Appreciation note (1.24.1): the optional note for the manager an employee leaves when accepting an appreciation.
-- Add-only (one new nullable column), nothing existing changes.

-- AlterTable
ALTER TABLE `appreciations` ADD COLUMN `acceptNote` TEXT NULL;
