import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createCompanyService } from '../../src/modules/companies/company-service';
import { createPrismaCompanyRepository } from '../../src/modules/companies/prisma-company-repository';
import { DEFAULT_COMPANY } from '../../src/modules/companies/default-company';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const onAccess = vi.fn();
const svc = createCompanyService({
  companies: createPrismaCompanyRepository(prisma),
  site: async () => ({ timeZone: 'Asia/Muscat', weekStart: 0, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, senderName: 'MICO360 Tasks' }),
  onAccessChanged: onAccess,
});
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('Companies admin (integration)', () => {
  it('my companies', async () => {
    const { A, B, C } = w.companies;
    expect((await svc.mine(w.as.cat)).companies.map((c) => c.id)).toEqual([A, B]);
    expect((await svc.mine(w.as.cat)).primaryCompanyId).toBe(B);
    expect(await svc.mine(w.as.gus)).toMatchObject({ companies: [], allArchived: true });
    const adminIds = (await svc.mine(w.as.admin)).companies.map((c) => c.id); // active only (other test files may leave companies behind)
    expect(adminIds).toEqual(expect.arrayContaining([A, B, DEFAULT_COMPANY.id]));
    expect(adminIds).not.toContain(C);
    expect((await svc.mine(w.as.ana)).siteCompanyCount).toBeGreaterThanOrEqual(3);
  });

  it('counts and lists per company', async () => {
    const { A, B } = w.companies;
    const { PA, PAB } = w.projects;
    expect((await svc.get(A)).counts).toEqual({ people: 3, projects: 2 });
    expect((await svc.projects(A)).map((p) => p.id).sort()).toEqual(sorted([PA, PAB]));
    expect((await svc.projects(B)).find((p) => p.id === PAB)).toMatchObject({ isMain: false, archived: false });
    expect((await svc.projects(w.companies.C))).toEqual([expect.objectContaining({ id: w.projects.PC, isMain: true, archived: true })]);
    expect((await svc.people(B)).map((p) => [p.id, p.isPrimary])).toEqual([
      [w.people.ben, true],
      [w.people.bob, true],
      [w.people.cat, true],
    ]);
    expect((await svc.people(A)).find((p) => p.id === w.people.cat)).toMatchObject({ isPrimary: false, email: `cat.${w.tag}@world.test`, status: 'ACTIVE' });
    expect((await svc.list()).find((c) => c.id === A)).toMatchObject({ counts: { people: 3, projects: 2 }, effective: { timeZone: 'Asia/Muscat' } });
  });

  it('archiving and unarchiving tell realtime who and which projects changed; names and codes stay unique', async () => {
    const { B } = w.companies;
    try {
      await svc.archive(B, w.as.admin);
      const [userIds, projectIds] = onAccess.mock.lastCall as [string[], string[]];
      expect(sorted(userIds)).toEqual(sorted([w.people.ben, w.people.bob, w.people.cat]));
      expect(sorted(projectIds)).toEqual(sorted([w.projects.PB, w.projects.PAB]));
      expect((await svc.mine(w.as.ben))).toMatchObject({ companies: [], allArchived: true });
    } finally {
      await svc.unarchive(B, w.as.admin);
    }
    expect((await svc.mine(w.as.ben)).companies.map((c) => c.id)).toEqual([B]);
    await expect(svc.create({ name: `beta ${w.tag}`, code: `Z${w.tag}` }, w.as.admin)).rejects.toMatchObject({ code: 'DUPLICATE_COMPANY_NAME' });
    await expect(svc.create({ name: `Zed ${w.tag}`, code: `b${w.tag}` }, w.as.admin)).rejects.toMatchObject({ code: 'DUPLICATE_COMPANY_CODE' });
  });
});
