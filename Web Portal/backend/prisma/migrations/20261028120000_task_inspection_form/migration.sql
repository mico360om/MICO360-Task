-- Scheduled inspections: a task can carry an inspection form (and where the check is done).
-- A repeating task with a form is a scheduled inspection; each copy keeps the form (additive).
ALTER TABLE `tasks` ADD COLUMN `inspectionFormId` VARCHAR(191) NULL,
    ADD COLUMN `inspectionPlace` VARCHAR(200) NULL;

-- CreateIndex
CREATE INDEX `tasks_inspectionFormId_idx` ON `tasks`(`inspectionFormId`);

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_inspectionFormId_fkey` FOREIGN KEY (`inspectionFormId`) REFERENCES `inspection_forms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
