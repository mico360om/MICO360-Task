import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import { NotFoundError } from '../../lib/http-errors';
import type { ErrorLogService } from './error-log-service';
import type { DatabaseCheckResult } from './database-check';

export interface ErrorLogRouteDeps {
  service: ErrorLogService;
  guard: AuthGuard;
  /** The verified signed-in person of a request (its bearer token), or null — never taken from the body. */
  userIdOf: (req: FastifyRequest) => string | null;
  audit?: AuditService;
  /** 1.23.1: the database self-check's latest result (null until it ran), shown above the rows. */
  databaseCheck?: { latest(): DatabaseCheckResult | null };
}

/** A batch of the page's reports, or one of the browser's security-policy reports, is never bigger than this. */
export const CLIENT_ERROR_BODY_LIMIT = 16 * 1024;
/** Told to a page while an administrator has "Collect browser errors" switched off: it stops sending. */
export const COLLECT_HEADER = 'x-collect-browser-errors';

const listQuery = z.object({
  kind: z.enum(['all', 'errors', 'blocked', 'slow', 'server']).default('all'),
  range: z.enum(['today', '7d', '30d']).default('7d'),
  q: z.string().max(100).optional(),
  status: z.enum(['open', 'fixed']).default('open'),
  before: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const idParam = z.object({ id: z.string().min(1).max(64) });

/**
 * Whatever goes wrong with a report — a body too big, of another type, not JSON — the page is answered
 * 204 like any other: nothing it sends about an error may ever cause one it would show.
 */
const quiet = (_err: unknown, _req: FastifyRequest, reply: FastifyReply) => reply.code(204).send();
/** The API's own per-person limit would answer 429; these routes have their own (dropped quietly). */
const reportRoute = { bodyLimit: CLIENT_ERROR_BODY_LIMIT, config: { rateLimit: false as const }, errorHandler: quiet };

async function answer(service: ErrorLogService, reply: FastifyReply) {
  if (!(await service.collectingNow())) reply.header(COLLECT_HEADER, 'off');
  return reply.code(204).send();
}

/**
 * The Error log (1.22.4). Browsers send their errors, blocked files and slow pages to
 * POST /client-errors (any page, signed in or not: the sign-in page matters too) and their own
 * security-policy reports to POST /client-errors/csp. System Settings → Error log reads them with the
 * server's own errors (administrators only).
 */
export async function registerErrorLogRoutes(app: FastifyInstance, deps: ErrorLogRouteDeps): Promise<void> {
  const { service } = deps;
  const admin = { preHandler: deps.guard.requireRoles('ADMIN') };

  app.post('/client-errors', reportRoute, async (req, reply) => {
    service.acceptClientBatch({ body: req.body, ip: req.ip, userAgent: req.headers['user-agent'], userId: deps.userIdOf(req) });
    return answer(service, reply);
  });

  // The browser's own reports come in their own content types, read as text here (this scope only).
  await app.register(async (app) => {
    app.addContentTypeParser(['application/csp-report', 'application/reports+json'], { parseAs: 'string', bodyLimit: CLIENT_ERROR_BODY_LIMIT }, (_req, body, done) => done(null, body));
    app.post('/client-errors/csp', reportRoute, async (req, reply) => {
      service.acceptCspReports({ body: req.body, ip: req.ip, userAgent: req.headers['user-agent'] });
      return answer(service, reply);
    });
  });

  app.get('/error-log', admin, async (req) => {
    const q = listQuery.parse(req.query);
    const page = await service.list({ kind: q.kind, range: q.range, q: q.q ?? null, status: q.status, before: q.before ?? null, limit: q.limit });
    // 1.23.1: "Database check: OK (MySQL 8.0.46)" or its problems (administrators only, like the rest).
    return { data: { ...page, databaseCheck: deps.databaseCheck?.latest() ?? null } };
  });

  app.get('/error-log/:id', admin, async (req) => {
    const { id } = idParam.parse(req.params);
    const found = await service.detail(id);
    if (!found) throw new NotFoundError('That error is no longer in the log.');
    return { data: found };
  });

  const record = (req: FastifyRequest, action: string, id: string, title: string) =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'error-log', action, entityId: id, oldValue: null, newValue: { title } });

  app.post('/error-log/:id/fixed', admin, async (req) => {
    const { id } = idParam.parse(req.params);
    const group = await service.markFixed(id, req.user!.id);
    if (!group) throw new NotFoundError('That error is no longer in the log.');
    await record(req, 'error-log.fixed', id, group.title);
    return { data: group };
  });

  app.delete('/error-log/:id/fixed', admin, async (req) => {
    const { id } = idParam.parse(req.params);
    const group = await service.reopen(id);
    if (!group) throw new NotFoundError('That error is no longer in the log.');
    await record(req, 'error-log.not-fixed', id, group.title);
    return { data: group };
  });

  // The page asks once when it opens: the rows first seen (or back) since then are marked new.
  app.post('/error-log/visit', admin, async (req) => {
    const previous = await service.visit(req.user!.id);
    return { data: { previousVisitAt: previous ? previous.toISOString() : null } };
  });
}
