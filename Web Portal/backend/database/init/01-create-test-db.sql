-- Create the integration-test database and grant the app user access to it.
CREATE DATABASE IF NOT EXISTS mico360_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON mico360_test.* TO 'mico'@'%';
FLUSH PRIVILEGES;
