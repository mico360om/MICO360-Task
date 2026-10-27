-- Scheduled inspections: a project's checks, and a repeating series' copies, found by index
-- (the Inspections tab's schedules and due checks, and the repeat's own count of its copies).
-- CreateIndex
CREATE INDEX `tasks_projectId_inspectionFormId_idx` ON `tasks`(`projectId`, `inspectionFormId`);

-- CreateIndex
CREATE INDEX `tasks_recurrenceParentId_idx` ON `tasks`(`recurrenceParentId`);
