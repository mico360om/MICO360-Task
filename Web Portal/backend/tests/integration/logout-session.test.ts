import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaRefreshTokenStore, SIGNED_OUT_MARK } from '../../src/modules/auth/prisma-refresh-token-store';
import { createTokenService, hashRefreshToken } from '../../src/modules/auth/token-service';

// Review fixes #4 (server part) and N2 (13 Nov 2026), against the database: Log out ends the whole
// session — even a renewal racing it — and a late copy is refused plainly, leaving fingerprint keys and
// other sign-ins alone. Only this file's people (emails ending in @logout.test) are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaRefreshTokenStore(prisma);
const box = { encrypt: (s: string) => `enc:v1:${Buffer.from(s).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(7), 'base64').toString() };
let clock = Date.now();
const svc = createTokenService({ accessSecret: 'a', refreshSecret: 'r', accessTtl: 900, refreshTtl: 3600, refreshStore: store, box, now: () => new Date(clock) });
const DOMAIN = '@logout.test';
let userId = '';

async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
/** One renewal the way POST /auth/refresh does it. Null: refused. */
async function renew(token: string): Promise<string | null> {
  const spent = await svc.rotateRefreshToken(token);
  if (!spent.ok) return null;
  if (spent.replay) return spent.replay.refreshToken;
  const next = await svc.issueTokens({ id: spent.userId, roles: [] }, { familyId: spent.familyId });
  return (await svc.completeRotation(token, next.refreshToken)) ? next.refreshToken : null;
}
const familyOf = async (token: string) => (await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } }))!.familyId!;
const liveInFamily = (familyId: string) => prisma.refreshToken.count({ where: { familyId, revokedAt: null, purpose: null } });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await clean();
  clock = Date.now();
  userId = (await prisma.user.create({ data: { email: `ada${DOMAIN}`, username: 'logout-ada', passwordHash: 'x', firstName: 'Ada', lastName: 'L' } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('Log out ends the whole session (database)', () => {
  it('a logout with a token already rotated ends the renewed one; a late copy is a plain refusal; keys and other sign-ins stay', async () => {
    const t0 = (await svc.issueTokens({ id: userId, roles: [] })).refreshToken;
    const { key } = await svc.issueBiometricKey({ id: userId, roles: [] });
    const phone = (await svc.issueTokens({ id: userId, roles: [] })).refreshToken;
    const t1 = (await renew(t0))!;
    await svc.endSession(t0);
    expect(await svc.refreshTokenValid(t1)).toBe(false);
    expect(await liveInFamily(await familyOf(t0))).toBe(0);
    clock += 60_000;
    expect(await svc.rotateRefreshToken(t0)).toEqual({ ok: false, reason: 'signed-out' });
    expect(await svc.rotateRefreshToken(t1)).toEqual({ ok: false, reason: 'signed-out' });
    expect(await svc.verifyBiometricKey(key)).toEqual({ userId });
    expect(await svc.refreshTokenValid(phone)).toBe(true);
  });

  it('a renewal and a logout racing each other: whatever the order, nothing of that session stays live', async () => {
    for (let i = 0; i < 15; i++) {
      const t0 = (await svc.issueTokens({ id: userId, roles: [] })).refreshToken;
      const familyId = await familyOf(t0);
      const [renewed] = await Promise.all([renew(t0), svc.endSession(t0)]);
      expect(await liveInFamily(familyId)).toBe(0);
      if (renewed) expect(await svc.refreshTokenValid(renewed)).toBe(false);
    }
  });

  it('a successor recorded after the logout never wipes its mark', async () => {
    const t0 = (await svc.issueTokens({ id: userId, roles: [] })).refreshToken;
    await svc.endSession(t0);
    await store.setSuccessor!(hashRefreshToken(t0), box.encrypt('anything'));
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(t0) } });
    expect(row?.successorEnc).toBe(SIGNED_OUT_MARK);
    expect(await store.signedOut!(hashRefreshToken(t0))).toBe(true);
  });

  it('without a logout, a stolen copy is still theft (the family and the fingerprint keys end)', async () => {
    const t0 = (await svc.issueTokens({ id: userId, roles: [] })).refreshToken;
    const { key } = await svc.issueBiometricKey({ id: userId, roles: [] });
    const t1 = (await renew(t0))!;
    clock += 3 * 60_000;
    expect(await svc.rotateRefreshToken(t0)).toEqual({ ok: false, reason: 'reused' });
    expect(await svc.refreshTokenValid(t1)).toBe(false);
    expect(await svc.verifyBiometricKey(key)).toBeNull();
  });
});
