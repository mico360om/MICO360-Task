import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from './auth-guard';
import { ForbiddenError } from './errors';
import { isAdminRoles, trustCookieHeader, type TwoStep } from './two-step';
import { readCookie } from '../../lib/cookies';

export interface TwoStepRouteDeps {
  twoStep: TwoStep;
  guard: AuthGuard;
  audit?: { record(entry: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; newValue?: unknown }): Promise<unknown> };
  /** Cookies are Secure (production); a request over https gets Secure cookies either way. */
  secureCookies?: boolean;
}

const ADMINS_ONLY = 'Two-step sign-in is for administrators.';

/**
 * 1.24 Settings → Security for administrators (Manager View too: it is their own sign-in, not a site
 * setting): whether two-step sign-in is on (and, for the red banner, why not), how many browsers are
 * trusted, until when this one is, and "Forget all trusted browsers" (this page stays signed in). Under
 * /auth so the browser sends its trusted-browser cookie with them.
 */
export async function registerTwoStepRoutes(app: FastifyInstance, deps: TwoStepRouteDeps): Promise<void> {
  const { twoStep, guard } = deps;
  const secure = (req: FastifyRequest) => deps.secureCookies === true || req.protocol === 'https';
  const me = (req: FastifyRequest) => {
    if (!isAdminRoles(req.user?.roles)) throw new ForbiddenError(ADMINS_ONLY);
    return { id: req.user!.id, tokenVersion: req.user!.ver ?? 0 };
  };

  app.get('/auth/two-step', { preHandler: guard.authenticate }, async (req) => {
    const person = me(req);
    const state = twoStep.state();
    const [trustedBrowsers, until] = await Promise.all([
      twoStep.count(person),
      twoStep.trustedUntil(person, readCookie(req.headers.cookie, twoStep.cookieName(person.id, secure(req)))),
    ]);
    return { data: { on: state.on, reason: state.reason, trustedBrowsers, thisBrowserTrustedUntil: until ? until.toISOString() : null } };
  });

  app.post('/auth/two-step/forget', { preHandler: guard.authenticate }, async (req, reply) => {
    const person = me(req);
    const forgotten = await twoStep.forgetAll(person.id);
    reply.header('set-cookie', trustCookieHeader(twoStep.cookieName(person.id, secure(req)), '', 0, secure(req)));
    await deps.audit
      ?.record({ userId: person.id, ip: req.ip ?? null, module: 'auth', action: 'auth.two_step.browsers_forgotten', entityId: person.id, newValue: { count: forgotten } })
      .catch(() => undefined);
    return reply.send({ data: { forgotten } });
  });
}
