-- Chat: each person's own settings for a conversation (favorite, archived, muted), when their app
-- last received it ("delivered"); replies; and a per-sender client id so a retried send is
-- recognised instead of creating a duplicate message. All columns are additive; existing
-- conversations and messages are unchanged.
ALTER TABLE `conversation_participants`
  ADD COLUMN `favorite` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `mutedAt` DATETIME(3) NULL,
  ADD COLUMN `lastDeliveredAt` DATETIME(3) NULL;

ALTER TABLE `chat_messages`
  ADD COLUMN `replyToId` VARCHAR(191) NULL,
  ADD COLUMN `clientId` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `chat_messages_conversationId_userId_clientId_key` ON `chat_messages`(`conversationId`, `userId`, `clientId`);
CREATE INDEX `chat_messages_replyToId_idx` ON `chat_messages`(`replyToId`);
