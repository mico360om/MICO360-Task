-- Inspection checklists: a reopen keeps the signatures it takes off (additive).

-- When an inspection was last reopened, and by whom (the staff report says so; the client copy says when).
ALTER TABLE `inspections` ADD COLUMN `reopenedAt` DATETIME(3) NULL,
    ADD COLUMN `reopenedById` VARCHAR(191) NULL;

-- Each signature belongs to the revision it signed; a reopen marks it superseded instead of deleting it.
ALTER TABLE `inspection_signatures` ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `supersededAt` DATETIME(3) NULL;

-- One signature per role per revision. The new key is made before the old one goes: the old one also
-- serves the foreign key on inspectionId, which MySQL won't leave without an index.
CREATE UNIQUE INDEX `inspection_signatures_inspectionId_revision_role_key` ON `inspection_signatures`(`inspectionId`, `revision`, `role`);
DROP INDEX `inspection_signatures_inspectionId_role_key` ON `inspection_signatures`;
