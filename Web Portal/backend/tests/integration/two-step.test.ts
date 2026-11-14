import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { buildApp } from '../../src/app';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createPrismaRefreshTokenStore } from '../../src/modules/auth/prisma-refresh-token-store';
import { createPrismaUserRepository as createAuthUsers } from '../../src/modules/auth/prisma-user-repository';
import { createSignInChallenges } from '../../src/modules/auth/sign-in-challenge';
import { createPrismaSignInChallengeStore } from '../../src/modules/auth/prisma-sign-in-challenge-store';
import { createTwoStep } from '../../src/modules/auth/two-step';
import { createPrismaTrustedBrowserStore } from '../../src/modules/auth/prisma-trusted-browser-store';
import { createPrismaUserStateLookup } from '../../src/modules/auth/prisma-user-state-lookup';
import { hashPassword } from '../../src/lib/password';
import { testPrisma } from './test-prisma';

// 1.24 two-step sign-in for administrators on the real database (TEST_DATABASE_URL, migrations applied;
// MySQL 8 and MariaDB 11.8.9). Only this file's people (emails ending in @tstep.test) are made and removed.
const prisma = testPrisma();
const DOMAIN = '@tstep.test';
const DAY = 24 * 3600_000;
const PW = 'CorrectHorse1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let hash: string;
let mails: { to: string; code: string; kind: string }[];

async function role(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name } });
}
async function person(name: string, roles: string[]) {
  const ids = await Promise.all(roles.map(role));
  return prisma.user.create({
    data: { email: `${name}${DOMAIN}`, username: `tstep-${name}`, passwordHash: hash, firstName: name, lastName: 'T', emailVerifiedAt: new Date('2026-10-01T00:00:00Z'), roles: { create: ids.map((r) => ({ roleId: r.id })) } },
  });
}
async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // trusted browsers, tokens and challenges go with them (cascade)
}

function makeApp(o: { switchedOn?: boolean } = {}) {
  const twoStep = createTwoStep({ switchedOn: o.switchedOn ?? true, mailConfigured: () => true, store: createPrismaTrustedBrowserStore(prisma), key: 'db-trusted-browser-key-long-enough' });
  const signInChallenges = createSignInChallenges({
    store: createPrismaSignInChallengeStore(prisma),
    key: 'db-sign-in-key',
    mailer: { isConfigured: () => true, async sendSignInCode(to, code, opts) { mails.push({ to, code, kind: opts.kind }); } },
  });
  const tokenService = createTokenService({ accessSecret: 'db-access-secret-long', refreshSecret: 'db-refresh-secret-long', accessTtl: 900, refreshTtl: 3600, refreshStore: createPrismaRefreshTokenStore(prisma) });
  const authService = createAuthService({ users: createAuthUsers(prisma), maxAttempts: 50 });
  const audit = {
    record: async (e: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; newValue?: unknown }) =>
      prisma.auditLog.create({ data: { userId: e.userId, ip: e.ip, module: e.module, action: e.action, entityId: e.entityId, ...(e.newValue !== undefined ? { newValue: e.newValue as object } : {}) } }),
    list: async () => [],
    modules: async () => [],
  };
  return buildApp({ authService, tokenService, signInChallenges, twoStep, userState: createPrismaUserStateLookup(prisma), auditService: audit as never, rateLimitMax: 100_000, authRateLimitMax: 100_000 });
}
type App = Awaited<ReturnType<typeof makeApp>>;
const post = (app: App, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as Record<string, unknown>, headers: { 'user-agent': CHROME, ...headers } });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []).find((c) => /mico_tb_/.test(c))?.split(';')[0] ?? null;
const WEBSITE = { acceptChallenge: true, acceptPasswordChange: true };

async function signInWithCode(app: App, username: string, trustBrowser: boolean) {
  const first = await post(app, '/auth/login', { identifier: username, password: PW, ...WEBSITE });
  const { challenge } = first.json().data;
  return post(app, '/auth/challenge/verify', { challenge: challenge.token, code: mails[mails.length - 1]!.code, trustBrowser });
}

