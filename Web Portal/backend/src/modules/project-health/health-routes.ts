import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { ActivityRecord } from '../activity/activity-repository';
import { withoutHiddenBlockers } from '../activity/hidden-blockers';
import { NotFoundError } from '../../lib/http-errors';
import type { ProjectHealthService } from './health-service';

/** The project page's Recent activity: its latest entries. */
export const RECENT_ACTIVITY = 10;

export interface HealthRouteDeps {
  guard: AuthGuard;
  health: Pick<ProjectHealthService, 'detail' | 'nextActions'>;
  /** May this person see this project (its owner, named manager, team, or an administrator)? */
  canViewProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** The project's latest activity entries (Recent activity). */
  recentActivity?: (projectId: string, limit: number) => Promise<ActivityRecord[]>;
  /** A blocker named in an activity line only for a reader who may open it. */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

/**
 * 1.23.5 Project overview & health — the project page's Overview tab: its health with every reason,
 * completion both ways, the automatic risks and accountable owners; its Next actions (the 1.23.4 rows and
 * quick actions); and its Recent activity. Staff only (a client account is refused by the guard's route
 * table); a project the person can't see is a 404, never data.
 */
export async function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): Promise<void> {
  const { guard } = deps;
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  async function visibleProject(req: FastifyRequest): Promise<string> {
    const { id } = req.params as { id: string };
    const v = viewer(req);
    if (typeof id !== 'string' || !id || !(await deps.canViewProject(v.id, v.roles, id))) throw new NotFoundError('Project not found.');
    return id;
  }

  app.get('/projects/:id/health', { preHandler: guard.authenticate }, async (req) => {
    const id = await visibleProject(req);
    const detail = await deps.health.detail(id);
    if (!detail) throw new NotFoundError('Project not found.');
    return { data: detail };
  });

  app.get('/projects/:id/next-actions', { preHandler: guard.authenticate }, async (req) => {
    const id = await visibleProject(req);
    const fresh = (req.query as Record<string, unknown> | undefined)?.fresh === '1';
    // 1.23.3: the person's own checklist items of the project join its Next actions.
    const answer = await deps.health.nextActions(id, { fresh, viewer: viewer(req) });
    if (!answer) throw new NotFoundError('Project not found.');
    return { data: answer };
  });

  if (deps.recentActivity) {
    app.get('/projects/:id/activity', { preHandler: guard.authenticate }, async (req) => {
      const id = await visibleProject(req);
      const rows = await deps.recentActivity!(id, RECENT_ACTIVITY);
      const v = viewer(req);
      return { data: deps.canViewTask ? await withoutHiddenBlockers(rows, (taskId) => deps.canViewTask!(v.id, v.roles, taskId)) : rows };
    });
  }
}
