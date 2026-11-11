import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../../auth/auth-guard';
import { idString } from '../validation';
import { BULK_STATUSES, MAX_BULK_TASKS, type BulkAction, type TaskBulkService } from './task-bulk';

/** People or guests named in one change. */
const MAX_NAMED = 20;
const ids = (min: number) => z.array(idString).min(min).max(MAX_NAMED);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day like 2026-11-20.');

// Written for zod 3 and zod 4 alike (plain objects in a union; no discriminator with repeated keys).
export const bulkActionSchema = z.union([
  z.object({ type: z.literal('status'), status: z.enum(BULK_STATUSES) }),
  z.object({ type: z.literal('priority'), priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']) }),
  z.object({ type: z.literal('assign'), userIds: ids(1) }),
  z.object({ type: z.literal('reassign'), userIds: ids(1) }),
  z.object({ type: z.literal('unassign'), userIds: ids(1).optional() }),
  z.object({ type: z.literal('dueDate'), mode: z.literal('set'), date: day }),
  z.object({ type: z.literal('dueDate'), mode: z.literal('clear') }),
  z.object({ type: z.literal('dueDate'), mode: z.literal('shift'), days: z.number().int().min(-365).max(365).refine((n) => n !== 0, 'Shift by at least one day.') }),
  z.object({ type: z.literal('project'), projectId: idString, columnId: idString.optional(), assignees: z.enum(['ADD_TO_TEAM', 'UNASSIGN']).optional() }),
  z.object({ type: z.literal('category'), add: z.array(idString).max(50).optional(), remove: z.array(idString).max(50).optional() }),
  z.object({ type: z.literal('guests'), add: ids(1) }),
  z.object({ type: z.literal('duplicate') }),
  z.object({ type: z.literal('archive') }),
  z.object({ type: z.literal('unarchive') }),
  z.object({ type: z.literal('delete') }),
]);

/** The ids are checked for size by the service (one more than 500 says so plainly). */
const runSchema = z.object({
  taskIds: z.array(idString).min(1).max(MAX_BULK_TASKS * 2),
  action: bulkActionSchema,
  dryRun: z.boolean().optional(),
});

export interface TaskBulkRouteDeps {
  service: TaskBulkService;
  guard: AuthGuard;
  /** Bulk changes one person may send a minute (each can touch 500 tasks). */
  perMinute?: number;
}

export const BULK_PER_MINUTE = 30;

/**
 * POST /tasks/bulk — one change to up to 500 tasks (or, with `dryRun`, what it would do); POST
 * /tasks/bulk/:bulkId/undo — put it back (the person who made it, within its window, once). Staff only
 * (a client account is refused by the guard's route table); each task is checked by the service.
 */
export async function registerTaskBulkRoutes(app: FastifyInstance, deps: TaskBulkRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const limit = { rateLimit: { max: deps.perMinute ?? BULK_PER_MINUTE, timeWindow: '1 minute' } };

  app.post('/tasks/bulk', { preHandler: guard.authenticate, config: limit }, async (req) => {
    const body = runSchema.parse(req.body);
    return { data: await service.run(actor(req), { taskIds: body.taskIds, action: body.action as BulkAction, dryRun: body.dryRun ?? false, ip: req.ip ?? null }) };
  });

  app.post('/tasks/bulk/:bulkId/undo', { preHandler: guard.authenticate, config: limit }, async (req) => {
    const { bulkId } = req.params as { bulkId: string };
    return { data: await service.undo(actor(req), idString.parse(bulkId), { ip: req.ip ?? null }) };
  });
}
