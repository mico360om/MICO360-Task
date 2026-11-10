import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import { calendarDay, idString, queryBoolean } from '../tasks/validation';
import { MAX_BIN_IDS, type BinService } from './bin-service';

/** The bin page's address: search, filters, sort and page — every one checked and bounded here. */
const listQuery = z.object({
  q: z.string().max(200).optional(),
  project: idString.optional(),
  deletedBy: idString.optional(),
  from: calendarDay.optional(),
  to: calendarDay.optional(),
  soon: queryBoolean.optional(),
  company: idString.optional(),
  sort: z.enum(['daysLeft', 'deleted']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
const taskIds = z.array(idString).min(1).max(MAX_BIN_IDS);
const restoreBody = z.object({ taskIds, wholeBatch: z.boolean().optional() });
const eraseBody = z.object({ taskIds });

export interface BinRouteDeps {
  service: BinService;
  guard: AuthGuard;
  /** companies: the request's picked company (X-Company-Id): the bin lists that company's projects. */
  pickOf?: PickOf;
}

/**
 * The Recycle Bin (staff only — a client account is refused by the guard's route table): the list with
 * its search and filters, who may use it, one deleted task read-only, restore, and delete forever
 * (administrators only). Every check is the service's: each task by its own project.
 */
export async function registerBinRoutes(app: FastifyInstance, deps: BinRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const pickOf = deps.pickOf ?? NO_PICK;
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  app.get('/recycle-bin', { preHandler: guard.authenticate }, async (req) => {
    const p = listQuery.parse(req.query);
    const page = await service.list(viewer(req), await pickOf(req), {
      q: p.q,
      projectId: p.project,
      deletedById: p.deletedBy,
      deletedFrom: p.from,
      deletedTo: p.to,
      soon: p.soon,
      companyId: p.company,
      sort: p.sort,
      limit: p.limit,
      offset: p.offset,
    });
    const { rows, ...meta } = page;
    return { data: rows, meta };
  });

  app.get('/recycle-bin/access', { preHandler: guard.authenticate }, async (req) => ({ data: await service.access(viewer(req)) }));

  app.get('/recycle-bin/tasks/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id } = z.object({ id: idString }).parse(req.params);
    return { data: await service.detail(viewer(req), id) };
  });

  app.post('/recycle-bin/restore', { preHandler: guard.authenticate }, async (req) => {
    const body = restoreBody.parse(req.body);
    return { data: await service.restore(viewer(req), body.taskIds, { wholeBatch: body.wholeBatch, ip: req.ip ?? null }) };
  });

  app.post('/recycle-bin/erase', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const body = eraseBody.parse(req.body);
    return { data: await service.erase(viewer(req), body.taskIds, { ip: req.ip ?? null }) };
  });
}
