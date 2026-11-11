import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { BlockRow, CalendarStore, ReminderRow } from './calendar-store';
import { blockProblem, mayChangeBlock, mayPlanBlock } from './work-blocks';
import {
  MAX_REMINDER_OFFSET_MINUTES,
  fireAtOf,
  mayAddReminder,
  mayChangeReminder,
  mayMuteReminder,
  maySeeReminder,
  reminderSpecProblem,
  reminderState,
  type ReminderAnchor,
  type ReminderClock,
} from './task-reminders';
import { normalizeCalendarPrefs } from './calendar-prefs';

/**
 * Calendar scheduling routes (all staff routes; a client session is refused by the auth guard).
 *
 *   object  GET/POST       /tasks/:id/work-blocks              a task's planned time; plan some
 *   object  PUT/DELETE     /tasks/:id/work-blocks/:blockId     move / resize / remove one
 *   object  GET/POST       /tasks/:id/reminders                my reminders on a task (and those I set); add one
 *   object  PUT/DELETE     /tasks/:id/reminders/:reminderId    the setter changes / removes one
 *   object  POST           /tasks/:id/reminders/:reminderId/mute    its person mutes one set for them
 *   object  POST           /tasks/:id/reminders/:reminderId/snooze  its person snoozes one
 *   own     GET/PUT        /calendar/preferences               Split | Full, Show, Team
 *
 * Everything about a task answers 404 to someone who can't open it (nothing is told), and a block or
 * reminder is reached through its own task only.
 */

/** The task as these routes read it (live: not deleted — a binned task is not found). */
export interface CalendarTaskFacts {
  id: string;
  key: string;
  title: string;
  projectId: string;
  createdById: string;
  assigneeIds: string[];
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  archivedAt?: Date | null;
}

export interface CalendarRoutesDeps {
  guard: AuthGuard;
  store: CalendarStore;
  task(taskId: string): Promise<CalendarTaskFacts | null>;
  canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean>;
  /** Does this person run the project (its owner, manager, a MANAGER member — or an administrator)? */
  runsProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  names(userIds: string[]): Promise<Map<string, string>>;
  clock(): Promise<ReminderClock>;
}

/** At most this many blocks / reminders per person on one task. */
export const MAX_BLOCKS_PER_TASK = 50;
export const MAX_REMINDERS_PER_TASK = 20;

const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const personId = z.string().min(1).max(191);
const blockBody = z.object({ userId: personId.optional(), startAt: instant, endAt: instant });
const blockMoveBody = z.object({ startAt: instant, endAt: instant });
const reminderBody = z.object({
  userId: personId.optional(),
  at: instant.optional(),
  anchor: z.enum(['start', 'due']).optional(),
  offsetMinutes: z.number().int().min(0).max(MAX_REMINDER_OFFSET_MINUTES).optional(),
});
const muteBody = z.object({ muted: z.boolean() });
const snoozeBody = z.object({ minutes: z.number().int().min(5).max(60 * 24 * 60).optional(), until: instant.nullable().optional() });

const MINUTE = 60_000;

