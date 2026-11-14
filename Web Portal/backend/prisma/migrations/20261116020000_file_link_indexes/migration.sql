-- 1.23.29 Private file links: on every download a stored file's rows are found by its stored name.
-- CreateIndex
CREATE INDEX `task_attachments_storageKey_idx` ON `task_attachments`(`storageKey`);

-- CreateIndex
CREATE INDEX `chat_attachments_storageKey_idx` ON `chat_attachments`(`storageKey`);
