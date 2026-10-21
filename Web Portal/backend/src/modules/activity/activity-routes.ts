import type { FastifyInstance } from 'fastify';
import type { ActivityService } from './activity-service';
import type { ActivityRecord } from './activity-repository';
import { withoutHiddenBlockers } from './hidden-blockers';
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
  /** A blocker's name only for a reader who can open that task (see hidden-blockers.ts). */
  const asSeenBy = <T extends ActivityRecord>(rows: T[], user: { id: string; roles?: string[] }) =>
    deps.canViewTask ? withoutHiddenBlockers(rows, (taskId) => deps.canViewTask!(user.id, user.roles ?? [], taskId)) : rows;

  app.get('/tasks/:id/activity', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (deps.canViewTask && !(await deps.canViewTask(req.user!.id, req.user!.roles ?? [], id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } });
    }
    return { data: await asSeenBy(await activityService.listForTask(id), req.user!) };
  });

  app.get('/activity', { preHandler: guard.authenticate }, async (req) => {
    // Object-level scope: a non-admin only sees activity from projects they belong to. The scope
    // goes into the query, so the 50 rows are the newest *they* may see.
    const allowed = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
    if (allowed !== null && allowed.length === 0) return { data: [] };
    const rows = await activityService.listRecent(50, allowed);
    if (allowed === null) return { data: await asSeenBy(rows, req.user!) };
    const allowedSet = new Set(allowed);
    return { data: await asSeenBy(rows.filter((r) => allowedSet.has(r.projectId ?? '')), req.user!) };
  });
}
