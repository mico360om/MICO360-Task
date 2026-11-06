import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { createPrismaSignInChallengeStore } from '../../src/modules/auth/prisma-sign-in-challenge-store';
import { createSignInChallenges } from '../../src/modules/auth/sign-in-challenge';
import { createEmailVerification, createPrismaVerificationRepo } from '../../src/modules/auth/email-verification';
import { createPrismaUserRepository as createAuthUsers } from '../../src/modules/auth/prisma-user-repository';
import { createPrismaUserRepository as createUserMgmt } from '../../src/modules/users/prisma-user-repository';
import { createPrismaPasswordResetStore } from '../../src/modules/auth/prisma-password-reset-store';
import { createPrismaResetUserRepo } from '../../src/modules/auth/prisma-reset-user-repo';
import { createPasswordResetService } from '../../src/modules/auth/password-reset-service';
import { createPrismaWelcomeTokenStore } from '../../src/modules/users/prisma-welcome-store';
import { createPrismaIdentityLookup, checkIdentity } from '../../src/modules/users/identity-check';
import { createInvitationSweep, createPrismaExpiredInvitationStore } from '../../src/modules/users/invitation-sweep';
import { createUserService } from '../../src/modules/users/user-service';
import { createClientAccounts } from '../../src/modules/clients/client-accounts';
import { generateResetToken } from '../../src/lib/reset-token';

// Onboarding on the real database (TEST_DATABASE_URL, migrations applied). Only this file's people
// (emails ending in @onb.test) are made and removed: the shared test database may hold others.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const DOMAIN = '@onb.test';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function role(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name, ...(name === 'CLIENT' ? { id: 'role_builtin_client' } : {}) } });
}
async function person(name: string, o: Record<string, unknown> = {}, roles: string[] = ['EMPLOYEE']) {
  const ids = await Promise.all(roles.map(role));
  return prisma.user.create({
    data: { email: `${name}${DOMAIN}`, username: `onb-${name}`, passwordHash: 'x', firstName: name, lastName: 'T', roles: { create: ids.map((r) => ({ roleId: r.id })) }, ...o },
  });
}
async function clean() {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: (await prisma.user.findMany({ where: { email: { contains: DOMAIN } }, select: { id: true } })).map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { contains: DOMAIN } } }); // links, tokens and challenges go with them (cascade)
  await prisma.user.deleteMany({ where: { email: { contains: '@onb-new.test' } } });
}
const row = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('The migration: no current user is locked out', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const statementsOf = (suffix: string) => {
    const folder = readdirSync(dir).find((d) => d.endsWith(suffix));
    expect(folder).toBeDefined();
    return readFileSync(join(dir, folder!, 'migration.sql'), 'utf8')
      .split(';')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
  };

  it('every statement of both files reads alike on MySQL 8 and MariaDB (portabilityProblems)', () => {
    for (const sql of [...statementsOf('_onboarding'), ...statementsOf('_onboarding_backfill')]) expect(portabilityProblems(sql), sql).toEqual([]);
    // No semicolon in a comment: the rehearsal and these tests split the files at semicolons.
    for (const f of readdirSync(dir).filter((d) => d.includes('onboarding'))) expect(readFileSync(join(dir, f, 'migration.sql'), 'utf8')).not.toMatch(/--[^\n]*;/);
    // The folders sit in the lane's range, after 1.23.2's last migration.
    expect(readdirSync(dir).filter((d) => d.includes('onboarding'))).toEqual(['20261107120000_onboarding', '20261107120100_onboarding_backfill']);
  });

  it('everyone who has signed in (or holds a session) is verified and active; the rest are not; invitedAt comes from the welcome time — and a second run changes nothing', async () => {
    const signedIn = await person('signedin', { lastLoginAt: new Date('2026-10-20T08:00:00Z') });
    const sessionOnly = await person('session');
    await prisma.refreshToken.create({ data: { userId: sessionOnly.id, tokenHash: `onb-${Date.now()}`, expiresAt: new Date('2027-01-01T00:00:00Z') } });
    const never = await person('never');
    const invited = await person('invited', { welcomeSentAt: new Date('2026-11-01T08:00:00Z') });
    const keep = await person('keep', { lastLoginAt: new Date('2026-10-20T08:00:00Z'), emailVerifiedAt: new Date('2026-09-01T00:00:00Z'), activatedAt: new Date('2026-09-01T00:00:00Z') });
    const backfill = statementsOf('_onboarding_backfill');
    for (const sql of backfill) await prisma.$executeRawUnsafe(sql);
    const snap = async () =>
      Object.fromEntries(
        await Promise.all(
          [signedIn, sessionOnly, never, invited, keep].map(async (u) => {
            const r = await row(u.id);
            return [u.firstName, { verified: r.emailVerifiedAt?.toISOString() ?? null, activated: r.activatedAt?.toISOString() ?? null, invited: r.invitedAt?.toISOString() ?? null }];
          }),
        ),
      );
    const first = await snap();
    expect(first.signedin).toEqual({ verified: '2026-10-20T08:00:00.000Z', activated: '2026-10-20T08:00:00.000Z', invited: null });
    expect(first.session!.verified).not.toBeNull();
    expect(first.never).toEqual({ verified: null, activated: null, invited: null });
    expect(first.invited).toEqual({ verified: null, activated: null, invited: '2026-11-01T08:00:00.000Z' });
    expect(first.keep).toEqual({ verified: '2026-09-01T00:00:00.000Z', activated: '2026-09-01T00:00:00.000Z', invited: null });
    for (const sql of backfill) await prisma.$executeRawUnsafe(sql);
    expect(await snap()).toEqual(first);

    // …and so, with email working, a grandfathered person signs in with no code; a never-signed-in one is asked.
    const verification = createEmailVerification({ repo: createPrismaVerificationRepo(prisma), mailConfigured: () => true });
    expect(await verification.needsCode(signedIn.id)).toBe(false);
    expect(await verification.needsCode(sessionOnly.id)).toBe(false);
    expect(await verification.needsCode(never.id)).toBe(true);
  });
});

