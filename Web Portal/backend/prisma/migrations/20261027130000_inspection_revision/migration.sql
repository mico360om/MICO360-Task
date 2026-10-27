-- Inspection checklists: a revision that each reopen moves on (additive).
-- A finish carries the revision it was signed at; one signed before a reopen is refused, so a finish
-- whose reply was lost can't finish a reopened inspection again with the old signatures.
ALTER TABLE `inspections` ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0;
