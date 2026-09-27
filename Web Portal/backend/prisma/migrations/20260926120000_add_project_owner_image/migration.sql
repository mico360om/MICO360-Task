-- Adds the two project columns that schema.prisma has declared for a while but no earlier
-- migration created. Without them every project query fails on a database built with
-- `prisma migrate deploy` (unknown column).
--
-- Databases originally created with `prisma db push` already have these columns. On those,
-- mark this migration as applied instead of running it:
--   npx prisma migrate resolve --applied 20260926120000_add_project_owner_image
ALTER TABLE `projects` ADD COLUMN `imageUrl` VARCHAR(191) NULL,
    ADD COLUMN `ownerId` VARCHAR(191) NULL;
