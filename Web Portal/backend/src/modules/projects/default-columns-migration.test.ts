import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_COLUMNS } from './project-repository';

/**
 * The migration that gives column-less (older) projects a board must create exactly the board a
 * new project gets, in the same order.
 */
describe('default-columns migration', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', 'prisma', 'migrations', '20260929120100_default_columns_for_empty_projects', 'migration.sql'),
    'utf8',
  );

  it('inserts the DEFAULT_COLUMNS, in order, only for projects without columns', () => {
    const rows = [...sql.matchAll(/SELECT '([^']+)'(?: AS `name`)?, '([A-Z_]+)'(?: AS `category`)?, (\d+)(?: AS `position`)?, '(#[0-9A-F]{6})'/gi)].map((m) => ({
      name: m[1],
      category: m[2],
      position: Number(m[3]),
      color: m[4],
    }));
    expect(rows).toEqual(DEFAULT_COLUMNS.map((c, position) => ({ name: c.name, category: c.category, position, color: c.color })));
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM `kanban_columns` c WHERE c\.`projectId` = p\.`id`\)/);
  });
});
