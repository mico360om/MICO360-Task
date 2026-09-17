import { describe, it, expect } from 'vitest';
import { createTokenService, hashRefreshToken } from './token-service';

function makeStore() {
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

function makeService(store = makeStore()) {
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

describe('TokenService', () => {
  it('issues an access token carrying the user id and roles', async () => {
    const { svc } = makeService();
    const { accessToken } = await svc.issueTokens({ id: 'u1', roles: ['ADMIN'] });
    const claims = svc.verifyAccess(accessToken);
    expect(claims.sub).toBe('u1');
    expect(claims.roles).toEqual(['ADMIN']);
    expect(claims.type).toBe('access');
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
});
