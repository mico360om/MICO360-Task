import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ColumnService } from './column-service';
import type { ProjectAuthz } from './project-authz';
import type { AuthGuard } from '../auth/auth-guard';
import { ForbiddenError } from '../../lib/http-errors';

const categoryEnum = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
const addSchema = z.object({ name: z.string().min(1), category: categoryEnum.optional(), color: z.string().optional() });
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category: categoryEnum.optional(),
  color: z.string().optional(),
  enabled: z.boolean().optional(),
  position: z.number().optional(),
});

export interface ColumnRouteDeps {
  columnService: ColumnService;
  authz: ProjectAuthz;
  guard: AuthGuard;
  /** Broadcast stage (column) changes so open boards refresh their columns in real time. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Object-level view authorization: may this user see this project's columns? */
  canViewProject?: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
}

export async function registerColumnRoutes(app: FastifyInstance, deps: ColumnRouteDeps): Promise<void> {
  const { columnService, authz, guard } = deps;
  const announce = (projectId: string, action: string, payload: Record<string, unknown>) =>
    deps.broadcast?.(projectId, 'column:changed', { projectId, action, ...payload });

  app.get('/projects/:id/columns', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (deps.canViewProject && !(await deps.canViewProject(req.user!.id, req.user!.roles ?? [], id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } });
    }
    return { data: await columnService.listColumns(id) };
  });

  app.post('/projects/:id/columns', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await authz.canManageProject(req.user!.id, req.user!.roles ?? [], id))) throw new ForbiddenError();
    const body = addSchema.parse(req.body);
    const column = await columnService.addColumn(id, body);
    announce(id, 'created', { column });
    return reply.status(201).send({ data: column });
  });

  app.put('/columns/:columnId', { preHandler: guard.authenticate }, async (req) => {
    const { columnId } = req.params as { columnId: string };
    if (!(await authz.canManageColumn(req.user!.id, req.user!.roles ?? [], columnId))) throw new ForbiddenError();
    const body = updateSchema.parse(req.body);
    const column = await columnService.updateColumn(columnId, body);
    announce(column.projectId, 'updated', { column });
    return { data: column };
  });

  app.delete('/columns/:columnId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { columnId } = req.params as { columnId: string };
    if (!(await authz.canManageColumn(req.user!.id, req.user!.roles ?? [], columnId))) throw new ForbiddenError();
    const removed = await columnService.removeColumn(columnId);
    if (removed) announce(removed.projectId, 'deleted', { columnId });
    return reply.status(204).send();
  });
}
