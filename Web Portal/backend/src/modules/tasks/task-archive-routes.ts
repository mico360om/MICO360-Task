import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { HttpError } from '../../lib/http-errors';
import type { TaskRecord } from './task-repository';
import type { ArchiveRefusal, TaskArchiveService } from './task-archive';

export interface TaskArchiveRouteDeps {
  service: TaskArchiveService;
  guard: AuthGuard;
  /** The task as it is now (answered after a change). */
  getTask: (id: string) => Promise<TaskRecord>;
}

const STATUS: Record<string, number> = { NOT_FOUND: 404, FORBIDDEN: 403 };

/** A refusal as the error the website and apps read (409 for the "it's not in that state" ones). */
function refusalError(r: ArchiveRefusal): HttpError {
  return new HttpError(r.message, r.code, STATUS[r.code] ?? 409);
}

/**
 * Task archive, one task at a time (the task panel's Archive / Unarchive): administrators and the
 * people who run its project (task-archive.ts). Many at once go through POST /tasks/bulk. Staff only (a
 * client account is refused by the guard's route table).
 */
export async function registerTaskArchiveRoutes(app: FastifyInstance, deps: TaskArchiveRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  async function change(req: FastifyRequest, archiving: boolean) {
    const { id } = req.params as { id: string };
    const result = archiving ? await service.archive(actor(req), [id], { ip: req.ip ?? null }) : await service.unarchive(actor(req), [id], { ip: req.ip ?? null });
    const refusal = result.refused[0];
    if (refusal || result.done.length === 0) throw refusalError(refusal ?? { id, code: 'NOT_FOUND', message: 'Task not found.' });
    return { data: await deps.getTask(id) };
  }

  app.post('/tasks/:id/archive', { preHandler: guard.authenticate }, async (req) => change(req, true));
  app.post('/tasks/:id/unarchive', { preHandler: guard.authenticate }, async (req) => change(req, false));
}
