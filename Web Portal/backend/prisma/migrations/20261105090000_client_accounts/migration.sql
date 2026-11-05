-- 1.23.0 Client accounts and the Client portal (add-only: new role row, new columns, one new table).
-- A client account is a user whose only role is CLIENT: they sign in like staff and see only the Client
-- portal, and only the projects, modules and actions an administrator ticked for them. Nothing changes
-- for existing people, projects, tasks or comments (every new column defaults to off / empty).

-- The Client role (data only, idempotent like the other built-in roles).
INSERT IGNORE INTO `roles` (`id`, `name`, `description`) VALUES
  ('role_builtin_client', 'CLIENT', 'Client portal only');

-- A client's organisation and phone (staff leave them empty).
ALTER TABLE `users` ADD COLUMN `organisation` VARCHAR(160) NULL,
    ADD COLUMN `phone` VARCHAR(40) NULL;

-- Per client, the projects they may open, and per project the modules and actions ticked.
CREATE TABLE `client_project_grants` (
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `progress` BOOLEAN NOT NULL DEFAULT false,
    `meetings` BOOLEAN NOT NULL DEFAULT false,
    `canComment` BOOLEAN NOT NULL DEFAULT false,
    `canSignOff` BOOLEAN NOT NULL DEFAULT false,
    `canRespond` BOOLEAN NOT NULL DEFAULT false,
    `canDownload` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_project_grants_projectId_idx`(`projectId`),
    PRIMARY KEY (`userId`, `projectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `client_project_grants` ADD CONSTRAINT `client_project_grants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `client_project_grants` ADD CONSTRAINT `client_project_grants_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Task comments: written by a client in the portal; a team reply the client may see ("Visible to client").
ALTER TABLE `task_comments` ADD COLUMN `fromClient` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `clientVisible` BOOLEAN NOT NULL DEFAULT false;

-- Tasks: the description is shown in the portal too (a tick of its own); the client's sign-off.
ALTER TABLE `tasks` ADD COLUMN `clientShowDescription` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `clientAcceptedAt` DATETIME(3) NULL,
    ADD COLUMN `clientAcceptedById` VARCHAR(191) NULL;
