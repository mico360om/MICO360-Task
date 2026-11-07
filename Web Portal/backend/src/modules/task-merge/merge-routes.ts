import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler, preSerializationAsyncHookHandler, RouteOptions } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { Logger } from '../../lib/logger';
import { idString } from '../tasks/validation';
import { MAX_MERGE_TASKS, MERGE_FIELDS } from './merge-rules';
import type { MergePreviewTask, MergeResult, TaskMergeService, UndoResult } from './merge-service';

const taskIds = z.array(idString).min(1).max(MAX_MERGE_TASKS);
const choices = z.object(Object.fromEntries(MERGE_FIELDS.map((f) => [f, idString.optional()])) as Record<(typeof MERGE_FIELDS)[number], z.ZodOptional<typeof idString>>).strict();
const people = z.record(idString, z.enum(['ADD_TO_TEAM', 'LEAVE_OFF']));
const previewSchema = z.object({ taskIds, mainTaskId: idString.optional(), choices: choices.optional(), people: people.optional() });
const mergeSchema = z.object({
  taskIds: z.array(idString).min(2).max(MAX_MERGE_TASKS),
  mainTaskId: idString,
  choices: choices.optional(),
  people: people.optional(),
  versions: z.record(idString, z.number().int()).optional(),
});

export interface MergeRouteDeps {
  service: TaskMergeService;
  guard: AuthGuard;
  /** May this user see this task? One they can't is "not found" (its existence isn't revealed). */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Live boards and lists: each project involved hears what changed. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  audit?: AuditService;
  logger?: Pick<Logger, 'error'>;
}

const notFound = { error: { code: 'NOT_FOUND', message: 'Task not found.' } };
const hidden = (id: string): MergePreviewTask => ({
  id, key: '', title: '', projectId: '', projectName: '', status: { name: '', category: '' }, createdAt: new Date(0), createdByName: '', version: 0, canMerge: false, reason: 'Task not found.',
  counts: { comments: 0, checklist: 0, files: 0, assignees: 0, watchers: 0, contacts: 0, tags: 0, blockers: 0, actionItems: 0, inspections: 0, activity: 0 },
});

/**
 * Merge tasks (1.23.1): what a merge would do (merge-preview, for the dialog), the merge, a main task's
 * "Merged from" panel, a merged task's own record, and Undo (what it would give back, then the undo).
 */
