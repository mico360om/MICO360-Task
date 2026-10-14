-- Attendees answer their invitation (Accept / Maybe / Decline) separately from their role
-- (Required / Optional) and from attendance on the day. invitedAt records when this person's own
-- invitation was delivered, so people added later can be invited without re-sending to everyone.
ALTER TABLE `meeting_attendees`
  ADD COLUMN `response` ENUM('PENDING', 'ACCEPTED', 'TENTATIVE', 'DECLINED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `respondedAt` DATETIME(3) NULL,
  ADD COLUMN `invitedAt` DATETIME(3) NULL;

-- People already on a meeting when its invitations went out were invited then.
UPDATE `meeting_attendees` a
JOIN `meetings` m ON m.`id` = a.`meetingId`
SET a.`invitedAt` = m.`invitesSentAt`
WHERE m.`invitesSentAt` IS NOT NULL AND a.`createdAt` <= m.`invitesSentAt`;
