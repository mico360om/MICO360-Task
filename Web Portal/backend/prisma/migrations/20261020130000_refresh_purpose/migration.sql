-- A phone's fingerprint sign-in key is a refresh token marked 'biometric', so it can be found to be
-- cancelled (a stolen session) and moved on (30 days from the person's last use of the app).
ALTER TABLE `refresh_tokens` ADD COLUMN `purpose` VARCHAR(16) NULL;
