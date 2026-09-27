import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TokenService } from './token-service';
import { ForbiddenError, UnauthorizedError } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; roles: string[] };
  }
}

/** The live account state an access token is checked against. */
export interface UserState {
  tokenVersion: number;
  /** ACTIVE and not deleted. */
  active: boolean;
  roles: string[];
}

export type UserStateLookup = (userId: string) => Promise<UserState | null>;

export interface AuthGuardOptions {
  /**
   * When provided, every request is checked against the user's current state: tokens whose `ver`
   * is stale, or whose user is gone / not ACTIVE, get 401, and role checks use the CURRENT roles
   * (a demotion takes effect at once instead of when the token expires).
   */
  userState?: UserStateLookup;
  /** How long a looked-up state is reused in-process. Default 10 seconds. */
  cacheTtlMs?: number;
  now?: () => number;
}

const MAX_CACHE_ENTRIES = 10_000;

/** Route guards for JWT auth (T2.2) and role-based access control (T2.4). */
export function createAuthGuard(tokenService: TokenService, opts: AuthGuardOptions = {}) {
  const { userState, cacheTtlMs = 10_000, now = () => Date.now() } = opts;
  const cache = new Map<string, { at: number; state: Promise<UserState | null> }>();

  function lookup(userId: string, fresh: boolean): Promise<UserState | null> {
    const hit = cache.get(userId);
    if (!fresh && hit && now() - hit.at < cacheTtlMs) return hit.state;
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    const state = userState!(userId);
    cache.set(userId, { at: now(), state });
    state.catch(() => cache.delete(userId));
    return state;
  }

  async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedError();

    const token = header.slice('Bearer '.length).trim();
    let claims;
    try {
      claims = tokenService.verifyAccess(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired token.');
    }
    if (!claims.sub || claims.type !== 'access') throw new UnauthorizedError();
    const tokenRoles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];

    if (!userState) {
      req.user = { id: claims.sub, roles: tokenRoles };
      return;
    }

    const ver = typeof claims.ver === 'number' ? claims.ver : 0;
    let state = await lookup(claims.sub, false);
    // Versions only grow, so a token NEWER than the cached state means the cache is stale (e.g. a
    // fresh session right after a password change) — re-read before deciding.
    if (state && ver > state.tokenVersion) state = await lookup(claims.sub, true);
    if (!state || !state.active || state.tokenVersion !== ver) {
      throw new UnauthorizedError('Your session has ended. Please sign in again.');
    }
    req.user = { id: claims.sub, roles: state.roles };
  }

  function requireRoles(...roles: string[]) {
    return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
      await authenticate(req, reply);
      const userRoles = req.user?.roles ?? [];
      if (!roles.some((r) => userRoles.includes(r))) throw new ForbiddenError();
    };
  }

  /** Drop a cached user state so the next request re-reads it (same-process revocations). */
  function forgetUser(userId: string): void {
    cache.delete(userId);
  }

  return { authenticate, requireRoles, forgetUser };
}

export type AuthGuard = ReturnType<typeof createAuthGuard>;
