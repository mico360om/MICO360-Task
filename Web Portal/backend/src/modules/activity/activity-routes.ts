import type { FastifyInstance } from 'fastify';
import type { ActivityService } from './activity-service';
import type { AuthGuard } from '../auth/auth-guard';

export interface ActivityRouteDeps {
  activityService: ActivityService;
  guard: AuthGuard;
  /** Object-level view authorization: may this user see this task's activity? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Project ids a user may see (`null` = admin, unscoped) — scopes the global activity feed. */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
}

export async function registerActivityRoutes(app: FastifyInstance, deps: ActivityRouteDeps): Promise<void> {
  const { activityService, guard } = deps;
  app.get('/tasks/:id/activity', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (deps.canViewTask && !(await deps.canViewTask(req.user!.id, req.user!.roles ?? [], id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } });
    }
    return { data: await activityService.listForTask(id) };
  });

  app.get('/activity', { preHandler: guard.authenticate }, async (req) => {
    const rows = await activityService.listRecent(50);
    // Object-level scope: a non-admin only sees activity from projects they belong to.
    if (!deps.accessibleProjectIds) return { data: rows };
    const allowed = await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []);
    if (allowed === null) return { data: rows };
    const allowedSet = new Set(allowed);
    return { data: rows.filter((r) => allowedSet.has((r as { projectId?: string | null }).projectId ?? '')) };
  });
}
