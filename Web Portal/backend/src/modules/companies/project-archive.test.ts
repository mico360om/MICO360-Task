import { describe, it, expect } from 'vitest';
import { LIVE_PROJECT_WHERE } from './company-access';
import { ARCHIVE_INCLUDE, ARCHIVE_SELECT, LIVE_PROJECT_SQL, archivedOf, liveProjectWhere, projectArchived } from './project-archive';

const of = (status: string, ...companies: ('ACTIVE' | 'ARCHIVED')[]) => ({ status, companies: companies.map((c) => ({ company: { status: c } })) });

describe('archived = own status or all companies archived (one helper)', () => {
  it('a row read with ARCHIVE_SELECT', () => {
    expect(archivedOf(of('ACTIVE', 'ACTIVE'))).toBe(false);
    expect(archivedOf(of('ACTIVE', 'ARCHIVED', 'ACTIVE'))).toBe(false);
    expect(archivedOf(of('ACTIVE', 'ARCHIVED', 'ARCHIVED'))).toBe(true);
    expect(archivedOf(of('ARCHIVED', 'ACTIVE'))).toBe(true);
    expect(archivedOf(of('COMPLETED'))).toBe(false); // no company: its own status decides
  });

  it('a record its repository worked out, else its own status', () => {
    expect(projectArchived({ status: 'ACTIVE', archived: true })).toBe(true);
    expect(projectArchived({ status: 'ACTIVE', archived: false })).toBe(false);
    expect(projectArchived({ status: 'ARCHIVED' })).toBe(true);
    expect(projectArchived({ status: 'ON_HOLD' })).toBe(false);
  });

  it('the query pieces say the same', () => {
    expect(ARCHIVE_SELECT).toEqual({ status: true, companies: { select: { company: { select: { status: true } } } } });
    expect(ARCHIVE_INCLUDE).toEqual({ companies: ARCHIVE_SELECT.companies });
    expect(liveProjectWhere()).toBe(LIVE_PROJECT_WHERE);
    expect(liveProjectWhere({ deletedAt: null })).toEqual({ AND: [{ deletedAt: null }, LIVE_PROJECT_WHERE] });
    expect(LIVE_PROJECT_WHERE).toEqual({ status: { not: 'ARCHIVED' }, OR: [{ companies: { none: {} } }, { companies: { some: { company: { status: 'ACTIVE' } } } }] });
    const sql = LIVE_PROJECT_SQL.sql.replace(/\s+/g, ' ');
    expect(sql).toContain("p.status <> 'ARCHIVED'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM project_companies');
    expect(sql).toContain("lc.status = 'ACTIVE'");
  });
});
