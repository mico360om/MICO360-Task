-- 1.23.7 backfill (data only): every client grant from before 1.23.7 becomes Custom with exactly its current
-- access — nobody gains or loses anything — and "Receive notifications" on, so existing clients keep today's
-- emails (minutes, replies marked "Visible to client") and get the portal bell. Upload stays off.
-- Safe to run again: it touches only grants that have no role yet (every grant saved by 1.23.7 has one),
-- so a later choice (notifications turned off, a role picked) is never changed back.
UPDATE `client_project_grants`
SET `role` = 'CUSTOM',
    `canNotify` = true,
    `canUpload` = false
WHERE `role` IS NULL;
