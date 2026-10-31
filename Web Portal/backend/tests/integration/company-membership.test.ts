import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createCompanyAccess, type Viewer } from '../../src/modules/companies/company-access';
import { createCompanyMembership, createPrismaMembershipStore } from '../../src/modules/companies/company-membership';
import { createPrismaUserRepository } from '../../src/modules/users/prisma-user-repository';
import { createUserService } from '../../src/modules/users/user-service';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Every test changes
// memberships, so each builds its own world.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const access = createCompanyAccess(prisma);
const users = createPrismaUserRepository(prisma);
const onAccess = vi.fn();
const membership = createCompanyMembership({ store: createPrismaMembershipStore(prisma), onAccessChanged: onAccess });
let w: CompanyWorld;
const made: string[] = [];

beforeEach(async () => {
  await prisma.$connect();
  onAccess.mockClear();
  w = await buildCompanyWorld(prisma);
});
afterEach(async () => {
  if (made.length) await prisma.user.deleteMany({ where: { id: { in: made.splice(0) } } });
  if (w) await dropCompanyWorld(prisma, w);
});

const visible = async (viewer: Viewer) => sorted(((await access.visibleProjectIds(viewer, null)) ?? []).filter((id) => Object.values(w.projects).includes(id)));
const companiesOf = async (userId: string) =>
  sorted((await prisma.companyMember.findMany({ where: { userId }, select: { companyId: true } })).map((m) => m.companyId));
const primaryOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { primaryCompanyId: true } })).primaryCompanyId;
const worldIds = (rows: { id: string }[]) => sorted(rows.map((r) => r.id).filter((id) => Object.values(w.people).includes(id)));

describe('People’s companies (integration)', () => {
  it('removing cat from Beta hides PB at her next call', async () => {
    expect(await visible(w.as.cat)).toContain(w.projects.PB);
    await membership.remove([w.people.cat], [w.companies.B], w.as.admin);
    expect(await visible(w.as.cat)).toEqual([w.projects.PA]);
    expect(onAccess).toHaveBeenCalledWith([w.people.cat]);
    expect(await primaryOf(w.people.cat)).toBe(w.companies.A); // primary moved
  });

  it('set replaces a person’s companies in one go, with the primary company, and lists follow', async () => {
    const { A, B } = w.companies;
    await membership.set(w.people.ana, [A, B], B, w.as.admin);
    expect(await companiesOf(w.people.ana)).toEqual(sorted([A, B]));
    expect(await primaryOf(w.people.ana)).toBe(B);
    expect(await visible(w.as.ana)).toEqual(sorted([w.projects.PA, w.projects.PAB])); // still the team rule: not on PB's team
    expect(worldIds(await users.list({ companyId: A }))).toEqual(sorted([w.people.ana, w.people.amy, w.people.cat]));
    expect(worldIds(await users.list({ companyId: B }))).toEqual(sorted([w.people.ana, w.people.ben, w.people.bob, w.people.cat]));
    expect(worldIds(await users.list({ companyId: 'none' }))).toEqual([w.people.admin]);
  });

  it('an employee keeps at least one company: nothing is changed when refused', async () => {
    await expect(membership.set(w.people.ana, [], undefined, w.as.admin)).rejects.toMatchObject({ code: 'LAST_COMPANY' });
    const bulk = await membership.change([w.people.ana, w.people.cat], { add: [], remove: [w.companies.A] }, w.as.admin);
    expect(bulk).toEqual({ changed: 1, refused: [{ userId: w.people.ana, name: `Ana Alpha ${w.tag}`, reason: `Ana Alpha ${w.tag} must keep at least one company. Add another company first.` }] });
    expect(await companiesOf(w.people.ana)).toEqual([w.companies.A]);
    expect(await companiesOf(w.people.cat)).toEqual([w.companies.B]);
    expect(onAccess).toHaveBeenLastCalledWith([w.people.cat]);
  });

  it('a person’s companies come with them, A–Z, with their primary company', async () => {
    const cat = await users.findById(w.people.cat);
    expect(cat).toMatchObject({
      companies: [
        { id: w.companies.A, name: `Alpha ${w.tag}`, code: `A${w.tag.toUpperCase()}` },
        { id: w.companies.B, name: `Beta ${w.tag}`, code: `B${w.tag.toUpperCase()}` },
      ],
      primaryCompanyId: w.companies.B,
    });
    expect((await users.list()).find((u) => u.id === w.people.admin)).toMatchObject({ companies: [], primaryCompanyId: null });
  });

  it('a new person is made with their companies and primary company in the same write', async () => {
    const service = createUserService({ users });
    const u = await service.createUser({ email: `nia.${w.tag}@world.test`, username: `nia_${w.tag}`, password: 'Password1!', firstName: 'Nia', lastName: 'New', companyIds: [w.companies.B, w.companies.A], primaryCompanyId: w.companies.B });
    made.push(u.id);
    expect(await companiesOf(u.id)).toEqual(sorted([w.companies.A, w.companies.B]));
    expect(await primaryOf(u.id)).toBe(w.companies.B);
    const none = await service.createUser({ email: `zed.${w.tag}@world.test`, username: `zed_${w.tag}`, password: 'Password1!', firstName: 'Zed', lastName: 'Admin', roleNames: ['ADMIN'], companyIds: [] });
    made.push(none.id);
    expect(await companiesOf(none.id)).toEqual([]); // no fallback: the caller decides (User Management's rules)
  });
});
