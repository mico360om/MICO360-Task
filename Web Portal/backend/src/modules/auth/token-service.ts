import { createHash, randomUUID } from 'node:crypto';
import { signToken, verifyToken, type TokenClaims } from '../../lib/tokens';

/** Outcome of atomically spending a refresh token. */
export type RotateResult =
  | { status: 'rotated'; userId: string; familyId: string | null }
  /** Already spent (rotated / logged out / revoked) and not yet expired. */
  | { status: 'reused'; userId: string; familyId: string | null; revokedAt: Date }
  | { status: 'invalid' };

/** Persistence port for refresh tokens (Prisma-backed in prod, in-memory in tests). */
export interface RefreshTokenStore {
  /** `familyId` groups every token rotated from one sign-in. */
  save(userId: string, tokenHash: string, expiresAt: Date, familyId?: string): Promise<void>;
  /** Resolve a token hash to its owner iff it is still live (not expired, not revoked). */
  findValid(tokenHash: string): Promise<{ userId: string } | null>;
  /** Revoke a single token (logout). Idempotent. */
  revoke(tokenHash: string): Promise<void>;
  /** Revoke every live token for a user (logout-everywhere / password change). */
  revokeAllForUser(userId: string): Promise<void>;
  /**
   * Spend a live token in one conditional write (revokedAt = now only if still unrevoked), so two
   * concurrent refreshes can't both succeed. Stores without it fall back to find + revoke.
   */
  rotate?(tokenHash: string, now: Date): Promise<RotateResult>;
  /** Revoke every live token in a rotation family (refresh-token reuse → likely theft). */
  revokeFamily?(familyId: string): Promise<void>;
}

export interface TokenUser {
  id: string;
  roles: string[];
  /** The user's current tokenVersion (embedded as `ver`). Defaults to 0. */
  tokenVersion?: number;
}

export interface TokenServiceDeps {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number;
  refreshTtl: number;
  refreshStore: RefreshTokenStore;
  /**
   * A token spent less than this long ago is answered with a plain 401 instead of being treated
   * as theft — two tabs refreshing with the same token at once must not end the session. Default 10s.
   */
  reuseGraceMs?: number;
  now?: () => Date;
}

export type RefreshOutcome =
  | { ok: true; userId: string; familyId: string | undefined }
  | { ok: false; reason: 'invalid' | 'superseded' | 'reused' };

/** Hash a refresh token for storage — we never persist the raw token. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createTokenService({
  accessSecret,
  refreshSecret,
  accessTtl,
  refreshTtl,
  refreshStore,
  reuseGraceMs = 10_000,
  now = () => new Date(),
}: TokenServiceDeps) {
  /** Issue an access + refresh pair. Pass the spent token's `familyId` when rotating. */
  async function issueTokens(user: TokenUser, opts: { familyId?: string } = {}): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = signToken({ sub: user.id, type: 'access', roles: user.roles, ver: user.tokenVersion ?? 0 }, accessSecret, accessTtl);
    const refreshToken = signToken({ sub: user.id, type: 'refresh', jti: randomUUID() }, refreshSecret, refreshTtl);
    const expiresAt = new Date(now().getTime() + refreshTtl * 1000);
    await refreshStore.save(user.id, hashRefreshToken(refreshToken), expiresAt, opts.familyId ?? randomUUID());
    return { accessToken, refreshToken };
  }

  function verifyAccess(token: string): TokenClaims {
    return verifyToken(token, accessSecret);
  }

  /** Verify a refresh token's signature/expiry and that it is actually a refresh token. */
  function verifyRefresh(token: string): TokenClaims {
    const claims = verifyToken(token, refreshSecret);
    if (claims.type !== 'refresh') throw new Error('Not a refresh token');
    return claims;
  }

  /** Is this refresh token still live in the store? (Catches revoked / rotated-away / reused tokens.) */
  async function refreshTokenValid(token: string): Promise<boolean> {
    return (await refreshStore.findValid(hashRefreshToken(token))) !== null;
  }

  /**
   * Spend a refresh token for rotation (XP-04). Exactly one caller can spend a given token.
   * Presenting a token that was already spent more than `reuseGraceMs` ago means a copy is in
   * someone else's hands, so the whole rotation family is revoked; inside the grace window it is
   * just a concurrent refresh (another tab) and only this request fails.
   */
  async function rotateRefreshToken(token: string): Promise<RefreshOutcome> {
    let claims: TokenClaims;
    try {
      claims = verifyRefresh(token);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    const hash = hashRefreshToken(token);

    if (!refreshStore.rotate) {
      const live = await refreshStore.findValid(hash);
      if (!live || live.userId !== claims.sub) return { ok: false, reason: 'invalid' };
      await refreshStore.revoke(hash);
      return { ok: true, userId: live.userId, familyId: undefined };
    }

    const at = now();
    const result = await refreshStore.rotate(hash, at);
    if (result.status === 'invalid' || result.userId !== claims.sub) return { ok: false, reason: 'invalid' };
    if (result.status === 'rotated') return { ok: true, userId: result.userId, familyId: result.familyId ?? undefined };

    if (at.getTime() - result.revokedAt.getTime() < reuseGraceMs) return { ok: false, reason: 'superseded' };
    if (result.familyId && refreshStore.revokeFamily) await refreshStore.revokeFamily(result.familyId);
    else await refreshStore.revokeAllForUser(result.userId); // tokens from before families existed
    return { ok: false, reason: 'reused' };
  }

  /** Revoke a single refresh token (server-side logout). */
  async function revokeRefreshToken(token: string): Promise<void> {
    await refreshStore.revoke(hashRefreshToken(token));
  }

  /** Revoke every refresh token for a user (logout-everywhere / after a password change). */
  async function revokeAllForUser(userId: string): Promise<void> {
    await refreshStore.revokeAllForUser(userId);
  }

  return { issueTokens, verifyAccess, verifyRefresh, refreshTokenValid, rotateRefreshToken, revokeRefreshToken, revokeAllForUser };
}

export type TokenService = ReturnType<typeof createTokenService>;
