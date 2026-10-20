-- A refresh token remembers (sealed) the token it was rotated to, so a lost refresh reply can be
-- retried for a short while without signing the person out.
ALTER TABLE `refresh_tokens` ADD COLUMN `successorEnc` TEXT NULL;
