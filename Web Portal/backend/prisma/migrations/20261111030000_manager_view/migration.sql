-- Manager View (owner, 10 Nov 2026): an administrator's own switch (add-only, MariaDB-safe).
ALTER TABLE `users` ADD COLUMN `managerView` BOOLEAN NOT NULL DEFAULT false;
