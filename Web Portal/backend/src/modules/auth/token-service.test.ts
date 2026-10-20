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

/** A token service that records each rotation's successor (sealed), so a lost reply can be retried. */
function makeReplaying(replayWindowMs = 120_000) {
  const store = createMemoryRefreshTokenStore();
  let clock = Date.now();
  // A reversible stand-in for the app's secret box: what matters is that the stored value isn't the token.
  const box = { encrypt: (s: string) => `sealed:${Buffer.from(s).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(7), 'base64').toString() };
  const svc = createTokenService({
    accessSecret: 'access-secret',
    refreshSecret: 'refresh-secret',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: store,
    reuseGraceMs: 10_000,
    replayWindowMs,
    box,
    now: () => new Date(clock),
  });
  /** One refresh the way the /auth/refresh route does it: spend, issue the next pair, record it. */
  const refresh = async (token: string) => {
    const spent = await svc.rotateRefreshToken(token);
    if (!spent.ok || spent.replay) return spent;
    const next = await svc.issueTokens({ id: spent.userId, roles: [] }, { familyId: spent.familyId });
    await svc.recordSuccessor(token, next.refreshToken);
    return { ...spent, next: next.refreshToken };
  };
  return { svc, store, refresh, advance: (ms: number) => (clock += ms) };
}

describe('TokenService — a lost refresh reply can be retried', () => {
  it('a token spent by rotation, presented again within 2 minutes, returns the same successor and revokes nothing', async () => {
    const { svc, store, refresh, advance } = makeReplaying();
    const t0 = (await svc.issueTokens({ id: 'u1', roles: [] })).refreshToken;
    const first = await refresh(t0);
    const t1 = (first as { next: string }).next;
    advance(30_000); // the reply was lost; the phone tries again with the token it still has
    expect(await svc.rotateRefreshToken(t0)).toEqual({ ok: true, userId: 'u1', familyId: expect.any(String), replay: { refreshToken: t1 } });
    expect(await svc.refreshTokenValid(t1)).toBe(true);
    // The successor is stored sealed, never as the token itself.
    expect(JSON.stringify(store.rows)).not.toContain(t1);
  });

  it('after the replay window it is reuse and the family is revoked', async () => {
    const { svc, refresh, advance } = makeReplaying();
    const t0 = (await svc.issueTokens({ id: 'u1', roles: [] })).refreshToken;
    const t1 = ((await refresh(t0)) as { next: string }).next;
    advance(3 * 60_000);
    expect(await svc.rotateRefreshToken(t0)).toEqual({ ok: false, reason: 'reused' });
    expect(await svc.refreshTokenValid(t1)).toBe(false);
  });

  it('a logged-out token never replays', async () => {
    const { svc, advance } = makeReplaying();
    const t0 = (await svc.issueTokens({ id: 'u1', roles: [] })).refreshToken;
    await svc.revokeRefreshToken(t0);
    advance(30_000);
    expect((await svc.rotateRefreshToken(t0)).ok).toBe(false);
  });

  it('a successor that was itself used, or revoked by a password change, is not replayed', async () => {
    const { svc, refresh, advance } = makeReplaying();
    const t0 = (await svc.issueTokens({ id: 'u1', roles: [] })).refreshToken;
    const t1 = ((await refresh(t0)) as { next: string }).next;
    await refresh(t1); // the real phone already moved on to t2
    advance(30_000);
    expect((await svc.rotateRefreshToken(t0)).ok).toBe(false);

    const { svc: svc2, refresh: refresh2, advance: advance2 } = makeReplaying();
    const s0 = (await svc2.issueTokens({ id: 'u2', roles: [] })).refreshToken;
    await refresh2(s0);
    await svc2.revokeAllForUser('u2'); // password changed
    advance2(30_000);
    expect((await svc2.rotateRefreshToken(s0)).ok).toBe(false);
  });

  it('without a box nothing is recorded and behaviour is unchanged', async () => {
    const { svc, store, advance } = makeRotating(10_000);
    const t0 = (await svc.issueTokens({ id: 'u1', roles: [] })).refreshToken;
    const spent = await svc.rotateRefreshToken(t0);
    const t1 = (await svc.issueTokens({ id: 'u1', roles: [] }, { familyId: spent.ok ? spent.familyId : undefined })).refreshToken;
    await svc.recordSuccessor(t0, t1);
    expect(store.rows.every((r) => !('successorEnc' in r) || r.successorEnc === null)).toBe(true);
    advance(3_000);
    expect(await svc.rotateRefreshToken(t0)).toEqual({ ok: false, reason: 'superseded' });
  });

  it('issueAccessToken signs an access token alone', async () => {
    const { svc } = makeReplaying();
    const access = svc.issueAccessToken({ id: 'u1', roles: ['ADMIN'], tokenVersion: 3 });
    expect(svc.verifyAccess(access)).toMatchObject({ sub: 'u1', type: 'access', roles: ['ADMIN'] });
  });
});

describe('TokenService — fingerprint sign-in keys', () => {
  it('a key is a refresh token marked for fingerprint sign-in, in a family of its own, with an id the phone keeps', async () => {
    const { svc, store } = makeRotating();
    const { key, keyId } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    expect(svc.verifyRefresh(key)).toMatchObject({ sub: 'u1', type: 'refresh', purpose: 'biometric' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ purpose: 'biometric', hash: keyId });
    expect(keyId).toBe(hashRefreshToken(key));
    expect(await svc.verifyBiometricKey(key)).toEqual({ userId: 'u1' });
  });

  it('a key never refreshes a session (so it is never spent by one), and verifying it doesn’t spend it', async () => {
    const { svc } = makeRotating();
    const { key } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    expect(await svc.rotateRefreshToken(key)).toEqual({ ok: false, reason: 'invalid' });
    expect(await svc.verifyBiometricKey(key)).toEqual({ userId: 'u1' });
    expect(await svc.verifyBiometricKey(key)).toEqual({ userId: 'u1' });
  });

  it('only a live key passes: a session refresh token, a revoked key or junk do not', async () => {
    const { svc } = makeRotating();
    const session = await svc.issueTokens({ id: 'u1', roles: [] });
    expect(await svc.verifyBiometricKey(session.refreshToken)).toBeNull();
    const { key } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    await svc.revokeAllForUser('u1'); // password changed
    expect(await svc.verifyBiometricKey(key)).toBeNull();
    expect(await svc.verifyBiometricKey('junk')).toBeNull();
  });

  it('sessionOwner: a live session refresh token names its person; a key, a spent token or junk do not', async () => {
    const { svc } = makeRotating();
    const session = await svc.issueTokens({ id: 'u1', roles: [] });
    expect(await svc.sessionOwner(session.refreshToken)).toBe('u1');
    const { key } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    expect(await svc.sessionOwner(key)).toBeNull();
    await svc.rotateRefreshToken(session.refreshToken);
    expect(await svc.sessionOwner(session.refreshToken)).toBeNull();
    expect(await svc.sessionOwner('junk')).toBeNull();
  });

  it('a stolen session token caught being reused also cancels the person’s fingerprint keys', async () => {
    const { svc, advance } = makeRotating();
    const session = await svc.issueTokens({ id: 'u1', roles: [] });
    const { key } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    expect((await svc.rotateRefreshToken(session.refreshToken)).ok).toBe(true);
    advance(60_000); // past the grace window: theft
    expect(await svc.rotateRefreshToken(session.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(await svc.verifyBiometricKey(key)).toBeNull();
  });

  it('revokeBiometricKey cancels that one key, and only for its owner', async () => {
    const { svc } = makeRotating();
    const one = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    const two = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    await svc.revokeBiometricKey('u2', one.keyId); // someone else's id: nothing happens
    expect(await svc.verifyBiometricKey(one.key)).toEqual({ userId: 'u1' });
    await svc.revokeBiometricKey('u1', one.keyId);
    expect(await svc.verifyBiometricKey(one.key)).toBeNull();
    expect(await svc.verifyBiometricKey(two.key)).toEqual({ userId: 'u1' });
  });

  it('lasts 30 days (refreshTtl) from the person’s last use: each sign-in or refresh moves its end on', async () => {
    const { svc, store, advance } = makeRotating();
    const { keyId } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    const row = store.rows.find((r) => r.hash === keyId)!;
    const firstEnd = row.expiresAt.getTime();
    advance(500_000); // half of refreshTtl (1000 s)
    await svc.issueTokens({ id: 'u1', roles: [] });
    expect(row.expiresAt.getTime()).toBe(firstEnd + 500_000);
  });

  it('an ended key is not brought back by a later sign-in', async () => {
    const { svc, store } = makeRotating();
    const { key, keyId } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    const row = store.rows.find((r) => r.hash === keyId)!;
    row.expiresAt = new Date(Date.now() - 1000);
    await svc.issueTokens({ id: 'u1', roles: [] });
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(await svc.verifyBiometricKey(key)).toBeNull();
  });

  it('the key itself outlives refreshTtl; the stored end is what counts', async () => {
    const { svc } = makeRotating();
    const { key } = await svc.issueBiometricKey({ id: 'u1', roles: [] });
    const claims = svc.verifyRefresh(key) as { exp?: number; iat?: number };
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBeGreaterThanOrEqual(365 * 24 * 3600);
  });
});
