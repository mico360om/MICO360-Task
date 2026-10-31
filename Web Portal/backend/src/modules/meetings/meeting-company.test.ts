import { describe, it, expect } from 'vitest';
import { createMeetingCompanyRule } from './meeting-company';
import { CompanyNotAvailableError } from '../companies/company-pick';

// Companies: a meeting without a project belongs to a company (MC1 Ruling 11).
const mine: Record<string, string[]> = { ana: ['A'], cat: ['A', 'B'] };
const primary: Record<string, string | null> = { ana: 'A', cat: 'B', admin: null };
const rule = createMeetingCompanyRule({
  checkPick: async (viewer, id) => {
    if (viewer.roles.includes('ADMIN') ? !['A', 'B', 'C'].includes(id) : !(mine[viewer.id] ?? []).includes(id)) throw new CompanyNotAvailableError();
    return id;
  },
  fallbackCompanyId: async (organizerId) => primary[organizerId] ?? null,
});
const ana = { id: 'ana', roles: ['EMPLOYEE'] };
const cat = { id: 'cat', roles: ['EMPLOYEE'] };
const admin = { id: 'admin', roles: ['ADMIN'] };

describe('the company of a new meeting', () => {
  it('a project meeting has none of its own', async () => {
    expect(await rule.forNew(ana, { projectId: 'p1', companyId: 'A', organizerId: 'ana' }, null)).toBeNull();
  });

  it('the one chosen (one of yours; admins any), else the picked company, else the organizer’s primary', async () => {
    expect(await rule.forNew(cat, { companyId: 'A', organizerId: 'cat' }, 'B')).toBe('A');
    await expect(rule.forNew(ana, { companyId: 'B', organizerId: 'ana' }, null)).rejects.toMatchObject({ status: 403, code: 'COMPANY_NOT_AVAILABLE' });
    expect(await rule.forNew(admin, { companyId: 'C', organizerId: 'admin' }, null)).toBe('C');
    expect(await rule.forNew(cat, { organizerId: 'cat' }, 'A')).toBe('A');
    expect(await rule.forNew(cat, { organizerId: 'cat' }, null)).toBe('B');
    expect(await rule.forNew(admin, { organizerId: 'ana' }, null)).toBe('A'); // on ana's behalf: her primary
  });

  it('nothing to go on: "Pick the company this meeting belongs to."', async () => {
    await expect(rule.forNew(admin, { organizerId: 'admin' }, null)).rejects.toMatchObject({ status: 400, message: 'Pick the company this meeting belongs to.', details: { field: 'companyId' } });
  });
});

describe('the company after a change', () => {
  const standalone = { projectId: null, companyId: 'A', organizerId: 'ana' };
  it('into a project: none; out of one: the default again', async () => {
    expect(await rule.forChange(ana, standalone, { projectId: 'p1' }, null)).toBeNull();
    expect(await rule.forChange(ana, { projectId: 'p1', companyId: null, organizerId: 'ana' }, { projectId: 'p1' }, null)).toBeUndefined();
    expect(await rule.forChange(ana, { projectId: 'p1', companyId: null, organizerId: 'ana' }, { projectId: null }, null)).toBe('A');
  });

  it('kept unless changed; the same one sent again asks nothing; a new one must be yours', async () => {
    expect(await rule.forChange(ana, standalone, { title: 'x' } as never, null)).toBeUndefined();
    expect(await rule.forChange({ id: 'gone', roles: [] }, standalone, { companyId: 'A' }, null)).toBeUndefined();
    await expect(rule.forChange(ana, standalone, { companyId: 'B' }, null)).rejects.toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' });
    expect(await rule.forChange(cat, { ...standalone, organizerId: 'cat' }, { companyId: 'B' }, null)).toBe('B');
  });
});
