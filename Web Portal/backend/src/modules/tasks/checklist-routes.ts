import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ChecklistService } from './checklist-service';
import type { AuthGuard } from '../auth/auth-guard';

const addSchema = z.object({ text: z.string().min(1) });
// A checklist item update can toggle completion, edit the text, or both.
const updateSchema = z.object({ done: z.boolean().optional(), text: z.string().min(1).optional() }).refine(
  (b) => b.done !== undefined || b.text !== undefined,
  { message: 'Provide "done" and/or "text".' },
);
const reorderSchema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) });

export interface ChecklistRouteDeps {
  checklistService: ChecklistService;
  guard: AuthGuard;
  /** Broadcast checklist changes so open task/board views update in real time. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Resolve a task's project so a broadcast can be scoped to its board. */
  projectIdOfTask?: (taskId: string) => Promise<string | null>;
  /** Object-level view authorization: may this user see/edit this task's checklist? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

export async function registerChecklistRoutes(app: FastifyInstance, deps: ChecklistRouteDeps): Promise<void> {
  const { checklistService, guard } = deps;

  async function announce(taskId: string): Promise<void> {
    if (!deps.broadcast || !deps.projectIdOfTask) return;
    const projectId = await deps.projectIdOfTask(taskId);
    if (projectId) deps.broadcast(projectId, 'checklist:changed', { taskId, summary: await checklistService.summary(taskId) });
  }
  const canView = (req: { user?: { id: string; roles?: string[] } }, taskId: string) =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };

  app.get('/tasks/:id/checklist', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const items = await checklistService.listItems(id);
    const summary = await checklistService.summary(id);
    // `progress` kept for backward compatibility; `done`/`total` give X-of-Y tracking.
    return { data: { items, progress: summary.percent, done: summary.done, total: summary.total } };
  });

  app.post('/tasks/:id/checklist', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { text } = addSchema.parse(req.body);
    const item = await checklistService.addItem(id, text);
    await announce(id);
    return reply.status(201).send({ data: item });
  });

  app.put('/checklist/:itemId', { preHandler: guard.authenticate }, async (req) => {
    const { itemId } = req.params as { itemId: string };
    const body = updateSchema.parse(req.body);
    let item = undefined;
    if (body.text !== undefined) item = await checklistService.editItem(itemId, body.text);
    if (body.done !== undefined) item = await checklistService.toggleItem(itemId, body.done);
    if (item) await announce(item.taskId);
    return { data: item };
  });

  // Reorder a task's checklist items (drag-and-drop ordering).
  app.put('/tasks/:id/checklist/reorder', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { orderedIds } = reorderSchema.parse(req.body);
    const items = await checklistService.reorderItems(id, orderedIds);
    await announce(id);
    return { data: items };
  });

  app.delete('/checklist/:itemId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const removed = await checklistService.removeItem(itemId);
    if (removed) await announce(removed.taskId);
    return reply.status(204).send();
  });
}
