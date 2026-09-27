-- Built-in roles. A fresh production database (migrate deploy + bootstrap) only had ADMIN — the
-- bootstrap creates it — so an administrator could not add staff ("Unknown role: EMPLOYEE").
-- Data only and idempotent: databases that already have these roles keep them (INSERT IGNORE
-- skips names that exist), so it is safe on seeded and db-push databases alike.
INSERT IGNORE INTO `roles` (`id`, `name`, `description`) VALUES
  ('role_builtin_admin', 'ADMIN', 'Full system access'),
  ('role_builtin_employee', 'EMPLOYEE', 'Assigned work only');
