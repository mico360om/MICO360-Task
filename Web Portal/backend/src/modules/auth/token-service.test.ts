import { describe, it, expect } from 'vitest';
import { createTokenService, hashRefreshToken } from './token-service';
import { createMemoryRefreshTokenStore } from './memory-refresh-token-store';

function makeLegacyStore() {
  const saved: { userId: string; hash: string; expiresAt: Date; revokedAt: Date | null }[] = [];
  return {
    saved,
    async save(userId: string, hash: string, expiresAt: Date) {
      saved.push({ userId, hash, expiresAt, revokedAt: null });
    },
    async findValid(hash: string) {
      const row = saved.find((r) => r.hash === hash && r.revokedAt === null && r.expiresAt.getTime() > Date.now());
      return row ? { userId: row.userId } : null;
    },
    async revoke(hash: string) {
      const row = saved.find((r) => r.hash === hash && r.revokedAt === null);
      if (row) row.revokedAt = new Date();
    },
    async revokeAllForUser(userId: string) {
      for (const r of saved) if (r.userId === userId && r.revokedAt === null) r.revokedAt = new Date();
    },
  };
}

function makeService(store = makeLegacyStore()) {
  return {
    store,
    svc: createTokenService({
      accessSecret: 'access-secret',
      refreshSecret: 'refresh-secret',
      accessTtl: 900,
      refreshTtl: 1000,
      refreshStore: store,
    }),
  };
}

/** A token service over the rotating store with a controllable clock. */
function makeRotating(graceMs = 10_000) {
  const store = createMemoryRefreshTokenStore();
  let clock = Date.now();
  const svc = createTokenService({
    accessSecret: 'access-secret',
    refreshSecret: 'refresh-secret',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: store,
    reuseGraceMs: graceMs,
    now: () => new Date(clock),
  });
  return { svc, store, advance: (ms: number) => (clock += ms) };
}

describe('TokenService', () => {
  it('issues an access token carrying the user id, roles and token version', async () => {
    const { svc } = makeService();
    const { accessToken } = await svc.issueTokens({ id: 'u1', roles: ['ADMIN'], tokenVersion: 4 });
    const claims = svc.verifyAccess(accessToken);
    expect(claims.sub).toBe('u1');
    expect(claims.roles).toEqual(['ADMIN']);
    expect(claims.type).toBe('access');
    expect(claims.ver).toBe(4);
  });

  it('defaults the token version to 0', async () => {
    const { svc } = makeService();
    const { accessToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    expect(svc.verifyAccess(accessToken).ver).toBe(0);
  });

  it('persists only a HASH of the refresh token, never the token itself', async () => {
    const { svc, store } = makeService();
    const { refreshToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]!.userId).toBe('u1');
    expect(store.saved[0]!.hash).toBe(hashRefreshToken(refreshToken));
    expect(store.saved[0]!.hash).not.toBe(refreshToken);
  });

  it('rejects an access token verified with the wrong secret', async () => {
    const { svc } = makeService();
    const { refreshToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    // refresh token is signed with the refresh secret, so verifyAccess must reject it
    expect(() => svc.verifyAccess(refreshToken)).toThrow();
  });

  it('treats a freshly issued refresh token as valid against the store', async () => {
    const { svc } = makeService();
    const { refreshToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    expect(await svc.refreshTokenValid(refreshToken)).toBe(true);
  });

  it('invalidates a refresh token once it is revoked (server-side logout)', async () => {
    const { svc } = makeService();
    const { refreshToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    await svc.revokeRefreshToken(refreshToken);
    expect(await svc.refreshTokenValid(refreshToken)).toBe(false);
  });

  it('revokes every refresh token for a user (logout everywhere)', async () => {
    const { svc } = makeService();
    const a = await svc.issueTokens({ id: 'u1', roles: [] });
    const b = await svc.issueTokens({ id: 'u1', roles: [] });
    const other = await svc.issueTokens({ id: 'u2', roles: [] });
    await svc.revokeAllForUser('u1');
    expect(await svc.refreshTokenValid(a.refreshToken)).toBe(false);
    expect(await svc.refreshTokenValid(b.refreshToken)).toBe(false);
    expect(await svc.refreshTokenValid(other.refreshToken)).toBe(true);
  });

  it('still rotates with a store that has no atomic rotate (fallback)', async () => {
    const { svc } = makeService();
    const { refreshToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    expect(await svc.rotateRefreshToken(refreshToken)).toMatchObject({ ok: true, userId: 'u1' });
    expect(await svc.rotateRefreshToken(refreshToken)).toMatchObject({ ok: false });
  });
});

describe('TokenService.rotateRefreshToken (atomic rotation + reuse detection)', () => {
  it('spends a token once and keeps the rotation family', async () => {
    const { svc, store } = makeRotating();
    const first = await svc.issueTokens({ id: 'u1', roles: [] });
    const familyId = store.rows[0]!.familyId!;
    const spent = await svc.rotateRefreshToken(first.refreshToken);
    expect(spent).toEqual({ ok: true, userId: 'u1', familyId });
    await svc.issueTokens({ id: 'u1', roles: [] }, { familyId });
    expect(store.rows[1]!.familyId).toBe(familyId);
  });

  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    const { svc } = makeRotating();
    const { refreshToken } = await svc.issueTokens({ id: 'u1', roles: [] });
    const [a, b] = await Promise.all([svc.rotateRefreshToken(refreshToken), svc.rotateRefreshToken(refreshToken)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it('answers a reuse inside the grace window with a plain failure, without ending the session', async () => {
    const { svc, store, advance } = makeRotating(10_000);
    const first = await svc.issueTokens({ id: 'u1', roles: [] });
    const spent = await svc.rotateRefreshToken(first.refreshToken);
    const next = await svc.issueTokens({ id: 'u1', roles: [] }, { familyId: spent.ok ? spent.familyId : undefined });
    advance(3_000); // a second tab refreshing with the same token a moment later
    expect(await svc.rotateRefreshToken(first.refreshToken)).toEqual({ ok: false, reason: 'superseded' });
    expect(await svc.refreshTokenValid(next.refreshToken)).toBe(true);
    expect(store.rows[1]!.revokedAt).toBeNull();
  });

  it('revokes the whole family when an already-rotated token is replayed later (theft)', async () => {
    const { svc, advance } = makeRotating(10_000);
    const first = await svc.issueTokens({ id: 'u1', roles: [] });
    const spent = await svc.rotateRefreshToken(first.refreshToken);
    const next = await svc.issueTokens({ id: 'u1', roles: [] }, { familyId: spent.ok ? spent.familyId : undefined });
    const otherDevice = await svc.issueTokens({ id: 'u1', roles: [] }); // a separate sign-in
    advance(60_000);
    expect(await svc.rotateRefreshToken(first.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(await svc.refreshTokenValid(next.refreshToken)).toBe(false);
    expect(await svc.refreshTokenValid(otherDevice.refreshToken)).toBe(true);
  });

  it('rejects a forged / unknown token', async () => {
    const { svc } = makeRotating();
    expect(await svc.rotateRefreshToken('not-a-jwt')).toEqual({ ok: false, reason: 'invalid' });
  });
});
