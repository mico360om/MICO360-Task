-- Live notes can be formatted (bold, italic, underline, highlight, links, a heading, lists).
-- Existing notes stay plain text.
ALTER TABLE `meeting_notes` ADD COLUMN `bodyFormat` ENUM('PLAIN', 'RICH') NOT NULL DEFAULT 'PLAIN';
