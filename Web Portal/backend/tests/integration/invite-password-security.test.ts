import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { hashPassword, verifyPassword } from '../../src/lib/password';
import { createPrismaUserRepository as createUserMgmt } from '../../src/modules/users/prisma-user-repository';
import { createUserService } from '../../src/modules/users/user-service';
import { createClientAccounts } from '../../src/modules/clients/client-accounts';
import { createPrismaWelcomeTokenStore } from '../../src/modules/users/prisma-welcome-store';
import { createPrismaResetUserRepo } from '../../src/modules/auth/prisma-reset-user-repo';
import { createPrismaOtpUserLookup } from '../../src/modules/auth/prisma-otp-user-lookup';
import { createFirstPassword, createPrismaFirstPasswordRepo } from '../../src/modules/auth/first-password';
import { createSettingsService } from '../../src/modules/settings/settings-service';
import { createPrismaSettingsRepository } from '../../src/modules/settings/prisma-settings-repository';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createPrismaUserRepository as createAuthUsers } from '../../src/modules/auth/prisma-user-repository';
import { PasswordChangeExpiredError } from '../../src/modules/auth/errors';

// 1.23.6 addendum on the real database (TEST_DATABASE_URL, migrations applied): temporary passwords,
// the forced change, Cancel invitation, the daily send limit and the lifetime setting. Only this file's
// people (emails ending in @ipw.test) are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const DOMAIN = '@ipw.test';
const DAY = 24 * 3600 * 1000;

async function role(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name, ...(name === 'CLIENT' ? { id: 'role_builtin_client' } : {}) } });
}
async function person(name: string, o: Record<string, unknown> = {}, roles: string[] = ['EMPLOYEE']) {
  const ids = await Promise.all(roles.map(role));
  return prisma.user.create({
    data: { email: `${name}${DOMAIN}`, username: `ipw-${name}`, passwordHash: await hashPassword('Own-Password-1'), firstName: name, lastName: 'T', roles: { create: ids.map((r) => ({ roleId: r.id })) }, ...o },
  });
}
async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { contains: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.user.updateMany({ where: { email: { contains: DOMAIN } }, data: { temporaryPasswordSetById: null } });
  await prisma.user.deleteMany({ where: { email: { contains: DOMAIN } } });
  await prisma.systemSetting.deleteMany({ where: { key: 'accounts.invitationDays' } }).catch(() => undefined);
}
const row = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const link = (userId: string, o: { purpose?: 'WELCOME' | 'PASSWORD_RESET'; expiresAt?: Date; createdAt?: Date } = {}) =>
  prisma.loginOtp.create({ data: { userId, codeHash: `ipw-${Math.random()}`, expiresAt: o.expiresAt ?? new Date(Date.now() + 7 * DAY), attempts: 0, purpose: o.purpose ?? 'WELCOME', ...(o.createdAt ? { createdAt: o.createdAt } : {}) } });
const liveLinks = (userId: string) => prisma.loginOtp.count({ where: { userId, consumedAt: null, purpose: { in: ['WELCOME', 'PASSWORD_RESET'] } } });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('The migration (add-only, MariaDB-safe): nobody already here is asked to change a password', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const folder = readdirSync(dir).find((d) => d.endsWith('_invite_password_security'));

  it('one folder in the 1.23.6 range; every statement portable; nothing but ADD / CREATE INDEX / ADD CONSTRAINT', () => {
    expect(folder).toBe('20261107130000_invite_password_security');
    const text = readFileSync(join(dir, folder!, 'migration.sql'), 'utf8');
    expect(text).not.toMatch(/--[^\n]*;/);
    const statements = text
      .split(';')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    for (const sql of statements) {
      expect(portabilityProblems(sql), sql).toEqual([]);
      expect(sql).toMatch(/^(ALTER TABLE `users` ADD (COLUMN|CONSTRAINT)|CREATE INDEX)/);
      expect(sql.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE)/g, '')).not.toMatch(/\b(DROP|MODIFY|CHANGE|RENAME|UPDATE|DELETE)\b/i);
    }
  });

  it('an account made the way the seed and older releases make it starts with no forced change', async () => {
    const old = await person('old', { lastLoginAt: new Date('2026-10-01T00:00:00Z') });
    expect(await row(old.id)).toMatchObject({ mustChangePassword: false, temporaryPasswordSetAt: null, temporaryPasswordExpiresAt: null, invitationCancelledAt: null });
    const fp = createFirstPassword({ repo: createPrismaFirstPasswordRepo(prisma), key: 'k', hashPassword, verifyPassword });
    expect(await fp.gate(old.id, false)).toBeNull();
  });
});

