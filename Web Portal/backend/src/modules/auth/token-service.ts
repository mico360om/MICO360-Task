import { createHash, randomUUID } from 'node:crypto';
import { signToken, verifyToken, type TokenClaims } from '../../lib/tokens';

/** Persistence port for refresh tokens (Prisma-backed in prod, in-memory in tests). */
export interface RefreshTokenStore {
  save(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Resolve a token hash to its owner iff it is still live (not expired, not revoked). */
  findValid(tokenHash: string): Promise<{ userId: string } | null>;
  /** Revoke a single token (logout / rotation). Idempotent. */
  revoke(tokenHash: string): Promise<void>;
  /** Revoke every live token for a user (logout-everywhere / password change). */
  revokeAllForUser(userId: string): Promise<void>;
}

export interface TokenUser {
  id: string;
  roles: string[];
}

export interface TokenServiceDeps {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number;
  refreshTtl: number;
  refreshStore: RefreshTokenStore;
}

/** Hash a refresh token for storage — we never persist the raw token. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createTokenService({ accessSecret, refreshSecret, accessTtl, refreshTtl, refreshStore }: TokenServiceDeps) {
  async function issueTokens(user: TokenUser): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = signToken({ sub: user.id, type: 'access', roles: user.roles }, accessSecret, accessTtl);
    const refreshToken = signToken({ sub: user.id, type: 'refresh', jti: randomUUID() }, refreshSecret, refreshTtl);
    const expiresAt = new Date(Date.now() + refreshTtl * 1000);
    await refreshStore.save(user.id, hashRefreshToken(refreshToken), expiresAt);
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

  /** Revoke a single refresh token (server-side logout / rotation of the old token). */
  async function revokeRefreshToken(token: string): Promise<void> {
    await refreshStore.revoke(hashRefreshToken(token));
  }

  /** Revoke every refresh token for a user (logout-everywhere / after a password change). */
  async function revokeAllForUser(userId: string): Promise<void> {
    await refreshStore.revokeAllForUser(userId);
  }

  return { issueTokens, verifyAccess, verifyRefresh, refreshTokenValid, revokeRefreshToken, revokeAllForUser };
}

export type TokenService = ReturnType<typeof createTokenService>;
