-- 1.23.5 Project overview & health: completion counted by weight. Each task may carry a weight (1–10
-- points; empty = its project's default for its priority, read live). Each project chooses how its
-- completion is counted — by the number of tasks (as before, the default: nothing changes until a
-- project switches) or by weight — and its four priority defaults (Urgent 4, High 3, Normal 2, Low 1).
-- Add-only; constant defaults only (MySQL 8 and MariaDB alike). The server checks the ranges.

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `weight` INTEGER NULL;

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `completionMode` ENUM('COUNT', 'WEIGHT') NOT NULL DEFAULT 'COUNT',
    ADD COLUMN `weightUrgent` INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN `weightHigh` INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN `weightNormal` INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN `weightLow` INTEGER NOT NULL DEFAULT 1;
