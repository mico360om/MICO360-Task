import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { createSchema } from './task-routes';
import { dateInput, idString } from './validation';
import type { TaskDuplicateService } from './task-duplicate';

/**
 * Duplicate Task: the review form's fields — the New task form's (task-routes' createSchema) with the
 * column left to the server when not chosen (the project's first To-do column), a start date that may be
 * "none" (null; left out, the original's), and the "Copy files" tick (default: copy them).
 */
export const duplicateSchema = createSchema.extend({
  columnId: idString.optional(),
  startDate: dateInput.nullable().optional(),
  copyFiles: z.boolean().optional(),
});

export interface TaskDuplicateRouteDeps {
  service: TaskDuplicateService;
  guard: AuthGuard;
}

/**
 * GET /tasks/:id/duplicate — the New task form's pre-fill for a copy (only what the person may see);
 * POST /tasks/:id/duplicate — the copy, made from the reviewed form exactly as a new task in the chosen
 * project, with `files: { total, copied, failed }`. Staff only (a client account is refused by the
 * guard's route table); an Idempotency-Key makes a double click one copy (lib/idempotency.ts).
 */
export async function registerTaskDuplicateRoutes(app: FastifyInstance, deps: TaskDuplicateRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  app.get('/tasks/:id/duplicate', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.prefill(actor(req), id) };
  });

  app.post('/tasks/:id/duplicate', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { copyFiles, ...body } = duplicateSchema.parse(req.body);
    const result = await service.duplicate(actor(req), id, { body, copyFiles: copyFiles ?? true });
    return reply.status(201).send({ data: result.task, files: result.files });
  });
}
