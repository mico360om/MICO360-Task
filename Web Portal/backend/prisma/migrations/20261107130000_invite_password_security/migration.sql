-- 1.23.6 Invitation & temporary password security, add-only: five new columns on users (and the index and
-- key of the one that points at a person). Nothing changes for anyone already here: the flag starts false,
-- so no existing account is ever asked to change its password.

-- A temporary password must be changed at the first sign-in (set only for new temporary passwords). Who
-- set it and when (never the value), and when it stops working unused. invitationCancelledAt: an
-- administrator cancelled the invitation (no way in until a new invitation or a temporary password).
ALTER TABLE `users` ADD COLUMN `invitationCancelledAt` DATETIME(3) NULL,
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `temporaryPasswordExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `temporaryPasswordSetAt` DATETIME(3) NULL,
    ADD COLUMN `temporaryPasswordSetById` VARCHAR(191) NULL;

CREATE INDEX `users_temporaryPasswordSetById_idx` ON `users`(`temporaryPasswordSetById`);

ALTER TABLE `users` ADD CONSTRAINT `users_temporaryPasswordSetById_fkey` FOREIGN KEY (`temporaryPasswordSetById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
