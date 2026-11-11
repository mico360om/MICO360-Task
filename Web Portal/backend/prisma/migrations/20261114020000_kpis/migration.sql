-- Project KPIs and User KPIs: a project's own KPIs and their monthly values, KPI targets (company
-- defaults and project overrides) and the KPIs' weekly snapshots. Add-only; constant defaults only
-- (MySQL 8 and MariaDB alike). The automatic KPIs come from tasks and their history; the past six
-- months of snapshots are rebuilt by the server once, after the upgrade.

-- CreateTable
CREATE TABLE `project_kpis` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `unit` VARCHAR(24) NOT NULL DEFAULT '',
    `direction` VARCHAR(8) NOT NULL DEFAULT 'HIGHER',
    `target` DOUBLE NULL,
    `amberBand` DOUBLE NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_kpis_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_kpi_values` (
    `id` VARCHAR(191) NOT NULL,
    `kpiId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `value` DOUBLE NOT NULL,
    `note` VARCHAR(500) NULL,
    `enteredById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_kpi_values_kpiId_month_key`(`kpiId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kpi_targets` (
    `id` VARCHAR(191) NOT NULL,
    `scopeKey` VARCHAR(200) NOT NULL,
    `metric` VARCHAR(40) NOT NULL,
    `target` DOUBLE NULL,
    `amberBand` DOUBLE NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kpi_targets_scopeKey_metric_key`(`scopeKey`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kpi_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL DEFAULT '',
    `day` VARCHAR(10) NOT NULL,
    `endDay` VARCHAR(10) NOT NULL,
    `weekStart` VARCHAR(10) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `metrics` JSON NOT NULL,
    `rebuilt` BOOLEAN NOT NULL DEFAULT false,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kpi_snapshots_month_idx`(`month`),
    INDEX `kpi_snapshots_userId_month_idx`(`userId`, `month`),
    UNIQUE INDEX `kpi_snapshots_projectId_userId_day_key`(`projectId`, `userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_kpis` ADD CONSTRAINT `project_kpis_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_kpi_values` ADD CONSTRAINT `project_kpi_values_kpiId_fkey` FOREIGN KEY (`kpiId`) REFERENCES `project_kpis`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
