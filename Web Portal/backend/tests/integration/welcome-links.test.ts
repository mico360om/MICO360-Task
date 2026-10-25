import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaPasswordResetStore } from '../../src/modules/auth/prisma-password-reset-store';
import { createPrismaWelcomeTokenStore } from '../../src/modules/users/prisma-welcome-store';
import { createPrismaUserRepository as createUserMgmt } from '../../src/modules/users/prisma-user-repository';
import { createPrismaUserRepository as createAuthUsers } from '../../src/modules/auth/prisma-user-repository';
import { createPrismaResetUserRepo } from '../../src/modules/auth/prisma-reset-user-repo';
import { createPasswordResetService } from '../../src/modules/auth/password-reset-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createUserService } from '../../src/modules/users/user-service';
import { createWelcomeService } from '../../src/modules/users/welcome-service';
import { hashPassword } from '../../src/lib/password';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's people
// (emails ending in @wlk.test) are made and removed: the shared test database may hold others.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const resets = createPrismaPasswordResetStore(prisma);
const welcomes = createPrismaWelcomeTokenStore(prisma);
const userMgmt = createUserMgmt(prisma);
const DOMAIN = '@wlk.test';
const WEEK = 7 * 24 * 3600 * 1000;

async function person(name: string) {
  return prisma.user.create({ data: { email: `${name}${DOMAIN}`, username: `wlk-${name}`, passwordHash: 'x', firstName: name, lastName: 'T' } });
}
async function clean() {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } }); // their links go with them (cascade)
}
const liveLinks = async (userId: string) =>
  (await prisma.loginOtp.findMany({ where: { userId, consumedAt: null }, orderBy: { createdAt: 'asc' } })).map((r) => `${r.purpose}:${r.codeHash}`);

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('Welcome links (login_otps, purpose WELCOME)', () => {
  it('a welcome link is stored with its own expiry and is accepted by the set-password (reset) page', async () => {
    const ada = await person('ada');
    const expiresAt = new Date(Date.now() + WEEK);
    const id = await welcomes.create({ userId: ada.id, tokenHash: 'w-hash-1', expiresAt });
    const found = await resets.findActiveByHash('w-hash-1');
    expect(found).toMatchObject({ id, userId: ada.id });
    expect(found!.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect((await prisma.loginOtp.findUniqueOrThrow({ where: { id } })).purpose).toBe('WELCOME');
  });

  it('sending again replaces the earlier welcome link, only once the new one has gone', async () => {
    const ada = await person('ada');
    const first = await welcomes.create({ userId: ada.id, tokenHash: 'w-1', expiresAt: new Date(Date.now() + WEEK) });
    await welcomes.replaceEarlier(ada.id, first);
    const second = await welcomes.create({ userId: ada.id, tokenHash: 'w-2', expiresAt: new Date(Date.now() + WEEK) });
    // Until the new email has gone, the earlier link still works…
    expect(await liveLinks(ada.id)).toEqual(['WELCOME:w-1', 'WELCOME:w-2']);
    await welcomes.replaceEarlier(ada.id, second);
    // …then only the newest one does.
    expect(await liveLinks(ada.id)).toEqual(['WELCOME:w-2']);
    expect(await resets.findActiveByHash('w-1')).toBeNull();
  });

  it('a welcome email that couldn’t be sent leaves no working link behind (and keeps the earlier one)', async () => {
    const ada = await person('ada');
    const first = await welcomes.create({ userId: ada.id, tokenHash: 'w-1', expiresAt: new Date(Date.now() + WEEK) });
    await welcomes.replaceEarlier(ada.id, first);
    const failed = await welcomes.create({ userId: ada.id, tokenHash: 'w-2', expiresAt: new Date(Date.now() + WEEK) });
    await welcomes.discard(failed);
    expect(await liveLinks(ada.id)).toEqual(['WELCOME:w-1']);
  });

  it('a welcome link and a password-reset link live side by side; using either ends both (single use)', async () => {
    const ada = await person('ada');
    const w = await welcomes.create({ userId: ada.id, tokenHash: 'w-1', expiresAt: new Date(Date.now() + WEEK) });
    await welcomes.replaceEarlier(ada.id, w);
    await resets.create({ userId: ada.id, tokenHash: 'r-1', expiresAt: new Date(Date.now() + 3600_000) });
    // A reset request doesn't end the welcome link, and the reset throttle counts reset links only.
    expect(await liveLinks(ada.id)).toEqual(['WELCOME:w-1', 'PASSWORD_RESET:r-1']);
    expect(await resets.countIssuedSince(ada.id, new Date(Date.now() - 60_000))).toBe(1);
    // The reset link is used: every other link for the person, the welcome link too, stops working.
    const r = (await resets.findActiveByHash('r-1'))!;
    expect(await resets.consume(r.id)).toBe(true);
    await resets.consumeAllForUser(ada.id);
    expect(await liveLinks(ada.id)).toEqual([]);
    expect(await resets.consume(w)).toBe(false);
  });

  it('a welcome link works once', async () => {
    const ada = await person('ada');
    const w = await welcomes.create({ userId: ada.id, tokenHash: 'w-1', expiresAt: new Date(Date.now() + WEEK) });
    expect(await resets.consume(w)).toBe(true);
    expect(await resets.consume(w)).toBe(false);
    expect(await resets.findActiveByHash('w-1')).toBeNull();
  });

  it('a password set by an administrator or by the person also ends an unused welcome link', async () => {
    const ada = await person('ada');
    const w = await welcomes.create({ userId: ada.id, tokenHash: 'w-1', expiresAt: new Date(Date.now() + WEEK) });
    await welcomes.replaceEarlier(ada.id, w);
    await userMgmt.setPassword(ada.id, 'new-hash');
    expect(await liveLinks(ada.id)).toEqual([]);
  });

  it('a sign-in code is never accepted as a set-password link', async () => {
    const ada = await person('ada');
    await prisma.loginOtp.create({ data: { userId: ada.id, codeHash: 'otp-1', expiresAt: new Date(Date.now() + 600_000), purpose: 'LOGIN' } });
    expect(await resets.findActiveByHash('otp-1')).toBeNull();
  });

  it('records when a welcome email went (shown in User Management)', async () => {
    const ada = await person('ada');
    const at = new Date('2026-10-24T05:12:00.000Z');
    await userMgmt.markWelcomeSent!(ada.id, at);
    expect((await userMgmt.findById(ada.id))?.welcomeSentAt?.toISOString()).toBe(at.toISOString());
  });
});

describe('A welcome link from start to finish (database stores, sign-in and the set-password page)', () => {
  function rig(clock: { t: number }) {
    const links: string[] = [];
    const now = () => new Date(clock.t);
    const welcome = createWelcomeService({
      users: userMgmt,
      tokens: welcomes,
      mailer: {
        isConfigured: () => true,
        isBlocked: async () => false,
        async sendWelcome(_email, p) {
          links.push(p.setPasswordLink);
          return 'sent' as const;
        },
      },
      appUrl: 'https://task.mico360.test',
      now,
    });
    const reset = createPasswordResetService({
      store: resets,
      users: createPrismaResetUserRepo(prisma),
      mailer: { async sendPasswordReset() {} },
      ttlSeconds: 3600,
      appUrl: 'https://task.mico360.test',
      hashPassword,
      now,
    });
    const auth = createAuthService({ users: createAuthUsers(prisma), maxAttempts: 5 });
    const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;
    return { welcome, reset, auth, links, tokenOf };
  }

  it('the current password works until the link is used; then only the new one does, and the link is spent', async () => {
    const clock = { t: Date.now() };
    const r = rig(clock);
    const sara = await createUserService({ users: userMgmt }).createUser({ email: `sara${DOMAIN}`, username: 'wlk-sara', password: 'OldPass123', firstName: 'Sara', lastName: 'K' });
    expect((await r.welcome.send(sara.id)).sent).toBe(true);
    await expect(r.auth.login('wlk-sara', 'OldPass123')).resolves.toMatchObject({ id: sara.id });

    const token = r.tokenOf(r.links[0]!);
    await r.reset.resetPassword(token, 'NewPass456');
    await expect(r.auth.login('wlk-sara', 'OldPass123')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(r.auth.login('wlk-sara', 'NewPass456')).resolves.toMatchObject({ id: sara.id });
    await expect(r.reset.resetPassword(token, 'Another789')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('an account made without a password can only be signed in to once its password is set with the link', async () => {
    const r = rig({ t: Date.now() });
    const bo = await createUserService({ users: userMgmt }).createUser({ email: `bo${DOMAIN}`, username: 'wlk-bo', firstName: 'Bo', lastName: 'K' });
    await r.welcome.send(bo.id);
    await expect(r.auth.login('wlk-bo', '')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await r.reset.resetPassword(r.tokenOf(r.links[0]!), 'BoPass123');
    await expect(r.auth.login('wlk-bo', 'BoPass123')).resolves.toMatchObject({ id: bo.id });
  });

  it('works for 7 days, not a moment longer', async () => {
    const clock = { t: Date.now() };
    const r = rig(clock);
    const ada = await person('ada');
    await r.welcome.send(ada.id);
    const token = r.tokenOf(r.links[0]!);
    clock.t += WEEK + 1000;
    await expect(r.reset.resetPassword(token, 'NewPass456')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    clock.t -= 2000; // a moment before the 7 days are up, it still works
    await expect(r.reset.resetPassword(token, 'NewPass456')).resolves.toEqual({ reset: true });
  });

  it('sending again replaces the earlier link: the first one no longer works', async () => {
    const clock = { t: Date.now() };
    const r = rig(clock);
    const ada = await person('ada');
    await r.welcome.send(ada.id);
    clock.t += 2 * 60_000;
    await r.welcome.send(ada.id);
    await expect(r.reset.resetPassword(r.tokenOf(r.links[0]!), 'NewPass456')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    await expect(r.reset.resetPassword(r.tokenOf(r.links[1]!), 'NewPass456')).resolves.toEqual({ reset: true });
  });

  it('a mistyped address fixed by the administrator: the link sent to it no longer sets a password', async () => {
    const r = rig({ t: Date.now() });
    const users = createUserService({ users: userMgmt });
    const sara = await users.createUser({ email: `sara.typo${DOMAIN}`, username: 'wlk-sara', firstName: 'Sara', lastName: 'K' });
    await r.welcome.send(sara.id);
    await users.updateUser(sara.id, { email: `sara${DOMAIN}` });
    await expect(r.reset.resetPassword(r.tokenOf(r.links[0]!), 'Stolen123')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    await expect(r.auth.login('wlk-sara', 'Stolen123')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('a suspended account: its link no longer works, not even once it is made active again', async () => {
    const r = rig({ t: Date.now() });
    const users = createUserService({ users: userMgmt });
    const bo = await users.createUser({ email: `bo${DOMAIN}`, username: 'wlk-bo', firstName: 'Bo', lastName: 'K' });
    await r.welcome.send(bo.id);
    await users.setUserStatus(bo.id, 'SUSPENDED');
    await expect(r.reset.resetPassword(r.tokenOf(r.links[0]!), 'BoPass123')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    await users.setUserStatus(bo.id, 'ACTIVE');
    await expect(r.reset.resetPassword(r.tokenOf(r.links[0]!), 'BoPass123')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('the set-password page refuses a link for an account that isn’t active, whatever made it so (same words as an expired link)', async () => {
    const r = rig({ t: Date.now() });
    const ada = await person('ada');
    const cy = await person('cy');
    await r.welcome.send(ada.id);
    await r.welcome.send(cy.id);
    // Changed straight in the database (not through the user service), so only the page's own check stands.
    await prisma.user.update({ where: { id: ada.id }, data: { status: 'INACTIVE' } });
    await prisma.user.update({ where: { id: cy.id }, data: { deletedAt: new Date() } });
    for (const link of r.links) {
      await expect(r.reset.resetPassword(r.tokenOf(link), 'NewPass456')).rejects.toMatchObject({
        code: 'INVALID_RESET_TOKEN',
        message: 'This reset link is invalid or has expired. Request a new one.',
      });
    }
  });

  it('a locked but active account can still use its link, which unlocks it', async () => {
    const r = rig({ t: Date.now() });
    const ada = await person('ada');
    await r.welcome.send(ada.id);
    await prisma.user.update({ where: { id: ada.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
    await expect(r.reset.resetPassword(r.tokenOf(r.links[0]!), 'NewPass456')).resolves.toEqual({ reset: true });
    await expect(r.auth.login('wlk-ada', 'NewPass456')).resolves.toMatchObject({ id: ada.id });
  });
});