beforeAll(async () => {
  hash = await hashPassword(PW);
  await prisma.$connect();
});
beforeEach(async () => {
  mails = [];
  await clean();
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('the migration', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  it('is one add-only table in the lane’s range, written alike for MySQL 8 and MariaDB', () => {
    const folders = readdirSync(dir).filter((d) => d.includes('two_step'));
    expect(folders).toEqual(['20261120010000_two_step_trusted_browsers']);
    const sql = readFileSync(join(dir, folders[0]!, 'migration.sql'), 'utf8');
    expect(sql).not.toMatch(/--[^\n]*;/);
    const statements = sql.split(';').map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^CREATE TABLE `trusted_browsers`/);
    expect(statements[1]).toMatch(/^ALTER TABLE `trusted_browsers` ADD CONSTRAINT/);
    for (const s of statements) expect(portabilityProblems(s), s).toEqual([]);
    expect(sql).not.toMatch(/\b(DROP|RENAME|MODIFY|CHANGE)\b/i);
  });
});

describe('trusted browsers on the database', () => {
  it('store: made, found, counted live (version, expiry, revoked), forgotten — and they go with the account', async () => {
    const boss = await person('store', ['ADMIN']);
    const store = createPrismaTrustedBrowserStore(prisma);
    const now = new Date();
    await store.create({ id: `tb-a-${boss.id}`, userId: boss.id, sessionVersion: 0, label: 'Chrome on Windows', createdAt: now, expiresAt: new Date(now.getTime() + 30 * DAY) });
    await store.create({ id: `tb-b-${boss.id}`, userId: boss.id, sessionVersion: 0, label: 'Safari on iOS', createdAt: now, expiresAt: new Date(now.getTime() - 1000) });
    await store.create({ id: `tb-c-${boss.id}`, userId: boss.id, sessionVersion: 1, label: 'Edge on Windows', createdAt: now, expiresAt: new Date(now.getTime() + 30 * DAY) });
    expect(await store.find(`tb-a-${boss.id}`)).toMatchObject({ userId: boss.id, label: 'Chrome on Windows', revokedAt: null });
    expect(await store.countLive(boss.id, 0, now)).toBe(1);
    expect(await store.countLive(boss.id, 1, now)).toBe(1);
    expect(await store.revokeAll(boss.id, now)).toBe(3);
    expect(await store.revokeAll(boss.id, now)).toBe(0);
    expect(await store.countLive(boss.id, 0, now)).toBe(0);
    await prisma.user.delete({ where: { id: boss.id } });
    expect(await prisma.trustedBrowser.count({ where: { userId: boss.id } })).toBe(0);
  });

  it('an administrator: password → code (no session before it) → trusted; the next sign-in skips the code', async () => {
    const boss = await person('boss', ['ADMIN']);
    const app = await makeApp();
    const first = await post(app, '/auth/login', { identifier: 'tstep-boss', password: PW, ...WEBSITE });
    expect(first.json().data.accessToken).toBeUndefined();
    expect(first.json().data.challenge).toMatchObject({ kind: 'TWO_STEP', trustOffered: true });
    expect(await prisma.refreshToken.count({ where: { userId: boss.id } })).toBe(0);
    const done = await post(app, '/auth/challenge/verify', { challenge: first.json().data.challenge.token, code: mails[0]!.code, trustBrowser: true });
    expect(done.statusCode).toBe(200);
    const cookie = cookieOf(done)!;
    expect(await prisma.trustedBrowser.findMany({ where: { userId: boss.id }, select: { label: true, sessionVersion: true, revokedAt: true } })).toEqual([{ label: 'Chrome on Windows', sessionVersion: 0, revokedAt: null }]);
    mails = [];
    const again = await post(app, '/auth/login', { identifier: 'tstep-boss', password: PW, ...WEBSITE }, { cookie });
    expect(again.json().data.accessToken).toEqual(expect.any(String));
    expect(mails).toEqual([]);
    const actions = (await prisma.auditLog.findMany({ where: { userId: boss.id, module: 'auth' }, orderBy: { createdAt: 'asc' }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(['auth.two_step.code_sent', 'auth.two_step.passed', 'auth.two_step.browser_trusted']);
  });

  it('a password change (the session version moves on) asks again; Forget all asks again and keeps this page signed in', async () => {
    const boss = await person('chg', ['ADMIN']);
    const app = await makeApp();
    const done = await signInWithCode(app, 'tstep-chg', true);
    const cookie = cookieOf(done)!;
    const { accessToken } = done.json().data;
    const status = await app.inject({ method: 'GET', url: '/api/v1/auth/two-step', headers: { authorization: `Bearer ${accessToken}`, cookie } });
    expect(status.json().data).toMatchObject({ on: true, trustedBrowsers: 1, thisBrowserTrustedUntil: expect.any(String) });
    const forget = await app.inject({ method: 'POST', url: '/api/v1/auth/two-step/forget', headers: { authorization: `Bearer ${accessToken}`, cookie } });
    expect(forget.json().data).toEqual({ forgotten: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/two-step', headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(200);
    expect((await post(app, '/auth/login', { identifier: 'tstep-chg', password: PW, ...WEBSITE }, { cookie })).json().data.challenge).toBeDefined();
    // Trusted again, then the version moves on.
    const cookie2 = cookieOf(await signInWithCode(app, 'tstep-chg', true))!;
    await prisma.user.update({ where: { id: boss.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await post(app, '/auth/login', { identifier: 'tstep-chg', password: PW, ...WEBSITE }, { cookie: cookie2 })).json().data.challenge).toBeDefined();
  });

  it('the way the app and the extension sign in today (no flag): refused for an administrator, unchanged for an employee', async () => {
    await person('appadmin', ['ADMIN']);
    await person('appstaff', ['EMPLOYEE']);
    const app = await makeApp();
    const admin = await post(app, '/auth/login', { identifier: 'tstep-appadmin', password: PW });
    expect(admin.statusCode).toBe(403);
    expect(admin.json().error).toEqual({ code: 'ADMIN_WEBSITE_ONLY', message: 'Admins sign in on the website (two-step sign-in).' });
    const staff = await post(app, '/auth/login', { identifier: 'tstep-appstaff', password: PW });
    expect(staff.statusCode).toBe(200);
    const renewed = await post(app, '/auth/refresh', { refreshToken: staff.json().data.refreshToken });
    expect(renewed.statusCode).toBe(200);
  });

  it('an administrator’s session from before 1.24 (the app) ends at its next renewal; one renewed by the website goes on', async () => {
    const boss = await person('old', ['ADMIN']);
    const before = await makeApp({ switchedOn: false });
    const appSession = (await post(before, '/auth/login', { identifier: 'tstep-old', password: PW })).json().data;
    const webSession = (await post(before, '/auth/login', { identifier: 'tstep-old', password: PW, ...WEBSITE })).json().data;
    const after = await makeApp();
    const refused = await post(after, '/auth/refresh', { refreshToken: appSession.refreshToken });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe('ADMIN_WEBSITE_ONLY');
    const web = await post(after, '/auth/refresh', { refreshToken: webSession.refreshToken, acceptChallenge: true });
    expect(web.statusCode).toBe(200);
    // The app's whole session is over; the website's is live.
    expect(await prisma.refreshToken.count({ where: { userId: boss.id, revokedAt: null } })).toBe(1);
  });

  it('a double click on the code: one session, one trusted browser at most per success', async () => {
    const boss = await person('dbl', ['ADMIN']);
    const app = await makeApp();
    const { challenge } = (await post(app, '/auth/login', { identifier: 'tstep-dbl', password: PW, ...WEBSITE })).json().data;
    const code = mails[0]!.code;
    const [a, b] = await Promise.all([
      post(app, '/auth/challenge/verify', { challenge: challenge.token, code, trustBrowser: true }),
      post(app, '/auth/challenge/verify', { challenge: challenge.token, code, trustBrowser: true }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
    expect(await prisma.trustedBrowser.count({ where: { userId: boss.id } })).toBe(1);
  });
});
