import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { hashPassword, verifyPassword } from '../../src/lib/password';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createPrismaUserRepository as createUserMgmt } from '../../src/modules/users/prisma-user-repository';
import { createUserService } from '../../src/modules/users/user-service';
import { createWelcomeService } from '../../src/modules/users/welcome-service';
import { createPrismaWelcomeTokenStore } from '../../src/modules/users/prisma-welcome-store';
import { createClientAccounts } from '../../src/modules/clients/client-accounts';
import type { CreateAuditData } from '../../src/modules/audit/audit-repository';
import type { WelcomeEmailParams } from '../../src/modules/email/email-templates';

// 1.23.6 (coordinator ruling, 7 Nov): the live Android app's New user screen sends "welcome email on" with
// a typed password by default. On the real database, through POST /users and POST /clients: the server
// uses the invitation link (the safer way) and ignores the typed password — nothing of it is stored, the
// invitation goes, no forced change, and it is said and audited. Only this file's people (@owi.test).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const DOMAIN = '@owi.test';
const TYPED = 'Typed-Pass-11';

async function role(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name, ...(name === 'CLIENT' ? { id: 'role_builtin_client' } : {}) } });
}
async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { contains: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { contains: DOMAIN } } });
}

let app: Awaited<ReturnType<typeof buildApp>>;
let audited: CreateAuditData[];
let mails: { email: string; params: WelcomeEmailParams }[];
let adminHeaders: Record<string, string>;

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await clean();
  audited = [];
  mails = [];
  for (const r of ['ADMIN', 'EMPLOYEE', 'CLIENT']) await role(r);
  const admin = await prisma.user.create({
    data: { email: `admin${DOMAIN}`, username: 'owi-admin', passwordHash: await hashPassword('Own-Password-1'), firstName: 'Ada', lastName: 'Admin', roles: { create: [{ roleId: (await role('ADMIN')).id }] } },
  });
  const tokenService = createTokenService({
    accessSecret: 'owi-access',
    refreshSecret: 'owi-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  adminHeaders = { authorization: `Bearer ${(await tokenService.issueTokens({ id: admin.id, roles: ['ADMIN'] })).accessToken}` };
  const users = createUserMgmt(prisma);
  const userService = createUserService({ users });
  const auditService = { async record(e: CreateAuditData) { audited.push(e); return {} as never; }, async list() { return []; } };
  const welcomeService = createWelcomeService({
    users: { findById: (id) => users.findById(id), markWelcomeSent: (id, at) => users.markWelcomeSent(id, at) },
    tokens: createPrismaWelcomeTokenStore(prisma),
    mailer: {
      isConfigured: () => true,
      isBlocked: async () => false,
      async sendWelcome(email, params) {
        mails.push({ email, params });
        return 'sent';
      },
    },
    appUrl: 'https://task.mico360.test',
    endTemporaryPassword: (id) => userService.endTemporaryPassword(id),
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  app = await buildApp({ authService, tokenService, userService, auditService: auditService as never, welcomeService, clientAccounts: createClientAccounts({ prisma, userService, audit: auditService }) });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: adminHeaders, payload });
const row = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });

async function expectExactlyAnInvitation(res: Awaited<ReturnType<typeof post>>, email: string) {
  expect(res.statusCode).toBe(201);
  const { data, meta } = res.json();
  expect(meta).toMatchObject({ ignoredPassword: true, message: 'We sent an invitation link; the typed password wasn’t used (one way in).', welcome: { sent: true } });
  expect(res.body).not.toContain(TYPED);
  // Nothing of the typed password is stored: no forced change, no temporary-password mark, and it signs nobody in.
  const u = await row(email);
  expect(u).toMatchObject({ mustChangePassword: false, temporaryPasswordSetAt: null, temporaryPasswordSetById: null, temporaryPasswordExpiresAt: null, invitedAt: expect.any(Date) });
  expect(await verifyPassword(TYPED, u.passwordHash)).toBe(false);
  // Exactly an invitation: one live link, one email with it.
  expect(await prisma.loginOtp.count({ where: { userId: data.id, purpose: 'WELCOME', consumedAt: null } })).toBe(1);
  expect(mails.map((m) => m.email)).toEqual([email]);
  expect(mails[0]!.params.setPasswordLink).toMatch(/\/reset\?token=.+&welcome=1$/);
  // Audited: the typed password was ignored (never its value), and the invitation.
  const mine = audited.filter((a) => a.entityId === data.id).map((a) => a.action);
  expect(mine).toContain('user.password.ignored');
  expect(mine).toContain('user.welcome_email');
  expect(mine).not.toContain('user.password.temporary');
  expect(audited.find((a) => a.action === 'user.password.ignored')).toMatchObject({ module: 'users', entityId: data.id, newValue: { note: 'temporary password ignored — invitation sent instead' } });
  expect(JSON.stringify(audited)).not.toContain(TYPED);
}

describe('the Android app’s default: an invitation and a typed password together', () => {
  it('POST /users: exactly an invitation; the typed password is ignored, said and audited', async () => {
    const email = `sara${DOMAIN}`;
    const res = await post('/users', { email, username: 'owi-sara', firstName: 'Sara', lastName: 'K', roleNames: ['EMPLOYEE'], sendWelcome: true, password: TYPED });
    await expectExactlyAnInvitation(res, email);
  });

  it('POST /clients: the same', async () => {
    const email = `saif${DOMAIN}`;
    const res = await post('/clients', { email, username: 'owi-saif', firstName: 'Saif', lastName: 'S', organisation: 'OXY', sendWelcome: true, password: TYPED });
    await expectExactlyAnInvitation(res, email);
  });

  it('what can’t be resolved that way (a password made here together with anything else) is still refused, nothing made', async () => {
    for (const [url, extra] of [
      ['/users', { roleNames: ['EMPLOYEE'], sendWelcome: true, generatePassword: 'words' }],
      ['/users', { roleNames: ['EMPLOYEE'], password: TYPED, generatePassword: 'characters' }],
      ['/clients', { organisation: 'OXY', sendWelcome: true, generatePassword: 'words' }],
    ] as const) {
      const res = await post(url, { email: `x${DOMAIN}`, username: 'owi-x', firstName: 'X', lastName: 'Y', ...extra });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code).toBe('ONE_WAY_IN');
    }
    expect(await prisma.user.count({ where: { email: `x${DOMAIN}` } })).toBe(0);
    expect(mails).toEqual([]);
  });
});