describe('Sign-in challenges in sign_in_challenges', () => {
  it('a full round: code emailed, only hashes stored, the right code once, guesses counted atomically', async () => {
    const ann = await person('ann');
    const mails: string[] = [];
    const svc = createSignInChallenges({ store: createPrismaSignInChallengeStore(prisma), key: 'db-test-key', mailer: { isConfigured: () => true, async sendSignInCode(_to, code) { mails.push(code); } } });
    const view = await svc.start({ id: ann.id, email: ann.email }, 'VERIFY_EMAIL');
    const stored = await prisma.signInChallenge.findFirstOrThrow({ where: { userId: ann.id } });
    expect(JSON.stringify(stored)).not.toContain(mails[0]!);
    expect(JSON.stringify(stored)).not.toContain(view.token);
    // Signing in again (address typed in another case) reuses it: same row, no new code.
    const again = await svc.start({ id: ann.id, email: ann.email.toUpperCase() }, 'VERIFY_EMAIL');
    expect(again.codeSent).toBe(false);
    expect(await prisma.signInChallenge.count({ where: { userId: ann.id } })).toBe(1);
    const wrong = mails[0] === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(Array.from({ length: 7 }, () => svc.verify(again.token, wrong).then(() => 'ok', (e: { code: string }) => e.code)));
    expect(guesses.filter((g) => g === 'WRONG_CODE')).toHaveLength(5);
    expect(guesses.filter((g) => g === 'TOO_MANY_WRONG_CODES')).toHaveLength(2);
    expect((await prisma.signInChallenge.findFirstOrThrow({ where: { userId: ann.id } })).attempts).toBe(5);
  });

  it('the right code works once even when sent twice at the same moment', async () => {
    const bo = await person('bo');
    const mails: string[] = [];
    const svc = createSignInChallenges({ store: createPrismaSignInChallengeStore(prisma), key: 'db-test-key', mailer: { isConfigured: () => true, async sendSignInCode(_to, code) { mails.push(code); } } });
    const { token } = await svc.start({ id: bo.id, email: bo.email }, 'VERIFY_EMAIL');
    const results = await Promise.all([svc.verify(token, mails[0]!), svc.verify(token, mails[0]!)].map((p) => p.then(() => 'ok', (e: { code: string }) => e.code)));
    expect(results.sort()).toEqual(['SIGN_IN_EXPIRED', 'ok']);
  });
});

