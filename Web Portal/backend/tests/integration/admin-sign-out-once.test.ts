import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ADMIN_SIGN_OUT_KEY, createAdminSignOutOnce } from '../../src/modules/auth/admin-sign-out-once';
import { testPrisma } from './test-prisma';

// Owner decision (18 Nov 2026), release 1.24.0: every administrator's existing website session ends ONCE at the
// release, so each signs in again with password + code. Staff, managers and clients are unaffected. On the real
// database (TEST_DATABASE_URL, MySQL 8 and MariaDB 11.8.9). Only this file's people (@asonce.test) are made.
const prisma = testPrisma();
const DOMAIN = '@asonce.test';
const NOW = new Date('2026-11-19T06:00:00.000Z');
const step = () => createAdminSignOutOnce({ prisma, now: () => NOW });

async function role(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name } });
}
async function person(name: string, roles: string[], tokenVersion = 3) {
  const ids = await Promise.all(roles.map(role));
  const u = await prisma.user.create({
    data: { email: `${name}${DOMAIN}`, username: `asonce-${name}`, passwordHash: 'x', firstName: name, lastName: 'T', tokenVersion, roles: { create: ids.map((r) => ({ roleId: r.id })) } },
  });
  // A live website session (refresh token) and a fingerprint key.
  await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: randomBytes(16).toString('hex'), expiresAt: new Date(NOW.getTime() + 20 * 86_400_000), familyId: `f-${name}` } });
  return u.id;
}
const versionOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { tokenVersion: true } })).tokenVersion;
const liveTokens = async (id: string) => prisma.refreshToken.count({ where: { userId: id, revokedAt: null } });

async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // tokens go with them (cascade)
  await prisma.auditLog.deleteMany({ where: { action: 'auth.two_step.admins_signed_out' } });
  await prisma.systemSetting.deleteMany({ where: { key: ADMIN_SIGN_OUT_KEY } });
}

let admin = '', adminEmployee = '', employee = '', client = '';
beforeAll(async () => {
  await clean();
  admin = await person('ada', ['ADMIN']);
  adminEmployee = await person('ben', ['ADMIN', 'EMPLOYEE'], 0);
  employee = await person('cai', ['EMPLOYEE']);
  client = await person('dee', ['CLIENT']);
});
afterAll(async () => {
  await clean();
});

describe('1.24.0: every administrator signs in again once (two-step sign-in)', () => {
  it('ends each administrator’s sessions once: session version raised, live refresh tokens revoked; staff and clients untouched', async () => {
    const r = await step().run();
    expect(r.already).toBe(false);
    expect(r.userIds).toEqual(expect.arrayContaining([admin, adminEmployee]));
    expect(r.userIds).not.toContain(employee);
    expect(r.userIds).not.toContain(client);
    expect(await versionOf(admin)).toBe(4);
    expect(await versionOf(adminEmployee)).toBe(1);
    expect(await liveTokens(admin)).toBe(0);
    expect(await liveTokens(adminEmployee)).toBe(0);
    // Staff and clients: same version, session still live.
    expect(await versionOf(employee)).toBe(3);
    expect(await versionOf(client)).toBe(3);
    expect(await liveTokens(employee)).toBe(1);
    expect(await liveTokens(client)).toBe(1);
    // Recorded, so it never runs again; and in the Audit log.
    const mark = await prisma.systemSetting.findUnique({ where: { key: ADMIN_SIGN_OUT_KEY } });
    expect(mark?.value).toMatchObject({ at: NOW.toISOString(), admins: r.userIds.length });
    const audit = await prisma.auditLog.findMany({ where: { action: 'auth.two_step.admins_signed_out' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ module: 'auth', userId: null, newValue: { admins: r.userIds.length } });
  });

  it('never runs twice: a second start-up (or a sign-in after it) changes nothing', async () => {
    // An administrator signs in again after the release: a new live session.
    await prisma.refreshToken.create({ data: { userId: admin, tokenHash: randomBytes(16).toString('hex'), expiresAt: new Date(NOW.getTime() + 86_400_000) } });
    const again = await step().run();
    expect(again).toEqual({ already: true, userIds: [] });
    expect(await versionOf(admin)).toBe(4);
    expect(await liveTokens(admin)).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.two_step.admins_signed_out' } })).toBe(1);
  });

  it('two servers starting at once: exactly one of them does it', async () => {
    await prisma.systemSetting.deleteMany({ where: { key: ADMIN_SIGN_OUT_KEY } });
    await prisma.auditLog.deleteMany({ where: { action: 'auth.two_step.admins_signed_out' } });
    const before = await versionOf(admin);
    const [a, b] = await Promise.all([step().run(), step().run()]);
    expect([a.already, b.already].sort()).toEqual([false, true]);
    expect(await versionOf(admin)).toBe(before + 1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.two_step.admins_signed_out' } })).toBe(1);
  });
});
