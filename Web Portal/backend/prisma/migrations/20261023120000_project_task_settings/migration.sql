-- AlterTable
ALTER TABLE `projects` ADD COLUMN `carryForward` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `defaultDueToday` BOOLEAN NOT NULL DEFAULT false;
