-- Review fix #17 backfill (data only, batch 4b). Each existing DIRECT conversation of exactly two people
-- gets its pair's key ("<smaller user id>:<larger user id>", ids compared byte by byte, as the server does).
-- A pair that already has more than one conversation (made at the same moment before the key existed)
-- gets the key on ONE of them: the one with the most messages, then the oldest (createdAt, then id). Its
-- other conversations are left exactly as they are, without the key: nothing is deleted or merged, every
-- message stays where it was, and they stay in both people's chat lists. A conversation of one person or
-- of more than two is left alone too.
--
-- How the one is chosen: the rows are updated in that order, and UPDATE IGNORE skips a row whose key the
-- unique index already holds (a warning, not an error). Portable: MySQL 8 and MariaDB (no window
-- functions, no CTE, no LIMIT inside IN; the subqueries read other tables only). Safe to run again: only
-- conversations still without a key are looked at, and a pair's key is never given twice.
UPDATE IGNORE `conversations`
SET `directKey` = (
  SELECT CONVERT(CONCAT(MIN(CAST(p.`userId` AS BINARY)), ':', MAX(CAST(p.`userId` AS BINARY))) USING utf8mb4)
  FROM `conversation_participants` p
  WHERE p.`conversationId` = `conversations`.`id`
)
WHERE `kind` = 'DIRECT'
  AND `directKey` IS NULL
  AND (SELECT COUNT(*) FROM `conversation_participants` p2 WHERE p2.`conversationId` = `conversations`.`id`) = 2
ORDER BY (SELECT COUNT(*) FROM `chat_messages` m WHERE m.`conversationId` = `conversations`.`id`) DESC, `createdAt` ASC, `id` ASC;