export async function registerCalendarRoutes(app: FastifyInstance, deps: CalendarRoutesDeps): Promise<void> {
  const { guard, store } = deps;
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  /** The task, when the person may open it (else 404 — nothing is told). */
  async function visibleTask(req: FastifyRequest): Promise<CalendarTaskFacts> {
    const { id } = req.params as { id: string };
    const v = viewer(req);
    const task = (await deps.canViewTask(v.id, v.roles, id)) ? await deps.task(id) : null;
    if (!task || task.deletedAt) throw new NotFoundError('Task not found.');
    return task;
  }
  const notDone = (task: CalendarTaskFacts, what: string) => {
    if (task.completedAt) throw new ConflictError(`This task is done — reopen it to ${what}.`);
  };

  // ── Work blocks ────────────────────────────────────────────────────────────
  async function blockView(rows: BlockRow[], req: FastifyRequest, task: CalendarTaskFacts) {
    const v = viewer(req);
    const names = await deps.names([...new Set(rows.flatMap((b) => [b.userId, b.plannedById]))]);
    const runs = rows.length ? await deps.runsProject(v.id, v.roles, task.projectId) : false;
    return rows.map((b) => ({
      id: b.id,
      taskId: b.taskId,
      userId: b.userId,
      userName: names.get(b.userId) ?? 'Someone',
      plannedById: b.plannedById,
      plannedByName: names.get(b.plannedById) ?? 'Someone',
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      canChange: mayChangeBlock({ viewerId: v.id, block: b, runsProject: runs }),
    }));
  }
  async function blockOf(req: FastifyRequest, task: CalendarTaskFacts): Promise<BlockRow> {
    const { blockId } = req.params as { blockId: string };
    const block = await store.block(blockId);
    if (!block || block.taskId !== task.id) throw new NotFoundError('Planned time not found.');
    return block;
  }
  const checkTimes = (startAt: Date, endAt: Date) => {
    const problem = blockProblem(startAt, endAt);
    if (problem) throw new ValidationError(problem);
  };

  app.get('/tasks/:id/work-blocks', { preHandler: guard.authenticate }, async (req) => {
    const task = await visibleTask(req);
    return { data: await blockView(await store.blocksOfTask(task.id), req, task) };
  });

  app.post('/tasks/:id/work-blocks', { preHandler: guard.authenticate }, async (req, reply) => {
    const task = await visibleTask(req);
    const body = blockBody.parse(req.body);
    const v = viewer(req);
    const person = body.userId ?? v.id;
    const runs = await deps.runsProject(v.id, v.roles, task.projectId);
    if (!mayPlanBlock({ viewerId: v.id, personId: person, task, runsProject: runs })) {
      throw new ForbiddenError(
        person === v.id ? 'Only the people on this task plan time for it.' : 'Only whoever made the task or runs its project plans time for its people — and only for the people on it.',
      );
    }
    notDone(task, 'plan time for it');
    checkTimes(body.startAt, body.endAt);
    if ((await store.countBlocks(task.id, person)) >= MAX_BLOCKS_PER_TASK) throw new ValidationError(`At most ${MAX_BLOCKS_PER_TASK} planned blocks per person on one task.`);
    const row = await store.addBlock({ taskId: task.id, userId: person, plannedById: v.id, startAt: body.startAt, endAt: body.endAt });
    return reply.status(201).send({ data: (await blockView([row], req, task))[0] });
  });

  app.put('/tasks/:id/work-blocks/:blockId', { preHandler: guard.authenticate }, async (req) => {
    const task = await visibleTask(req);
    const block = await blockOf(req, task);
    const body = blockMoveBody.parse(req.body);
    const v = viewer(req);
    if (!mayChangeBlock({ viewerId: v.id, block, runsProject: await deps.runsProject(v.id, v.roles, task.projectId) })) {
      throw new ForbiddenError('Only its person, whoever planned it or whoever runs the project changes this planned time.');
    }
    checkTimes(body.startAt, body.endAt);
    const row = await store.updateBlock(block.id, { startAt: body.startAt, endAt: body.endAt });
    return { data: (await blockView([row], req, task))[0] };
  });

  app.delete('/tasks/:id/work-blocks/:blockId', { preHandler: guard.authenticate }, async (req, reply) => {
    const task = await visibleTask(req);
    const block = await blockOf(req, task);
    const v = viewer(req);
    if (!mayChangeBlock({ viewerId: v.id, block, runsProject: await deps.runsProject(v.id, v.roles, task.projectId) })) {
      throw new ForbiddenError('Only its person, whoever planned it or whoever runs the project removes this planned time.');
    }
    await store.removeBlock(block.id);
    return reply.status(204).send();
  });

  // ── Reminders ──────────────────────────────────────────────────────────────
  async function reminderView(rows: ReminderRow[], req: FastifyRequest, task: CalendarTaskFacts) {
    const v = viewer(req);
    const [names, clock] = await Promise.all([deps.names([...new Set(rows.flatMap((r) => [r.userId, r.setById]))]), deps.clock()]);
    const now = new Date();
    return rows.map((r) => {
      const { state, fireAt } = reminderState(r, task, now, clock);
      return {
        id: r.id,
        taskId: r.taskId,
        userId: r.userId,
        userName: names.get(r.userId) ?? 'Someone',
        setById: r.setById,
        setByName: names.get(r.setById) ?? 'Someone',
        at: r.at?.toISOString() ?? null,
        anchor: r.anchor,
        offsetMinutes: r.offsetMinutes,
        fireAt: fireAt?.toISOString() ?? null,
        state,
        muted: !!r.mutedAt,
        snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
        sentAt: r.sentAt?.toISOString() ?? null,
        canChange: mayChangeReminder(v.id, r),
        canMute: mayMuteReminder(v.id, r),
      };
    });
  }
  async function reminderOf(req: FastifyRequest, task: CalendarTaskFacts): Promise<ReminderRow> {
    const { reminderId } = req.params as { reminderId: string };
    const r = await store.reminder(reminderId);
    if (!r || r.taskId !== task.id || !maySeeReminder(req.user!.id, r)) throw new NotFoundError('Reminder not found.');
    return r;
  }
  /** The timing asked for, checked: its time worked out from the task, and still to come. */
  async function timingOf(body: z.infer<typeof reminderBody>, task: CalendarTaskFacts) {
    const spec = { at: body.at ?? null, anchor: (body.anchor ?? null) as ReminderAnchor | null, offsetMinutes: body.offsetMinutes ?? null };
    const problem = reminderSpecProblem(spec);
    if (problem) throw new ValidationError(problem);
    if (spec.anchor && !(spec.anchor === 'start' ? task.startDate : task.dueDate)) {
      throw new ValidationError(spec.anchor === 'start' ? 'This task has no start date.' : 'This task has no due date.');
    }
    const timing = spec.at ? { at: spec.at, anchor: null, offsetMinutes: null } : { at: null, anchor: spec.anchor, offsetMinutes: spec.offsetMinutes };
    const fireAt = fireAtOf(timing, task, await deps.clock());
    if (!fireAt || fireAt.getTime() < Date.now() - MINUTE) throw new ValidationError('That time has already passed — choose a later one.');
    return { ...timing, nextAt: fireAt };
  }

  app.get('/tasks/:id/reminders', { preHandler: guard.authenticate }, async (req) => {
    const task = await visibleTask(req);
    const rows = await store.remindersOfTask(task.id, req.user!.id);
    return { data: await reminderView(rows, req, task) };
  });

  app.post('/tasks/:id/reminders', { preHandler: guard.authenticate }, async (req, reply) => {
    const task = await visibleTask(req);
    const body = reminderBody.parse(req.body);
    const v = viewer(req);
    const recipient = body.userId ?? v.id;
    const runs = recipient === v.id ? false : await deps.runsProject(v.id, v.roles, task.projectId);
    if (!mayAddReminder({ viewerId: v.id, recipientId: recipient, task, runsProject: runs })) {
      throw new ForbiddenError('Only whoever made the task or runs its project sets reminders for its people — and only for the people on it.');
    }
    notDone(task, 'add a reminder');
    const timing = await timingOf(body, task);
    if ((await store.countReminders(task.id, recipient)) >= MAX_REMINDERS_PER_TASK) throw new ValidationError(`At most ${MAX_REMINDERS_PER_TASK} reminders per person on one task.`);
    const row = await store.addReminder({ taskId: task.id, userId: recipient, setById: v.id, ...timing });
    return reply.status(201).send({ data: (await reminderView([row], req, task))[0] });
  });

  app.put('/tasks/:id/reminders/:reminderId', { preHandler: guard.authenticate }, async (req) => {
    const task = await visibleTask(req);
    const r = await reminderOf(req, task);
    if (!mayChangeReminder(req.user!.id, r)) throw new ForbiddenError('Only whoever set this reminder changes it.');
    const { userId: _ignored, ...body } = reminderBody.parse(req.body);
    void _ignored;
    const timing = await timingOf(body, task);
    // A new time: any snooze is over (its person's mute stays theirs).
    const row = await store.updateReminder(r.id, { ...timing, snoozedUntil: null });
    return { data: (await reminderView([row], req, task))[0] };
  });

  app.delete('/tasks/:id/reminders/:reminderId', { preHandler: guard.authenticate }, async (req, reply) => {
    const task = await visibleTask(req);
    const r = await reminderOf(req, task);
    if (!mayChangeReminder(req.user!.id, r)) throw new ForbiddenError('Only whoever set this reminder removes it — you can mute it for yourself.');
    await store.removeReminder(r.id);
    return reply.status(204).send();
  });

  app.post('/tasks/:id/reminders/:reminderId/mute', { preHandler: guard.authenticate }, async (req) => {
    const task = await visibleTask(req);
    const r = await reminderOf(req, task);
    if (!mayMuteReminder(req.user!.id, r)) throw new ForbiddenError('You mute only reminders someone else set for you.');
    const { muted } = muteBody.parse(req.body);
    const row = await store.updateReminder(r.id, { mutedAt: muted ? (r.mutedAt ?? new Date()) : null });
    return { data: (await reminderView([row], req, task))[0] };
  });

  app.post('/tasks/:id/reminders/:reminderId/snooze', { preHandler: guard.authenticate }, async (req) => {
    const task = await visibleTask(req);
    const r = await reminderOf(req, task);
    if (r.userId !== req.user!.id) throw new ForbiddenError('Only its person snoozes a reminder.');
    const body = snoozeBody.parse(req.body);
    let until: Date | null = null;
    if (body.minutes !== undefined) until = new Date(Date.now() + body.minutes * MINUTE);
    else if (body.until) until = body.until;
    if (until && (until.getTime() <= Date.now() || until.getTime() > Date.now() + 60 * 24 * 60 * MINUTE)) throw new ValidationError('Snooze to a time in the next 60 days.');
    const base = fireAtOf(r, task, await deps.clock());
    const row = await store.updateReminder(r.id, { snoozedUntil: until, nextAt: until ?? base });
    return { data: (await reminderView([row], req, task))[0] };
  });

  // ── The person's Calendar choices ──────────────────────────────────────────
  app.get('/calendar/preferences', { preHandler: guard.authenticate }, async (req) => {
    return { data: normalizeCalendarPrefs(await store.prefs(req.user!.id)) };
  });

  app.put('/calendar/preferences', { preHandler: guard.authenticate }, async (req) => {
    const next = normalizeCalendarPrefs(req.body, normalizeCalendarPrefs(await store.prefs(req.user!.id)));
    await store.savePrefs(req.user!.id, next);
    return { data: next };
  });
}
