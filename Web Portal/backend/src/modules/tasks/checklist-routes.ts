import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChecklistItemView, ChecklistService } from './checklist-service';
import type { AuthGuard } from '../auth/auth-guard';
import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import { calendarDay, idString, requiredText } from './validation';
import type { PickOf } from '../companies/company-pick';
import { NO_PICK } from '../companies/company-pick';

/** A day sent as 'YYYY-MM-DD' → UTC midnight (like a task's due date); null clears it. */
const dueDay = calendarDay.transform((d) => new Date(`${d}T00:00:00.000Z`));
const place = {
  listId: idString.optional(),
  parentId: idString.nullable().optional(),
  afterId: idString.nullable().optional(),
};
const addSchema = z.object({ text: requiredText, ...place, assigneeId: idString.nullable().optional(), dueDate: dueDay.nullable().optional() });
const batchSchema = z.object({ texts: z.array(requiredText).min(1).max(100), ...place });
// An update can tick, reword, give to someone and set a due day — any of them, at least one.
const updateSchema = z
  .object({ done: z.boolean().optional(), text: requiredText.optional(), assigneeId: idString.nullable().optional(), dueDate: dueDay.nullable().optional() })
  .refine((b) => b.done !== undefined || b.text !== undefined || b.assigneeId !== undefined || b.dueDate !== undefined, {
    message: 'Provide "done", "text", "assigneeId" and/or "dueDate".',
  });
const reorderSchema = z.object({ orderedIds: z.array(idString).min(1).max(1000) });
const moveSchema = z.union([
  z.object({ action: z.enum(['indent', 'outdent', 'up', 'down']) }),
  z.object({ listId: idString.optional(), parentId: idString.nullable(), afterId: idString.nullable() }),
]);
const listSchema = z.object({ title: requiredText, afterId: idString.nullable().optional() });
const renameListSchema = z.object({ title: requiredText });
const restoreSchema = z.object({ batchId: idString });

/** An open checklist item assigned to someone (My Tasks → "Checklist items for me"). */
export interface MyChecklistItem {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  isParent: boolean;
  openSubItems: number;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
  listId: string;
  listTitle: string;
}

export interface ChecklistRouteDeps {
  checklistService: ChecklistService;
  guard: AuthGuard;
  /** Broadcast checklist changes so open task/board views update in real time. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Resolve a task's project so a broadcast can be scoped to its board. */
  projectIdOfTask?: (taskId: string) => Promise<string | null>;
  /** Object-level view authorization: may this user see/edit this task's checklist? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Write a line to the task's activity timeline (who did what). */
  recordActivity?: RecordTaskActivity;
  /** 1.23.3: tell someone they were given a checklist item (bell, and email/push by their settings). */
  onItemAssigned?: (n: { taskId: string; itemId: string; text: string; assigneeId: string; actorId: string }) => Promise<void>;
  /** 1.23.3: people's names (who deleted something; who an item was taken from). */
  namesOf?: (userIds: string[]) => Promise<Map<string, string>>;
  /** 1.23.3 My Tasks: the open items given to this person, in these projects (null = any they may see). */
  myItems?: (userId: string, projectIds: string[] | null) => Promise<MyChecklistItem[]>;
  /** The projects of the caller's own work in the picked company (as My Tasks; null = unscoped). */
  ownProjectIds?: (userId: string, roles: string[], pick: string | null) => Promise<string[] | null>;
  pickOf?: PickOf;
}

