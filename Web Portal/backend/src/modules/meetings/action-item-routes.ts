import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ActionItemService } from './action-item-service';
import type { ActionItemRecord } from './action-item-repository';
import type { AuthGuard } from '../auth/auth-guard';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import type { MeetingViewOf } from './invitee-view';

const statusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const createSchema = z.object({
  description: z.string().min(1),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  agendaItemId: z.string().min(1).nullable().optional(),
  sourceNoteId: z.string().min(1).nullable().optional(),
});

const patchSchema = z.object({
  description: z.string().min(1).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: statusEnum.optional(),
});

const mineQuery = z.object({
  status: statusEnum.optional(),
  openOnly: z.coerce.boolean().optional(),
});

export interface ActionItemRouteDeps {
  actionItemService: ActionItemService;
  guard: AuthGuard;
  /** Object-level view/edit authorization on the parent meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** Inherit the meeting's project on creation (so the item shows up in project scope). */
  resolveMeetingProjectId?: (meetingId: string) => Promise<string | null>;
  /** Board keys of linked tasks (id → key), so an item can name and open its task. */
  resolveTaskKeys?: (taskIds: string[]) => Promise<Record<string, string>>;
  /** companies: the request's picked company (X-Company-Id); My Action Items follows it. Absent: no pick. */
  pickOf?: PickOf;
  /** companies: how a person sees the meeting — an invitee from another company sees only their own items. */
  viewOf?: MeetingViewOf;
  /**
   * companies: may the assignee / creator still work on their own item of this meeting — they are one
   * of its people, or it is in one of their active companies (whether or not they are on its project's team).
   */
  ownItemOpen?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
}

export async function registerActionItemRoutes(app: FastifyInstance, deps: ActionItemRouteDeps): Promise<void> {
  const { actionItemService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this action item.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };

  const canViewMeeting = (req: FastifyRequest, meetingId: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], meetingId) : Promise.resolve(true);

  /** Add `taskKey` (null when the item has no task, or the task is gone). */
  async function withTaskKeys<T extends { taskId: string | null }>(items: T[]): Promise<Array<T & { taskKey: string | null }>> {
    const ids = [...new Set(items.map((i) => i.taskId).filter((t): t is string => Boolean(t)))];
    const keys = ids.length && deps.resolveTaskKeys ? await deps.resolveTaskKeys(ids) : {};
    return items.map((i) => ({ ...i, taskKey: (i.taskId && keys[i.taskId]) || null }));
  }

  // The assignee and creator can always work on their own item — even if they never attended the
  // meeting — and admins can touch anything. companies: while the item's meeting is still theirs to
  // reach (one of its people, or in one of their active companies — deps.ownItemOpen).
  const isAdmin = (req: FastifyRequest) => (req.user!.roles ?? []).includes('ADMIN');
  const stillOpen = async (req: FastifyRequest, item: ActionItemRecord): Promise<boolean> =>
    isAdmin(req) || !item.meetingId || !deps.ownItemOpen || deps.ownItemOpen(req.user!.id, req.user!.roles ?? [], item.meetingId);
  const isOwnOrAdmin = (req: FastifyRequest, item: ActionItemRecord): boolean =>
    item.createdById === req.user!.id || item.assigneeId === req.user!.id || isAdmin(req);

  // Update: owner/admin, or anyone who can see the item's meeting.
  async function canUpdateItem(req: FastifyRequest, item: ActionItemRecord): Promise<boolean> {
    if (isOwnOrAdmin(req, item)) return stillOpen(req, item);
    return item.meetingId ? canViewMeeting(req, item.meetingId) : false;
  }

  // Delete: its creator, an admin, or someone who can edit its meeting (not every attendee).
  async function canDeleteItem(req: FastifyRequest, item: ActionItemRecord): Promise<boolean> {
    if (item.createdById === req.user!.id || isAdmin(req)) return stillOpen(req, item);
    if (!item.meetingId) return false;
    return (await canViewMeeting(req, item.meetingId)) && actionItemService.canEditMeeting(req.user!.id, req.user!.roles ?? [], item.meetingId);
  }

  // ── Cross-meeting: the caller's own action items ("My Action Items") ──
  app.get('/me/action-items', { preHandler: guard.authenticate }, async (req) => {
    const q = mineQuery.parse(req.query);
    // companies: with a pick, only that company's items (none = everything assigned to them, as before).
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    const scope = pick ? { pick: { companyId: pick } } : {};
    return { data: await withTaskKeys(await actionItemService.listMine(req.user!.id, { status: q.status, openOnly: q.openOnly, ...scope, admin: isAdmin(req) })) };
  });

  // ── Meeting-scoped register ──
  app.get('/meetings/:id/action-items', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = deps.viewOf ? await deps.viewOf(req.user!.id, req.user!.roles ?? [], id) : (await canViewMeeting(req, id)) ? 'full' : null;
    if (!view) return reply.status(404).send(notFound);
    const items = await actionItemService.listByMeeting(id);
    // companies: an invitee from another company sees their own items, without the project's tasks.
    if (view === 'invitee') return { data: items.filter((i) => i.assigneeId === req.user!.id).map((i) => ({ ...i, taskId: null, taskKey: null })) };
    return { data: await withTaskKeys(items) };
  });

  app.post('/meetings/:id/action-items', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canViewMeeting(req, id))) return reply.status(403).send(forbidden);
    const body = createSchema.parse(req.body);
    const projectId = deps.resolveMeetingProjectId ? await deps.resolveMeetingProjectId(id) : null;
    const item = await actionItemService.addItem(id, req.user!.id, { ...body, projectId });
    return reply.status(201).send({ data: item });
  });

  app.patch('/action-items/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await actionItemService.getItem(id);
    if (!(await canUpdateItem(req, item))) return reply.status(403).send(forbidden);
    const body = patchSchema.parse(req.body);
    let rec = item;
    const { status, ...fields } = body;
    if (Object.keys(fields).length) rec = await actionItemService.updateItem(id, fields);
    if (status !== undefined) rec = await actionItemService.setStatus(id, status);
    return { data: rec };
  });

  app.delete('/action-items/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await actionItemService.getItem(id);
    if (!(await canDeleteItem(req, item))) return reply.status(403).send(forbidden);
    await actionItemService.removeItem(id);
    return reply.status(204).send();
  });
}