describe('Temporary passwords on the database', () => {
  it('a new account with a temporary password: marked, who set it (by name), until when; the list and Manage account show it, never the value', async () => {
    const admin = await person('admin', {}, ['ADMIN']);
    const users = createUserMgmt(prisma);
    const service = createUserService({ users });
    const at = new Date();
    const made = await service.createUser({ email: `sara${DOMAIN}`, username: 'ipw-sara', firstName: 'Sara', lastName: 'K', password: 'Kite-Mango-Fern-Ripple-472', temporary: { at, setById: admin.id, expiresAt: new Date(at.getTime() + 3 * DAY) } });
    expect(made).toMatchObject({ mustChangePassword: true, temporaryPasswordSetBy: { id: admin.id, name: 'admin T' }, onboarding: 'ACTIVE' });
    expect(made.temporaryPasswordExpiresAt!.getTime() - made.temporaryPasswordSetAt!.getTime()).toBe(3 * DAY);
    expect(JSON.stringify(made)).not.toContain('Kite');
    // No password, no mark (an invitation link is the way in).
    const linkOnly = await service.createUser({ email: `omar${DOMAIN}`, username: 'ipw-omar', firstName: 'Omar', lastName: 'K', temporary: { at, setById: admin.id, expiresAt: at } });
    expect(linkOnly.mustChangePassword).toBe(false);
  });

  it('setting one ends the invitation links and a cancel; the person’s own password clears the mark; past its lifetime it shows as expired', async () => {
    const sara = await person('sara', { invitationCancelledAt: new Date() });
    await link(sara.id);
    const users = createUserMgmt(prisma);
    const at = new Date();
    await users.setPassword(sara.id, await hashPassword('Temp-Pass-11'), { at, setById: null, expiresAt: new Date(at.getTime() + DAY) });
    expect(await liveLinks(sara.id)).toBe(0);
    expect(await row(sara.id)).toMatchObject({ mustChangePassword: true, invitationCancelledAt: null });
    await prisma.user.update({ where: { id: sara.id }, data: { temporaryPasswordExpiresAt: new Date(Date.now() - 1000) } });
    expect((await users.findById(sara.id))!.onboarding).toBe('TEMP_EXPIRED');
    await users.setPassword(sara.id, await hashPassword('Own-New-Pass-22'));
    expect(await row(sara.id)).toMatchObject({ mustChangePassword: false, temporaryPasswordSetAt: null, temporaryPasswordExpiresAt: null });
    expect((await users.findById(sara.id))!.onboarding).toBe('ACTIVE');
  });

  it('a new invitation stops an unused temporary password (one way in or the other)', async () => {
    const sara = await person('sara');
    const users = createUserMgmt(prisma);
    const at = new Date();
    await users.setPassword(sara.id, await hashPassword('Temp-Pass-11'), { at, setById: null, expiresAt: new Date(at.getTime() + DAY) });
    await users.markWelcomeSent(sara.id, new Date());
    const r = await row(sara.id);
    expect(r.mustChangePassword).toBe(false);
    expect(await verifyPassword('Temp-Pass-11', r.passwordHash)).toBe(false);
    // Someone with their own password keeps it when invited again.
    const omar = await person('omar', { lastLoginAt: new Date() });
    await users.markWelcomeSent(omar.id, new Date());
    expect(await verifyPassword('Own-Password-1', (await row(omar.id)).passwordHash)).toBe(true);
  });
});