export async function registerTaskMergeRoutes(app: FastifyInstance, deps: MergeRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const canSee = async (req: FastifyRequest, id: string) => (deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], id) : true);
  async function visible(req: FastifyRequest, ids: string[]): Promise<Set<string>> {
    const seen = await Promise.all(ids.map((id) => canSee(req, id)));
    return new Set(ids.filter((_, i) => seen[i]));
  }
  async function record(req: FastifyRequest, action: string, entityId: string, newValue: unknown, module = 'tasks'): Promise<void> {
    await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module, action, entityId, newValue }).catch((err) => deps.logger?.error('merging tasks: the audit log line failed', { err, entityId }));
  }
  /** The merge or undo is saved: tell every board involved. A failure here is logged, never an error. */
  function announce(main: { id: string; projectId: string; before?: string }, gone: { id: string; projectId: string }[], back: { id: string; projectId: string }[]) {
    try {
      deps.broadcast?.(main.projectId, 'task:updated', { id: main.id, projectId: main.projectId });
      if (main.before && main.before !== main.projectId) deps.broadcast?.(main.before, 'task:updated', { id: main.id, projectId: main.projectId });
      for (const t of gone) deps.broadcast?.(t.projectId, 'task:deleted', { id: t.id, mergedIntoId: main.id });
      for (const t of back) deps.broadcast?.(t.projectId, 'task:created', { id: t.id, projectId: t.projectId });
    } catch (err) {
      deps.logger?.error('merging tasks: telling the boards failed', { err, taskId: main.id });
    }
  }

  app.post('/tasks/merge-preview', { preHandler: guard.authenticate }, async (req) => {
    const body = previewSchema.parse(req.body);
    const shown = await visible(req, body.taskIds);
    const preview = await service.preview(actor(req), { ...body, taskIds: body.taskIds.filter((id) => shown.has(id)), mainTaskId: body.mainTaskId && shown.has(body.mainTaskId) ? body.mainTaskId : undefined });
    const byId = new Map(preview.tasks.map((t) => [t.id, t]));
    // In the order asked; a task the caller can't see looks exactly like one that doesn't exist.
    return { data: { ...preview, tasks: [...new Set(body.taskIds)].map((id) => byId.get(id) ?? hidden(id)) } };
  });

  app.post('/tasks/merge', { preHandler: guard.authenticate }, async (req, reply) => {
    const body = mergeSchema.parse(req.body);
    const shown = await visible(req, body.taskIds);
    if (body.taskIds.some((id) => !shown.has(id))) return reply.status(404).send(notFound);
    const result: MergeResult = await service.merge(actor(req), body);
    announce({ id: result.mainTaskId, projectId: result.mainProjectId, before: result.mainProjectBefore }, result.merged, []);
    await record(req, 'task.merged', result.mainTaskId, { mainKey: result.mainKey, merged: result.merged.map((t) => t.key), mergeId: result.mergeId, choices: body.choices ?? {}, addedToTeam: result.addedToTeam.map((p) => p.name), leftOff: result.leftOff.map((p) => p.name) });
    if (result.addedToTeam.length) await record(req, 'member.add', result.mainProjectId, { userIds: result.addedToTeam.map((p) => p.id), taskId: result.mainTaskId, reason: 'tasks merged' }, 'members');
    return { data: result };
  });

  // The main task's "Merged from" panel (and which task each moved comment, checklist item, history line and file came from).
  app.get('/tasks/:id/merges', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canSee(req, id))) return reply.status(404).send(notFound);
    return { data: await service.mergedFrom(actor(req), id) };
  });

  /** The merge's main task, when the caller may open it. */
  async function mergeFor(req: FastifyRequest, reply: FastifyReply, mergeId: string): Promise<{ mainTaskId: string } | null> {
    const panel = await service.mergeMain(mergeId);
    if (!panel || !(await canSee(req, panel.mainTaskId))) {
      void reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Merge not found.' } });
      return null;
    }
    return { mainTaskId: panel.mainTaskId };
  }

  app.get('/task-merges/:mergeId/tasks/:taskId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { mergeId, taskId } = req.params as { mergeId: string; taskId: string };
    if (!(await mergeFor(req, reply, mergeId))) return reply;
    return { data: await service.mergedRecord(mergeId, taskId) };
  });

  app.get('/task-merges/:mergeId/undo-preview', { preHandler: guard.authenticate }, async (req, reply) => {
    const { mergeId } = req.params as { mergeId: string };
    if (!(await mergeFor(req, reply, mergeId))) return reply;
    return { data: await service.undoPreview(actor(req), mergeId) };
  });

  app.post('/task-merges/:mergeId/undo', { preHandler: guard.authenticate }, async (req, reply) => {
    const { mergeId } = req.params as { mergeId: string };
    if (!(await mergeFor(req, reply, mergeId))) return reply;
    const result: UndoResult = await service.undo(actor(req), mergeId);
    announce({ id: result.mainTaskId, projectId: result.mainProjectId }, [], result.restored);
    await record(req, 'task.merge-undone', result.mainTaskId, { mainKey: result.mainKey, restored: result.restored.map((t) => t.key), mergeId });
    return { data: result };
  });
}

/** What the server says when a merged task's id is used to change it. */
export const TASK_MERGED_CODE = 'TASK_MERGED';

/**
 * Writes that ADD something to a task: sent to a merged task's id (a stale screen, an old link, the phone
 * app's offline queue — the app isn't updated), they land on the main task and the answer names it
 * (`mergedInto`) — "without losing any information". Any other write (a change to its own fields, deleting
 * it, unfollowing, taking something off) is refused: 409 TASK_MERGED, naming the main task.
 */
