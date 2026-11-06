-- Onboarding backfill (data only). No current user may be locked out by this release: everyone who has
-- already signed in counts as having a confirmed email address, so the new "enter the code we emailed you"
-- step never asks them. People who have never signed in confirm it at their first sign-in (only while the
-- server can send email - without email nothing is asked).
-- Every statement is safe to run again: it only fills in what is still empty and never changes a value
-- that is already set. Times are UTC (UTC_TIMESTAMP), as Prisma writes them.

-- 1. Signed in before (users.lastLoginAt): verified as of that sign-in.
UPDATE `users`
SET `emailVerifiedAt` = `lastLoginAt`
WHERE `emailVerifiedAt` IS NULL
  AND `lastLoginAt` IS NOT NULL;

-- 2. Belt and braces: anyone holding a session or a fingerprint key (a sign-in, whatever lastLoginAt says).
UPDATE `users`
SET `emailVerifiedAt` = UTC_TIMESTAMP(3)
WHERE `emailVerifiedAt` IS NULL
  AND EXISTS (SELECT 1 FROM `refresh_tokens` r WHERE r.`userId` = `users`.`id`);

-- 3. The account became theirs at their first known sign-in.
UPDATE `users`
SET `activatedAt` = COALESCE(`lastLoginAt`, `emailVerifiedAt`)
WHERE `activatedAt` IS NULL
  AND (`lastLoginAt` IS NOT NULL OR `emailVerifiedAt` IS NOT NULL);

-- 4. Invited: when their (last) welcome email went (the first one is not known for older sends).
UPDATE `users`
SET `invitedAt` = `welcomeSentAt`
WHERE `invitedAt` IS NULL
  AND `welcomeSentAt` IS NOT NULL;
