-- Review fix #17 (batch 4b, 13 Nov 2026): one direct conversation per pair of people. Each DIRECT
-- conversation made from now on carries its pair's key ("<smaller user id>:<larger user id>"), unique, so
-- two people starting a chat with each other at the same moment get the same one. Add-only: a nullable
-- column (project channels, and a pair's extra conversations made before this, keep it empty) and its
-- unique index (any number of empty ones allowed). The next migration fills it in for existing chats.

-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `directKey` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `conversations_directKey_key` ON `conversations`(`directKey`);
