import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TokenService } from './token-service';
import { ForbiddenError, UnauthorizedError } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; roles: string[] };
  }
}

/** Route guards for JWT auth (T2.2) and role-based access control (T2.4). */
export function createAuthGuard(tokenService: TokenService) {
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

    req.user = { id: claims.sub, roles: Array.isArray(claims.roles) ? (claims.roles as string[]) : [] };
  }

  function requireRoles(...roles: string[]) {
    return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
      await authenticate(req, reply);
      const userRoles = req.user?.roles ?? [];
      if (!roles.some((r) => userRoles.includes(r))) throw new ForbiddenError();
    };
  }

  return { authenticate, requireRoles };
}

export type AuthGuard = ReturnType<typeof createAuthGuard>;
