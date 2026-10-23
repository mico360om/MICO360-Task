-- MICO AI: an answer's tool results kept apart from the answer, so reading a chat doesn't load them (additive).
-- AlterTable
ALTER TABLE `mico_ai_messages` ADD COLUMN `results` JSON NULL;

