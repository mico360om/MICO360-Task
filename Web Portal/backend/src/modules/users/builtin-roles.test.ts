import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A fresh production database is built only from the committed migrations plus the first-admin
 * bootstrap (which creates ADMIN). Every role the app assigns must therefore come from a migration,
 * or an administrator can't add staff on a new install ("Unknown role: EMPLOYEE").
 */
describe('built-in roles', () => {
  const dir = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
  const sql = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readFileSync(join(dir, d.name, 'migration.sql'), 'utf8'))
    .join('\n');

  it.each(['ADMIN', 'EMPLOYEE'])('the migrations create the %s role idempotently', (role) => {
    expect(sql).toMatch(new RegExp(`INSERT IGNORE INTO \`roles\`[\\s\\S]*'${role}'`));
  });
});