describe('Cancel invitation on the database: every way in stops', () => {
  it('links end, an unused temporary password stops, "Forgot password" and the emailed code find nobody, an old link reads as expired; a new invitation or temporary password undoes it', async () => {
    const admin = await person('admin', {}, ['ADMIN']);
    const sara = await person('sara', { invitedAt: new Date(), welcomeSentAt: new Date() });
    await link(sara.id);
    await link(sara.id, { purpose: 'PASSWORD_RESET' });
    const users = createUserMgmt(prisma);
    await users.setPassword(sara.id, await hashPassword('Temp-Pass-11'), { at: new Date(), setById: admin.id, expiresAt: new Date(Date.now() + DAY) });
    await link(sara.id);
    const service = createUserService({ users });
    const after = await service.cancelInvitation(sara.id);
    expect(after).toMatchObject({ onboarding: 'INVITE_CANCELLED', mustChangePassword: false });
    expect(await liveLinks(sara.id)).toBe(0);
    expect(await verifyPassword('Temp-Pass-11', (await row(sara.id)).passwordHash)).toBe(false);
    const reset = createPrismaResetUserRepo(prisma);
    expect(await reset.findActiveByIdentifier(`sara${DOMAIN}`)).toBeNull();
    expect(await reset.findActiveByIdentifier('ipw-sara')).toBeNull();
    expect(await reset.isActive(sara.id)).toBe(false);
    // An administrator's "Send password reset" is refused with the reason (security review finding 6).
    expect(await reset.findById!(sara.id)).toMatchObject({ invitationCancelled: true, mustChangePassword: false });
    expect(await createPrismaOtpUserLookup(prisma).findActiveByIdentifier(`sara${DOMAIN}`)).toBeNull();
    // Someone who has signed in can't be cancelled.
    const omar = await person('omar', { lastLoginAt: new Date() });
    await expect(service.cancelInvitation(omar.id)).rejects.toMatchObject({ status: 409 });
    // A new temporary password undoes the cancel.
    await users.setPassword(sara.id, await hashPassword('Temp-Pass-22'), { at: new Date(), setById: admin.id, expiresAt: new Date(Date.now() + DAY) });
    expect((await row(sara.id)).invitationCancelledAt).toBeNull();
    expect(await reset.findActiveByIdentifier(`sara${DOMAIN}`)).not.toBeNull();
    // …and so does a new invitation.
    await service.cancelInvitation(sara.id);
    await users.markWelcomeSent(sara.id, new Date());
    expect((await row(sara.id)).invitationCancelledAt).toBeNull();
  });
});

describe('Cancel invitation: security review findings 1 and 4', () => {
  it('an account made before 1.23.6 with a typed password (never marked temporary): the password stops too', async () => {
    const legacy = await person('legacy', { invitedAt: new Date(), welcomeSentAt: new Date() });
    const service = createUserService({ users: createUserMgmt(prisma) });
    await service.cancelInvitation(legacy.id);
    expect(await verifyPassword('Own-Password-1', (await row(legacy.id)).passwordHash)).toBe(false);
  });

  it('never marks an account that has become theirs in the meantime (the write checks it again)', async () => {
    const sara = await person('sara', { invitedAt: new Date() });
    const users = createUserMgmt(prisma);
    // Signed in between the service's check and the write.
    await prisma.user.update({ where: { id: sara.id }, data: { lastLoginAt: new Date() } });
    expect(await users.cancelInvitation(sara.id, new Date(), await hashPassword('x-unusable-1'))).toBe(false);
    const r = await row(sara.id);
    expect(r.invitationCancelledAt).toBeNull();
    expect(await verifyPassword('Own-Password-1', r.passwordHash)).toBe(true);
  });
});

