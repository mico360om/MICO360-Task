import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { Logger } from '../../lib/logger';
import type { BulkMoveItem, MoveResult, TaskMovePreview, TaskMoveService } from './task-move-service';
import { idString } from './validation';

/** At most this many tasks are moved (or previewed) in one request. */
export const MAX_MOVE_TASKS = 500;

const choice = z.enum(['ADD_TO_TEAM', 'UNASSIGN']);
const moveSchema = z.object({ projectId: idString, columnId: idString.optional(), assignees: choice.optional() });
const taskIds = z.array(idString).min(1).max(MAX_MOVE_TASKS);
const bulkSchema = moveSchema.extend({ taskIds });
const previewSchema = z.object({ taskIds, projectId: idString });

export interface TaskMoveRouteDeps {
  service: TaskMoveService;
  guard: AuthGuard;
  /** Live boards: the old project's room hears the task change (it left), the new one's hears it arrive. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** May this user see this task? One they can't is "not found" (its existence isn't revealed). */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** People added to a project's team by a move are recorded like any other team change. */
  audit?: AuditService;
  /** Where a failure after a saved move is reported (the move itself stands). */
  logger?: Pick<Logger, 'error'>;
}

const notFound = { error: { code: 'NOT_FOUND', message: 'Task not found.' } };
const hiddenPreview = (id: string): TaskMovePreview => ({
  id, key: '', title: '', from: null, canMove: false, reason: 'Task not found.', newKey: null, currentCategory: null, completed: false, columnId: null, milestoneCleared: false, dueDate: null, repeat: null, outsiders: [],
});

/**
 * Moving tasks to another project: where they may go (`move-targets`), what a move would change
 * (`move-preview`, for the dialog), and the move itself — one task, or many with a result for each.
 */
export async function registerTaskMoveRoutes(app: FastifyInstance, deps: TaskMoveRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  /** Which of these tasks the caller may see. */
  async function visible(req: FastifyRequest, ids: string[]): Promise<Set<string>> {
    if (!deps.canViewTask) return new Set(ids);
    const seen = await Promise.all(ids.map((id) => deps.canViewTask!(req.user!.id, req.user!.roles ?? [], id)));
    return new Set(ids.filter((_, i) => seen[i]));
  }

  /**
   * Tell both boards, and record people the move put on a team. The move is saved by now: a failure
   * here is logged, never turned into an error (and never stops the next task's announcement).
   */
  async function announce(req: FastifyRequest, move: MoveResult): Promise<void> {
    deps.broadcast?.(move.from.projectId, 'task:updated', move.task);
    deps.broadcast?.(move.to.projectId, 'task:created', move.task);
    if (move.clientHidden) {
      // It was shown on the old project's client page: it no longer is (the history says so too).
      await deps.audit
        ?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'client-view', action: 'client-view.task.hidden', entityId: move.task.id, newValue: { projectId: move.from.projectId, reason: 'moved', toProjectId: move.to.projectId } })
        .catch((err) => deps.logger?.error('moving a task: the audit log line for its client page failed', { err, taskId: move.task.id }));
    }
    if (move.addedToTeam.length === 0) return;
    try {
      await deps.audit?.record({
        userId: req.user!.id,
        ip: req.ip ?? null,
        module: 'members',
        action: 'member.add',
        entityId: move.to.projectId,
        newValue: { userIds: move.addedToTeam.map((p) => p.id), taskId: move.task.id, reason: `task moved from ${move.from.name}` },
      });
    } catch (err) {
      deps.logger?.error('moving a task: the audit log line for people added to the team failed', { err, taskId: move.task.id, projectId: move.to.projectId });
    }
  }

  app.get('/tasks/move-targets', { preHandler: guard.authenticate }, async (req) => {
    return { data: await service.targets(actor(req)) };
  });

  app.post('/tasks/move-preview', { preHandler: guard.authenticate }, async (req) => {
    const body = previewSchema.parse(req.body);
    const shown = await visible(req, body.taskIds);
    const preview = await service.preview(actor(req), body.taskIds.filter((id) => shown.has(id)), body.projectId);
    const byId = new Map(preview.tasks.map((t) => [t.id, t]));
    // In the order asked; a task the caller can't see looks exactly like one that doesn't exist.
    const tasks = [...new Set(body.taskIds)].map((id) => byId.get(id) ?? hiddenPreview(id));
    return { data: { ...preview, tasks } };
  });

  app.post('/tasks/:id/move-to-project', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = moveSchema.parse(req.body);
    if (!(await visible(req, [id])).has(id)) return reply.status(404).send(notFound);
    const move = await service.moveTask(actor(req), id, body);
    await announce(req, move);
    return { data: move };
  });

  app.post('/tasks/move-to-project', { preHandler: guard.authenticate }, async (req) => {
    const { taskIds: ids, ...input } = bulkSchema.parse(req.body);
    const shown = await visible(req, ids);
    const result = await service.moveTasks(actor(req), ids.filter((id) => shown.has(id)), input);
    for (const r of result.results) if (r.ok) await announce(req, r);
    const byId = new Map(result.results.map((r) => [r.taskId, r]));
    const results: BulkMoveItem[] = [...new Set(ids)].map((taskId) => byId.get(taskId) ?? { taskId, ok: false, error: notFound.error });
    const moved = results.filter((r) => r.ok).length;
    return { data: { results, moved, failed: results.length - moved } };
  });
}
