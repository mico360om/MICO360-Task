import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AuditService } from './audit-service';
import type { AuthGuard } from '../auth/auth-guard';
import { shiftDayKey, zonedStartOfDay } from '../../lib/due-date';

export interface AuditRouteDeps {
  auditService: AuditService;
  guard: AuthGuard;
  /** Company time zone for the from/to day filters. Default Asia/Muscat. */
  timeZone?: string;
}

const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((k) => {
    const d = new Date(`${k}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === k;
  }, 'Not a real date');

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(200),
    before: z.string().datetime({ offset: true }).optional(),
    module: z.string().trim().min(1).max(100).optional(),
    userId: z.string().trim().min(1).max(100).optional(),
    from: dayKey.optional(),
    to: dayKey.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must be on or before `to`', path: ['from'] });

export async function registerAuditRoutes(app: FastifyInstance, deps: AuditRouteDeps): Promise<void> {
  const { auditService, guard } = deps;
  const timeZone = deps.timeZone ?? 'Asia/Muscat';

  // Newest first. Page with `before` = the oldest createdAt already shown; `from`/`to` are
  // inclusive company-local days.
  app.get('/audit-logs', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const q = listQuery.parse(req.query ?? {});
    return {
      data: await auditService.list({
        limit: q.limit,
        before: q.before ? new Date(q.before) : undefined,
        module: q.module,
        userId: q.userId,
        from: q.from ? zonedStartOfDay(q.from, timeZone) : undefined,
        to: q.to ? zonedStartOfDay(shiftDayKey(q.to, 1), timeZone) : undefined,
      }),
    };
  });
}