describe('The forced change on the database', () => {
  it('a sign-in with the temporary password gives the step; the change clears the mark, ends older sessions and links, makes the account theirs', async () => {
    const sara = await person('sara');
    const users = createUserMgmt(prisma);
    await users.setPassword(sara.id, await hashPassword('Temp-Pass-11'), { at: new Date(), setById: null, expiresAt: new Date(Date.now() + DAY) });
    await link(sara.id, { purpose: 'PASSWORD_RESET' });
    const auth = createAuthService({ users: createAuthUsers(prisma), maxAttempts: 5 });
    expect((await auth.login('ipw-sara', 'Temp-Pass-11')).id).toBe(sara.id);
    const fp = createFirstPassword({ repo: createPrismaFirstPasswordRepo(prisma), key: 'db-key', hashPassword, verifyPassword });
    await fp.refuseUnusable(sara.id);
    const step = (await fp.gate(sara.id, true))!;
    const before = await row(sara.id);
    expect(await fp.change(step.ticket, 'My-Own-Pass-33')).toBe(sara.id);
    const r = await row(sara.id);
    expect(r).toMatchObject({ mustChangePassword: false, temporaryPasswordSetAt: null, temporaryPasswordExpiresAt: null, tokenVersion: before.tokenVersion + 1 });
    expect(r.activatedAt).toBeInstanceOf(Date);
    expect(await liveLinks(sara.id)).toBe(0);
    expect(await verifyPassword('My-Own-Pass-33', r.passwordHash)).toBe(true);
    await expect(fp.change(step.ticket, 'Again-Pass-44')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
  });

  it('a password reset link used instead also ends the forced change (their own password now)', async () => {
    const sara = await person('sara');
    const users = createUserMgmt(prisma);
    await users.setPassword(sara.id, await hashPassword('Temp-Pass-11'), { at: new Date(), setById: null, expiresAt: new Date(Date.now() + DAY) });
    await createPrismaResetUserRepo(prisma).setPasswordAndUnlock(sara.id, await hashPassword('Own-Reset-55'));
    expect(await row(sara.id)).toMatchObject({ mustChangePassword: false, temporaryPasswordExpiresAt: null });
  });
});

describe('Invitations: the daily count and the lifetime setting', () => {
  it('links made in the last 24 hours are counted (older ones are not)', async () => {
    const sara = await person('sara');
    const store = createPrismaWelcomeTokenStore(prisma);
    await link(sara.id, { createdAt: new Date(Date.now() - 2 * DAY) });
    await store.create({ userId: sara.id, tokenHash: `ipw-a-${Date.now()}`, expiresAt: new Date(Date.now() + DAY), createdAt: new Date() });
    await store.create({ userId: sara.id, tokenHash: `ipw-b-${Date.now()}`, expiresAt: new Date(Date.now() + DAY) });
    expect(await store.countSince!(sara.id, new Date(Date.now() - DAY))).toBe(2);
  });

  it('System Settings → Accounts: 7 days until set; 1, 3, 7 or 14 stored', async () => {
    const settings = createSettingsService({ settings: createPrismaSettingsRepository(prisma) });
    expect(await settings.invitationDays()).toBe(7);
    await settings.set('accounts.invitationDays', 14);
    expect(await settings.invitationDays()).toBe(14);
  });
});

describe('Client accounts', () => {
  it('a client made with a temporary password shows the mark and its status; Invitation cancelled shows too', async () => {
    const admin = await person('admin', {}, ['ADMIN']);
    const userService = createUserService({ users: createUserMgmt(prisma) });
    const accounts = createClientAccounts({ prisma, userService });
    const at = new Date();
    const made = await accounts.create(
      { firstName: 'Saif', lastName: 'Said', username: 'ipw-saif', email: `saif${DOMAIN}`, organisation: 'Acme', password: 'Temp-Pass-11', temporary: { at, setById: admin.id, expiresAt: new Date(at.getTime() + DAY) } },
      { id: admin.id },
    );
    expect(made).toMatchObject({ mustChangePassword: true, temporaryPasswordSetBy: { id: admin.id }, onboarding: 'ACTIVE' });
    await userService.cancelInvitation(made.id);
    expect((await accounts.get(made.id)).onboarding).toBe('INVITE_CANCELLED');
  });
});
