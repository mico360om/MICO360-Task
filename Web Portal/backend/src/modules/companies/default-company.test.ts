import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACKFILL_MIGRATION, BACKFILL_SQL_PATH, DEFAULT_COMPANY } from './default-company';

// The backfill SQL and the rehearsal script spell the default company out by hand; they must say
// the same as DEFAULT_COMPANY.
describe('The default company, everywhere it is written', () => {
  it('the backfill file exists and creates DEFAULT_COMPANY', () => {
    expect(existsSync(BACKFILL_SQL_PATH)).toBe(true);
    const sql = readFileSync(BACKFILL_SQL_PATH, 'utf8');
    expect(sql).toContain(`SELECT '${DEFAULT_COMPANY.id}', '${DEFAULT_COMPANY.name}', '${DEFAULT_COMPANY.code}', 'ACTIVE'`);
    expect(sql.match(new RegExp(`c\\.\`id\` = '${DEFAULT_COMPANY.id}'`, 'g'))).toHaveLength(2);
  });

  it('the rehearsal script checks the same company and runs the same backfill file', () => {
    const script = readFileSync(resolve(__dirname, '..', '..', '..', 'scripts', 'rehearse-multi-company.mjs'), 'utf8');
    expect(script).toContain(`const DEFAULT_COMPANY = { id: '${DEFAULT_COMPANY.id}', name: '${DEFAULT_COMPANY.name}', code: '${DEFAULT_COMPANY.code}' };`);
    expect(script).toContain(`'${BACKFILL_MIGRATION}'`);
  });
});
