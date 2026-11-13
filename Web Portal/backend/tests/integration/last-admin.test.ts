import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaUserRepository } from '../../src/modules/users/prisma-user-repository';
import { createUserService } from '../../src/modules/users/user-service';

// Review fix #8 (13 Nov 2026): two administrators removing each other at the same moment must never
// leave the site without one. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Only this file's people (emails ending in @lastadmin.test) are made and removed; any other active
// administrator in the shared test database is set aside (inactive) for the file and put back after.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaUserRepository(prisma);
const revoked: string[] = [];
const svc = createUserService({ users: repo, revokeSessions: async (id) => void revoked.push(id) });
const DOMAIN = '@lastadmin.test';
const TRIALS = 8;
let setAside: string[] = [];
let seq = 0;

async function admin(): Promise<string> {
  const n = `a${++seq}`;
  const u = await prisma.user.create({
    data: { email: `${n}${DOMAIN}`, username: `lastadmin-${n}`, passwordHash: 'x', firstName: 'Admin', lastName: n, roles: { create: [{ roleId: 'role_builtin_admin' }] } },
  });
  return u.id;
}
async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { contains: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
const activeAdmins = () => repo.countActiveAdmins();
const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'ok' : ((r.reason as { code?: string }).code ?? String(r.reason)));

beforeAll(async () => {
  await prisma.$connect();
  await clean();
  // Every other active administrator steps aside for this file (the count is the whole site's).
  setAside = (await prisma.user.findMany({ where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { name: 'ADMIN' } } } }, select: { id: true } })).map((u) => u.id);
  await prisma.user.updateMany({ where: { id: { in: setAside } }, data: { status: 'INACTIVE' } });
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.user.updateMany({ where: { id: { in: setAside } }, data: { status: 'ACTIVE' } });
  await prisma.$disconnect();
});

describe('The last active administrator, under simultaneous changes', () => {
  it('two admins deactivating each other at once: exactly one succeeds, the other is refused (LAST_ADMIN)', async () => {
    for (let i = 0; i < TRIALS; i++) {
      await clean();
      const [a, b] = [await admin(), await admin()];
      const r = await Promise.allSettled([svc.setUserStatus(a, 'INACTIVE'), svc.setUserStatus(b, 'INACTIVE')]);
      expect(r.map(outcome).sort()).toEqual(['LAST_ADMIN', 'ok']);
      expect(await activeAdmins()).toBe(1);
    }
  });

  it('a demotion and a suspension at once: exactly one succeeds', async () => {
    for (let i = 0; i < TRIALS; i++) {
      await clean();
      const [a, b] = [await admin(), await admin()];
      const r = await Promise.allSettled([svc.updateUser(a, { roleNames: ['EMPLOYEE'] }), svc.setUserStatus(b, 'SUSPENDED')]);
      expect(r.map(outcome).sort()).toEqual(['LAST_ADMIN', 'ok']);
      expect(await activeAdmins()).toBe(1);
    }
  });

  it('two deletions, and two demotions, at once: exactly one of each pair succeeds', async () => {
    for (let i = 0; i < TRIALS; i++) {
      await clean();
      const [a, b] = [await admin(), await admin()];
      const del = await Promise.allSettled([svc.deleteUser(a), svc.deleteUser(b)]);
      expect(del.map(outcome).sort()).toEqual(['LAST_ADMIN', 'ok']);
      expect(await activeAdmins()).toBe(1);
      await clean();
      const [c, d] = [await admin(), await admin()];
      const dem = await Promise.allSettled([svc.updateUser(c, { roleNames: ['EMPLOYEE'] }), svc.updateUser(d, { roleNames: ['EMPLOYEE'] })]);
      expect(dem.map(outcome).sort()).toEqual(['LAST_ADMIN', 'ok']);
      expect(await activeAdmins()).toBe(1);
    }
  });

  it('one at a time still works as before: the first change is made, the second refused; the refusal changes nothing', async () => {
    const [a, b] = [await admin(), await admin()];
    await svc.setUserStatus(a, 'INACTIVE');
    await expect(svc.setUserStatus(b, 'INACTIVE')).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
    await expect(svc.updateUser(b, { roleNames: ['EMPLOYEE'] })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(svc.deleteUser(b)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    const left = await repo.findById(b);
    expect(left).toMatchObject({ status: 'ACTIVE', roles: ['ADMIN'] });
    // The change that was made ended that admin's sessions, after it was saved; the refused ones didn't.
    expect(revoked).toContain(a);
    expect(revoked).not.toContain(b);
    // Reactivating someone is never held up.
    await expect(svc.setUserStatus(a, 'ACTIVE')).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(await activeAdmins()).toBe(2);
  });

  it('the hold is a row of its own in job_locks (made when missing), which no scheduled job uses', async () => {
    await prisma.jobLock.deleteMany({ where: { name: 'admin-guard' } });
    const [a] = [await admin(), await admin()];
    await svc.setUserStatus(a, 'INACTIVE');
    expect(await prisma.jobLock.count({ where: { name: 'admin-guard' } })).toBe(1);
  });
});
