-- Task approvals (1.19.0): a task can need the OK of whoever runs its project before it counts as
-- done; while it waits it is not done. A project can tick it for its new tasks. Additive only: every
-- existing task gets needsApproval = false and no approval state, every project the setting off.
-- AlterTable
ALTER TABLE `projects` ADD COLUMN `newTasksNeedApproval` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `approvalRequestedAt` DATETIME(3) NULL,
    ADD COLUMN `approvalRequestedById` VARCHAR(191) NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    ADD COLUMN `needsApproval` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `tasks_approvalRequestedAt_idx` ON `tasks`(`approvalRequestedAt`);

-- CreateIndex
CREATE INDEX `tasks_approvalRequestedById_idx` ON `tasks`(`approvalRequestedById`);

-- CreateIndex
CREATE INDEX `tasks_approvedById_idx` ON `tasks`(`approvedById`);

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_approvalRequestedById_fkey` FOREIGN KEY (`approvalRequestedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