describe('Email verification on the database', () => {
  it('a code confirms only the address it went to (any case); the account becomes theirs; the last unverified admin is exempt', async () => {
    const ann = await person('ann');
    const verification = createEmailVerification({ repo: createPrismaVerificationRepo(prisma), mailConfigured: () => true });
    expect(await verification.confirm(ann.id, 'code', { email: `other${DOMAIN}` })).toBe('address-changed');
    expect(await verification.confirm(ann.id, 'code', { email: `ANN${DOMAIN.toUpperCase()}` })).toBe('verified');
    const r = await row(ann.id);
    expect(r.emailVerifiedAt).not.toBeNull();
    expect(r.activatedAt).not.toBeNull();
    // Admins: one verified admin elsewhere means a new unverified admin is asked.
    const repo = createPrismaVerificationRepo(prisma);
    const a1 = await person('a1', {}, ['ADMIN']);
    const before = await repo.otherVerifiedAdmins(a1.id);
    const a2 = await person('a2', { emailVerifiedAt: new Date() }, ['ADMIN']);
    expect(await repo.otherVerifiedAdmins(a1.id)).toBe(before + 1);
    await prisma.user.update({ where: { id: a2.id }, data: { status: 'INACTIVE' } });
    expect(await repo.otherVerifiedAdmins(a1.id)).toBe(before);
  });

  it('a sign-in records the first one as the account becoming theirs (once)', async () => {
    const ann = await person('ann');
    const auth = createAuthUsers(prisma);
    await auth.recordSignIn!(ann.id, new Date('2026-11-01T08:00:00Z'));
    await auth.recordSignIn!(ann.id, new Date('2026-11-02T08:00:00Z'));
    const r = await row(ann.id);
    expect(r.activatedAt?.toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(r.lastLoginAt?.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
});

describe('Status, as User Management and the Clients page list it', () => {
  it('Invited (live link) → Invite expired (7 days) → Active (signed in); verified shown; invitedAt kept on a resend', async () => {
    const users = createUserMgmt(prisma);
    const welcomes = createPrismaWelcomeTokenStore(prisma);
    const ann = await person('ann');
    expect((await users.findById(ann.id))!.onboarding).toBe('ACTIVE'); // never invited: a temporary-password account
    const first = new Date('2026-11-05T08:00:00Z');
    await welcomes.create({ userId: ann.id, tokenHash: `onb-w1-${ann.id}`, expiresAt: new Date(Date.now() + 7 * DAY) });
    await users.markWelcomeSent(ann.id, first);
    let view = await users.findById(ann.id);
    expect(view).toMatchObject({ onboarding: 'INVITED', invitedAt: first, emailVerifiedAt: null });
    expect(view!.inviteExpiresAt).not.toBeNull();
    // Resent two days later: invitedAt stays the first, welcomeSentAt moves.
    await users.markWelcomeSent(ann.id, new Date('2026-11-07T08:00:00Z'));
    view = (await users.list()).find((u) => u.id === ann.id)!;
    expect(view.invitedAt).toEqual(first);
    expect(view.welcomeSentAt).toEqual(new Date('2026-11-07T08:00:00Z'));
    // The link runs out: Invite expired.
    await prisma.loginOtp.updateMany({ where: { userId: ann.id }, data: { expiresAt: new Date(Date.now() - MIN) } });
    expect((await users.findById(ann.id))!.onboarding).toBe('INVITE_EXPIRED');
    // They sign in (a temporary password): Active.
    await createAuthUsers(prisma).recordSignIn!(ann.id, new Date());
    expect((await users.findById(ann.id))!.onboarding).toBe('ACTIVE');
    await prisma.user.update({ where: { id: ann.id }, data: { status: 'SUSPENDED' } });
    expect((await users.findById(ann.id))!.onboarding).toBe('DEACTIVATED');
  });

  it('the hourly sweep ends and audits an expired invitation once', async () => {
    const ann = await person('ann');
    await prisma.loginOtp.create({ data: { userId: ann.id, codeHash: `onb-sw-${ann.id}`, purpose: 'WELCOME', expiresAt: new Date(Date.now() - MIN), createdAt: new Date(Date.now() - 7 * DAY) } });
    const audit: { action: string; entityId?: string | null }[] = [];
    const sweep = createInvitationSweep({ store: createPrismaExpiredInvitationStore(prisma), audit: { record: async (e) => void audit.push(e) } });
    await Promise.all([sweep.run(), sweep.run()]);
    expect(audit.filter((a) => a.entityId === ann.id)).toEqual([expect.objectContaining({ action: 'user.invitation.expired', entityId: ann.id })]);
    expect((await prisma.loginOtp.findFirstOrThrow({ where: { userId: ann.id } })).consumedAt).not.toBeNull();
  });
});

describe('Set-password links on the database: what a link is, and using one', () => {
  it('a live invitation, then used (the account is theirs), then an unknown token', async () => {
    const ann = await person('ann');
    const { token, tokenHash } = generateResetToken();
    await createPrismaWelcomeTokenStore(prisma).create({ userId: ann.id, tokenHash, expiresAt: new Date(Date.now() + 7 * DAY) });
    const used: string[] = [];
    const svc = createPasswordResetService({
      store: createPrismaPasswordResetStore(prisma),
      users: createPrismaResetUserRepo(prisma),
      mailer: { isConfigured: () => true, async sendPasswordReset() {} },
      ttlSeconds: 3600,
      appUrl: 'https://t.test',
      hashPassword: async (p) => `h:${p}`,
      companyName: async () => 'Prolens Projects LLC',
      onLinkUsed: async (id, purpose) => {
        used.push(`${id}:${purpose}`);
        await prisma.user.updateMany({ where: { id, activatedAt: null }, data: { activatedAt: new Date() } });
      },
    });
    expect(await svc.linkStatus(token)).toEqual({ kind: 'welcome', state: 'live', company: 'Prolens Projects LLC' });
    await svc.resetPassword(token, 'NewPassword1');
    expect(used).toEqual([`${ann.id}:WELCOME`]);
    expect(await svc.linkStatus(token)).toEqual({ kind: 'welcome', state: 'used', company: 'Prolens Projects LLC' });
    expect((await svc.linkStatus('not-a-token')).state).toBe('unknown');
  });

  it('an administrator’s reset link lasts an hour, replaces the earlier one, and a second within the minute is refused', async () => {
    const ann = await person('ann');
    const links: string[] = [];
    const svc = createPasswordResetService({
      store: createPrismaPasswordResetStore(prisma),
      users: createPrismaResetUserRepo(prisma),
      mailer: { isConfigured: () => true, async sendPasswordReset(_to, link) { links.push(link); } },
      ttlSeconds: 3600,
      appUrl: 'https://t.test',
      hashPassword: async (p) => `h:${p}`,
    });
    expect((await svc.sendForAdministrator(ann.id)).sent).toBe(true);
    const rows = await prisma.loginOtp.findMany({ where: { userId: ann.id, purpose: 'PASSWORD_RESET' } });
    expect(rows).toHaveLength(1);
    expect(Math.round((rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime()) / MIN)).toBe(60);
    expect(await svc.sendForAdministrator(ann.id)).toMatchObject({ sent: false, reason: 'TOO_SOON' });
  });
});

describe('Duplicates on the database: trimmed and case-insensitive', () => {
  it('the check names the holder of an email or username whatever its case; deleted accounts never count', async () => {
    const ahmed = await person('ahmed', { firstName: 'Ahmed', lastName: 'Al Harthy', organisation: 'OXY' }, ['CLIENT']);
    const lookup = createPrismaIdentityLookup(prisma);
    const found = await checkIdentity(lookup, { email: `  AHMED${DOMAIN.toUpperCase()} `, username: 'ONB-AHMED' });
    expect(found.email).toMatchObject({ id: ahmed.id, name: 'Ahmed Al Harthy', kind: 'client', organisation: 'OXY' });
    expect(found.username).toMatchObject({ id: ahmed.id });
    // The same name at the same organisation (any case) — a gentle warning; another organisation isn't one.
    expect((await checkIdentity(lookup, { firstName: 'ahmed', lastName: 'al harthy', organisation: 'oxy', client: true })).sameName.map((m) => m.id)).toEqual([ahmed.id]);
    expect((await checkIdentity(lookup, { firstName: 'Ahmed', lastName: 'Al Harthy', organisation: 'PDO', client: true })).sameName).toEqual([]);
    // Editing Ahmed himself: no clash.
    expect((await checkIdentity(lookup, { email: ahmed.email, excludeId: ahmed.id })).email).toBeNull();
    await prisma.user.update({ where: { id: ahmed.id }, data: { deletedAt: new Date() } });
    expect((await checkIdentity(lookup, { email: ahmed.email })).email).toBeNull();
  });

  it('a new account with an existing address in another case is refused 409 on the email', async () => {
    await person('sara');
    const svc = createUserService({ users: createUserMgmt(prisma) });
    await expect(svc.createUser({ email: `SARA${DOMAIN.toUpperCase()}`, username: 'onb-sara2', password: 'Password1!', firstName: 'S', lastName: 'T' })).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_USER', details: { field: 'email' } });
  });
});

describe('Email change and client details on the database', () => {
  it('a changed address is not verified any more, links sent to the old one stop, and the change is told', async () => {
    const ann = await person('ann', { emailVerifiedAt: new Date('2026-10-01T00:00:00Z') });
    await createPrismaWelcomeTokenStore(prisma).create({ userId: ann.id, tokenHash: `onb-w-${ann.id}`, expiresAt: new Date(Date.now() + DAY) });
    const told: string[] = [];
    const svc = createUserService({ users: createUserMgmt(prisma), onEmailChanged: async (_id, from, to) => void told.push(`${from}>${to}`) });
    const after = await svc.updateUser(ann.id, { email: `ann.new${DOMAIN}` });
    expect(after.emailVerifiedAt).toBeNull();
    expect(await prisma.loginOtp.count({ where: { userId: ann.id, consumedAt: null } })).toBe(0);
    expect(told).toEqual([`ann${DOMAIN}>ann.new${DOMAIN}`]);
  });

  it('a new client needs an organisation and a proper phone; an edit judges only what changes', async () => {
    const admin = await person('boss', {}, ['ADMIN']);
    await role('CLIENT');
    const userService = createUserService({ users: createUserMgmt(prisma) });
    const accounts = createClientAccounts({ prisma, userService });
    const base = { firstName: 'Saif', lastName: 'Said', username: 'onb-saif', email: `saif${DOMAIN}`, password: 'Password1!' };
    await expect(accounts.create({ ...base }, { id: admin.id })).rejects.toMatchObject({ status: 400, details: { field: 'organisation' } });
    await expect(accounts.create({ ...base, organisation: 'OXY', phone: '+968-9000' }, { id: admin.id })).rejects.toMatchObject({ status: 400, details: { field: 'phone' } });
    const saif = await accounts.create({ ...base, organisation: 'OXY', phone: '+968 9000 0001' }, { id: admin.id });
    expect(saif).toMatchObject({ onboarding: 'ACTIVE', emailVerifiedAt: null, invitedAt: null, organisation: 'OXY' });
    // An older phone that predates the rule still saves with other changes; a new bad one doesn't.
    await prisma.user.update({ where: { id: saif.id }, data: { phone: '(968) 9000' } });
    expect((await accounts.update(saif.id, { firstName: 'Saeed', phone: '(968) 9000' }, { id: admin.id })).firstName).toBe('Saeed');
    await expect(accounts.update(saif.id, { phone: 'call me' }, { id: admin.id })).rejects.toMatchObject({ details: { field: 'phone' } });
    // The organisation can't be emptied.
    await expect(accounts.update(saif.id, { organisation: '  ' }, { id: admin.id })).rejects.toMatchObject({ details: { field: 'organisation' } });
  });
});
