-- Welcome emails: their "Set your password" link is a single-use token kept with the password-reset
-- links (login_otps), under its own purpose so it can last 7 days and be replaced on its own.
ALTER TABLE `login_otps` MODIFY `purpose` ENUM('LOGIN', 'PASSWORD_RESET', 'WELCOME') NOT NULL DEFAULT 'LOGIN';

-- Each person's last sign-in (password, emailed code or fingerprint; a token refresh doesn't count)
-- and when an administrator last sent them a welcome email.
ALTER TABLE `users` ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `welcomeSentAt` DATETIME(3) NULL;

-- People who signed in before this was recorded: their last sign-in is when their newest session
-- began. Every sign-in starts a session (a refresh-token family) and refreshes stay in it, so a
-- family's first token is a sign-in. Fingerprint keys (purpose 'biometric') are not sessions. Without
-- this, everyone would show "Never signed in" and could be picked for a welcome email by mistake.
UPDATE `users` u
JOIN (
  SELECT s.`userId`, MAX(s.`startedAt`) AS `lastLoginAt`
  FROM (
    SELECT `userId`, MIN(`createdAt`) AS `startedAt`
    FROM `refresh_tokens`
    WHERE `purpose` IS NULL
    GROUP BY `userId`, COALESCE(`familyId`, `id`)
  ) s
  GROUP BY s.`userId`
) latest ON latest.`userId` = u.`id`
SET u.`lastLoginAt` = latest.`lastLoginAt`
WHERE u.`lastLoginAt` IS NULL;