export const ADDS_TO_TASK: ReadonlySet<string> = new Set([
  'POST /tasks/:id/comments',
  'POST /tasks/:id/attachments',
  'POST /tasks/:id/checklist',
  // 1.23.3: several items at once, and a new checklist.
  'POST /tasks/:id/checklist/batch',
  'POST /tasks/:id/checklists',
  'POST /tasks/:id/watch',
  'POST /tasks/:id/external-contacts',
]);

declare module 'fastify' {
  interface FastifyRequest {
    /** 1.23.1: this request named a merged task; it is answered for the main task. */
    mergedFrom?: { taskId: string; key: string; mergedAt: Date | null; mergedByName: string | null; mainKey?: string | null };
  }
}

/**
 * 1.23.1: a merged task's id keeps working — an old link, an email, a notice, the phone app (which reads
 * a task's comments, files and checklist by the id it opened). Every `/tasks/:id…` read of a merged task
 * is answered for the main task (`req.params.id` becomes its id; `req.mergedFrom` says which task was
 * asked for). A change sent to a merged task's id is refused (409 TASK_MERGED, naming the main task to
 * someone who may open it): a stale list row can never change or delete the main task. Installed before
 * the routes (onRoute), after each route's own sign-in.
 */
export function installMergedTaskRedirect(
  app: FastifyInstance,
  deps: { resolve: TaskMergeService['resolveMerged']; canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>; keyOf?: (taskId: string) => Promise<string | null> },
  prefix = '',
): void {
  app.addHook('onRoute', (route: RouteOptions) => {
    const path = route.url.startsWith(prefix) ? route.url.slice(prefix.length) || '/' : route.url;
    if (!/^\/tasks\/:id(\/|\.|$)/.test(path)) return;
    const methods = (Array.isArray(route.method) ? route.method : [route.method]).map((m) => String(m).toUpperCase());
    const adds = methods.some((m) => ADDS_TO_TASK.has(`${m} ${path}`));
    const own = route.preHandler ? (Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler]) : [];
    const redirect: preHandlerAsyncHookHandler = async (req, reply) => {
      const params = req.params as { id?: string };
      if (!params?.id || !req.user) return;
      const merged = await deps.resolve(params.id);
      if (!merged) return;
      if (req.method === 'GET' || req.method === 'HEAD' || adds) {
        // A read, or something added: answered for the main task (by its own checks: the route asks
        // whether this person may see — and change — the main task, as for any task).
        req.mergedFrom = { taskId: params.id, key: merged.key, mergedAt: merged.mergedAt, mergedByName: merged.mergedByName };
        if (adds && deps.keyOf) req.mergedFrom.mainKey = await deps.keyOf(merged.mainTaskId);
        params.id = merged.mainTaskId;
        return;
      }
      const mayOpen = deps.canViewTask ? await deps.canViewTask(req.user.id, req.user.roles ?? [], merged.mainTaskId) : true;
      if (!mayOpen) return reply.status(404).send(notFound);
      const mainKey = deps.keyOf ? await deps.keyOf(merged.mainTaskId) : null;
      return reply.status(409).send({
        error: {
          code: TASK_MERGED_CODE,
          message: `${merged.key} was merged into ${mainKey ?? 'another task'}. Open ${mainKey ?? 'that task'} to change it.`,
          details: { mainTaskId: merged.mainTaskId, mainKey },
        },
      });
    };
    // After the route's own sign-in, before anything else it does (the archive guard included).
    route.preHandler = [...own.slice(0, 1), redirect, ...own.slice(1)];
    if (!adds) return;
    // What was added names the task it went to: { data, mergedInto: { taskId, key, fromKey } } (additive).
    // Before serialisation, so a repeated request (Idempotency-Key, the app's queue) gets the same answer.
    const name: preSerializationAsyncHookHandler = async (req, reply, payload) => {
      const from = req.mergedFrom;
      if (!from || reply.statusCode >= 300 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
      return { ...(payload as Record<string, unknown>), mergedInto: { taskId: (req.params as { id: string }).id, key: from.mainKey ?? null, fromKey: from.key } };
    };
    const serial = route.preSerialization ? (Array.isArray(route.preSerialization) ? route.preSerialization : [route.preSerialization]) : [];
    route.preSerialization = [...serial, name] as RouteOptions['preSerialization'];
  });
}