export async function registerChecklistRoutes(app: FastifyInstance, deps: ChecklistRouteDeps): Promise<void> {
  const { checklistService: service, guard } = deps;

  async function announce(taskId: string): Promise<void> {
    if (!deps.broadcast || !deps.projectIdOfTask) return;
    const projectId = await deps.projectIdOfTask(taskId);
    if (projectId) deps.broadcast(projectId, 'checklist:changed', { taskId, summary: await service.summary(taskId) });
  }
  const canView = (req: FastifyRequest, taskId: string) =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };
  const actor = (req: FastifyRequest) => req.user!.id;
  const note = (req: FastifyRequest, taskId: string, action: string, meta: Record<string, unknown>) =>
    noteActivity(deps.recordActivity, { taskId, userId: actor(req), action, meta });
  const nameOf = async (id: string | null): Promise<string | null> => (id && deps.namesOf ? ((await deps.namesOf([id])).get(id) ?? null) : null);
  /** The item's task, when the caller may see it; else the answer is sent (403) and null returned. */
  async function itemTask(req: FastifyRequest, reply: FastifyReply, itemId: string): Promise<string | null> {
    const taskId = await service.taskOfItem(itemId);
    if (!(await canView(req, taskId))) {
      void reply.status(403).send(denied);
      return null;
    }
    return taskId;
  }
  async function listTask(req: FastifyRequest, reply: FastifyReply, listId: string): Promise<string | null> {
    const taskId = await service.taskOfList(listId);
    if (!(await canView(req, taskId))) {
      void reply.status(403).send(denied);
      return null;
    }
    return taskId;
  }
  /** Someone newly given an item hears about it (not when they gave it to themselves). */
  async function told(req: FastifyRequest, item: ChecklistItemView): Promise<void> {
    if (!item.assigneeId || item.assigneeId === actor(req) || !deps.onItemAssigned) return;
    try {
      await deps.onItemAssigned({ taskId: item.taskId, itemId: item.id, text: item.text, assigneeId: item.assigneeId, actorId: actor(req) });
    } catch {
      /* the item was given; a notice that couldn't go doesn't undo it */
    }
  }

  // ---- reading -----------------------------------------------------------------------------------

  app.get('/tasks/:id/checklist', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const v = await service.view(id);
    // `progress` kept for older apps; `done`/`total` give X-of-Y (leaves only); `lists` the checklists.
    return { data: { items: v.items, progress: v.percent, done: v.done, total: v.total, lists: v.lists } };
  });

  app.get('/tasks/:id/checklist/deleted', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const batches = await service.deletedBatches(id);
    const ids = [...new Set(batches.map((b) => b.deletedById).filter((x): x is string => !!x))];
    const names = ids.length && deps.namesOf ? await deps.namesOf(ids) : new Map<string, string>();
    return {
      data: batches.map((b) => ({
        batchId: b.batchId,
        kind: b.kind,
        title: b.title,
        count: b.count,
        deletedAt: b.deletedAt.toISOString(),
        deletedBy: b.deletedById ? { id: b.deletedById, name: names.get(b.deletedById) ?? 'Someone' } : null,
        until: b.until.toISOString(),
      })),
    };
  });

  // My Tasks → "Checklist items for me": open items given to me, in tasks I can still see.
  app.get('/me/checklist-items', { preHandler: guard.authenticate }, async (req) => {
    if (!deps.myItems) return { data: [] };
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    const projectIds = deps.ownProjectIds ? await deps.ownProjectIds(req.user!.id, req.user!.roles ?? [], pick) : null;
    return { data: await deps.myItems(req.user!.id, projectIds) };
  });

  // ---- items -------------------------------------------------------------------------------------

  app.post('/tasks/:id/checklist', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const body = addSchema.parse(req.body);
    const res = await service.addItems(id, actor(req), {
      texts: [body.text],
      listId: body.listId,
      parentId: body.parentId,
      afterId: body.afterId,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate,
    });
    const item = res.items[0]!;
    await announce(id);
    await note(req, id, 'CHECKLIST_ADDED', { itemId: item.id, text: item.text, listTitle: res.listTitle, ...(res.parentText ? { parentText: res.parentText } : {}) });
    if (item.assigneeId) {
      await note(req, id, 'CHECKLIST_ASSIGNED', { itemId: item.id, text: item.text, assigneeId: item.assigneeId, assignee: item.assignee?.name ?? null });
      await told(req, item);
    }
    return reply.status(201).send({ data: item });
  });

  // Several items at once (pasted lines, AI steps): one "added N items" line in the history.
  app.post('/tasks/:id/checklist/batch', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const body = batchSchema.parse(req.body);
    const res = await service.addItems(id, actor(req), { texts: body.texts, listId: body.listId, parentId: body.parentId, afterId: body.afterId });
    await announce(id);
    if (res.items.length === 1) {
      await note(req, id, 'CHECKLIST_ADDED', { itemId: res.items[0]!.id, text: res.items[0]!.text, listTitle: res.listTitle, ...(res.parentText ? { parentText: res.parentText } : {}) });
    } else {
      await note(req, id, 'CHECKLIST_ADDED', { count: res.items.length, texts: res.items.slice(0, 5).map((i) => i.text), listTitle: res.listTitle, ...(res.parentText ? { parentText: res.parentText } : {}) });
    }
    return reply.status(201).send({ data: { items: res.items } });
  });

  // Item-level routes resolve the item's task first (404 if unknown) and gate on access to it.
  app.put('/checklist/:itemId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const body = updateSchema.parse(req.body);
    const taskId = await itemTask(req, reply, itemId);
    if (!taskId) return reply;
    const { before, item } = await service.updateItem(itemId, actor(req), body);
    await announce(taskId);
    if (item.text !== before.text) await note(req, taskId, 'CHECKLIST_RENAMED', { itemId, from: before.text, to: item.text });
    if (item.done !== before.done) await note(req, taskId, item.done ? 'CHECKLIST_DONE' : 'CHECKLIST_REOPENED', { itemId, text: item.text });
    if (item.assigneeId !== before.assigneeId) {
      if (item.assigneeId) {
        await note(req, taskId, 'CHECKLIST_ASSIGNED', { itemId, text: item.text, assigneeId: item.assigneeId, assignee: item.assignee?.name ?? null });
        await told(req, item);
      } else {
        await note(req, taskId, 'CHECKLIST_UNASSIGNED', { itemId, text: item.text, assigneeId: before.assigneeId, assignee: before.assignee?.name ?? (await nameOf(before.assigneeId)) });
      }
    }
    if (item.dueDate !== before.dueDate) await note(req, taskId, 'CHECKLIST_DUE', { itemId, text: item.text, from: before.dueDate, to: item.dueDate });
    return { data: item };
  });

  // Indent, outdent, up, down — or to a place. Never under itself or one of its sub-items.
  app.post('/checklist/:itemId/move', { preHandler: guard.authenticate }, async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const body = moveSchema.parse(req.body);
    const taskId = await itemTask(req, reply, itemId);
    if (!taskId) return reply;
    const res = await service.moveItem(itemId, actor(req), body);
    await announce(taskId);
    await note(req, taskId, 'CHECKLIST_MOVED', { itemId, text: res.text, how: res.how });
    return { data: res.item };
  });

  app.post('/checklist/:itemId/duplicate', { preHandler: guard.authenticate }, async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const taskId = await itemTask(req, reply, itemId);
    if (!taskId) return reply;
    const res = await service.duplicateItem(itemId, actor(req));
    await announce(taskId);
    await note(req, taskId, 'CHECKLIST_DUPLICATED', { itemId: res.item.id, text: res.text, count: res.count });
    return reply.status(201).send({ data: { item: res.item, count: res.count } });
  });

  // Reorder (older apps: every item id) — within each level; the tree never changes from it.
  app.put('/tasks/:id/checklist/reorder', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { orderedIds } = reorderSchema.parse(req.body);
    const items = await service.reorderItems(id, orderedIds, actor(req));
    await announce(id);
    await note(req, id, 'CHECKLIST_REORDERED', { count: orderedIds.length });
    return { data: items };
  });

  // Deleting keeps it 30 days: the answer names the batch Undo (and the history's Restore) bring back.
  app.delete('/checklist/:itemId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const taskId = await itemTask(req, reply, itemId);
    if (!taskId) return reply;
    const res = await service.removeItem(itemId, actor(req));
    await announce(taskId);
    await note(req, taskId, 'CHECKLIST_REMOVED', { itemId, text: res.text, count: res.count, batchId: res.batchId });
    return { data: { batchId: res.batchId, count: res.count, taskId } };
  });

  // ---- checklists --------------------------------------------------------------------------------

  app.post('/tasks/:id/checklists', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const body = listSchema.parse(req.body);
    const list = await service.addList(id, actor(req), body.title, body.afterId);
    await announce(id);
    await note(req, id, 'CHECKLIST_LIST_ADDED', { listId: list.id, title: list.title });
    return reply.status(201).send({ data: list });
  });

  app.put('/checklists/:listId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { listId } = req.params as { listId: string };
    const body = renameListSchema.parse(req.body);
    const taskId = await listTask(req, reply, listId);
    if (!taskId) return reply;
    const res = await service.renameList(listId, actor(req), body.title);
    await announce(taskId);
    if (res.from !== res.list.title) await note(req, taskId, 'CHECKLIST_LIST_RENAMED', { listId, from: res.from, to: res.list.title });
    return { data: res.list };
  });

  app.post('/checklists/:listId/duplicate', { preHandler: guard.authenticate }, async (req, reply) => {
    const { listId } = req.params as { listId: string };
    const taskId = await listTask(req, reply, listId);
    if (!taskId) return reply;
    const res = await service.duplicateList(listId, actor(req));
    await announce(taskId);
    await note(req, taskId, 'CHECKLIST_LIST_DUPLICATED', { listId: res.list.id, title: res.title, count: res.count });
    return reply.status(201).send({ data: res.list });
  });

  app.delete('/checklists/:listId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { listId } = req.params as { listId: string };
    const taskId = await listTask(req, reply, listId);
    if (!taskId) return reply;
    const res = await service.removeList(listId, actor(req));
    await announce(taskId);
    await note(req, taskId, 'CHECKLIST_LIST_REMOVED', { listId, title: res.title, count: res.count, batchId: res.batchId });
    return { data: { batchId: res.batchId, count: res.count, taskId } };
  });

  // Undo, and the history's Restore (30 days).
  app.post('/tasks/:id/checklist/restore', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { batchId } = restoreSchema.parse(req.body);
    const res = await service.restore(id, actor(req), batchId);
    await announce(id);
    await note(req, id, 'CHECKLIST_RESTORED', { text: res.title, count: res.count, batchId, kind: res.kind });
    return { data: { restored: res.restored, taskId: id } };
  });
}
