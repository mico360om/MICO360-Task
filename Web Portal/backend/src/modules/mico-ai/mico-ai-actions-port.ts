import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ForbiddenError } from '../../lib/http-errors';
import { dueDayKey } from '../../lib/due-date';
import { actingVia } from '../../lib/acting-via';
import type { Logger } from '../../lib/logger';
import { normalizeFinalMinutes } from '../meetings/final-minutes';
import type { FinalMinutesRepository } from '../meetings/final-minutes-repository';
import type { TaskService } from '../tasks/task-service';
import type { AssigneeService } from '../tasks/assignee-service';
import type { MeetingService } from '../meetings/meeting-service';
import type { AttendeeService } from '../meetings/attendee-service';
import type { AgendaService } from '../meetings/agenda-service';
import type { MeetingNotifyService } from '../meetings/meeting-notify-service';
import type { ActionMeetingStamp, ActionTaskState, MicoAiWritePort } from './mico-ai-actions';
import type { Viewer } from './mico-ai-data';
import type { Priority } from './mico-ai-actions-types';

/**
 * MICO AI's changes through the app's own services, as the person who confirmed them: the same
 * services, checks, notifications and live updates as the website's own routes (POST /tasks, PUT
 * /tasks/:id, the assignee routes, POST /meetings with its people and agenda, the invitations, the
 * final minutes). Every write checks again that the person may make it, so MICO AI can never do
 * what they couldn't do in the app.
 *
 * There is no plain delete here. The one removal is Undo's: a task MICO AI created on the person's
 * own card, by its creator, in one guarded write that only goes through while nothing about it —
 * version, history, tags, watchers, blockers, people — has changed since (removing tasks is
 * otherwise for admins and project managers).
 */
export interface MicoAiActionsPortDeps {
  prisma: PrismaClient;
  timeZone: string;
  taskService: Pick<TaskService, 'createTask' | 'updateTask' | 'getTask'>;
  assigneeService: Pick<AssigneeService, 'assertAssignable' | 'eligibleAssignees' | 'assignUsers' | 'unassignUser' | 'notifyAssigned' | 'listAssignees'>;
  projectAccess: {
    canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean>;
    accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null>;
  };
  meetingService: Pick<MeetingService, 'createMeeting' | 'cancelMeeting' | 'deleteMeeting' | 'canEditMeeting'>;
  attendeeService: Pick<AttendeeService, 'addAttendee'>;
  agendaService: Pick<AgendaService, 'addItem'>;
  meetingNotify: Pick<MeetingNotifyService, 'sendInvites' | 'sendCancellation'>;
  finalMinutes: FinalMinutesRepository;
  /** The meeting's facts for the final minutes' AI draft (as the meeting page's "Draft with AI" reads them). */
  minutesFacts: (viewer: Viewer, meetingId: string) => Promise<string>;
  draftMinutesWithAi: (facts: string, requester: { userId: string; roles?: string[] }, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  onFinalMinutesChanged?: (meetingId: string) => void;
  workingDays: () => Promise<number[]>;
  isActiveUser: (userId: string) => Promise<boolean>;
  /** Live updates to a project's open boards and task panels. */
  broadcast: (projectId: string, event: string, payload: unknown) => void;
  audit: { record(entry: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown }): Promise<unknown> };
  logger?: Pick<Logger, 'error'>;
}

const NO_PROJECT = 'You do not have access to this project.';
const NO_TASK = 'You do not have permission to do that.';
const NO_MEETING = 'Only the organizer, the project manager or an admin can change this meeting.';
const day = (key: string | null | undefined) => (key ? new Date(`${key}T00:00:00.000Z`) : null);
const nameOf = (u: { firstName: string; lastName: string; username: string } | null | undefined) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : 'Someone');
const isConflict = (err: unknown) => (err as { status?: unknown })?.status === 409 || (err as { code?: unknown })?.code === 'VERSION_CONFLICT';

export function createMicoAiActionsPort(deps: MicoAiActionsPortDeps): MicoAiWritePort {
  const { prisma, timeZone, taskService, assigneeService, projectAccess, meetingService, meetingNotify, finalMinutes } = deps;
  const log = (msg: string, err: unknown, meta: Record<string, unknown> = {}) => {
    try {
      deps.logger?.error(msg, { err, ...meta });
    } catch {
      // Logging must never be what fails.
    }
  };
  /** A live update is best effort: it never undoes or fails the change it follows. */
  const announce = (projectId: string, event: string, payload: unknown) => {
    try {
      deps.broadcast(projectId, event, payload);
    } catch (err) {
      log('MICO AI: a live update failed', err, { event });
    }
  };

  async function canUseProject(viewer: Viewer, projectId: string): Promise<boolean> {
    const ids = await projectAccess.accessibleProjectIds(viewer.userId, viewer.roles);
    return ids === null || ids.includes(projectId);
  }
  async function mayChangeTask(viewer: Viewer, taskId: string): Promise<void> {
    if (!(await projectAccess.canViewTask(viewer.userId, viewer.roles, taskId))) throw new ForbiddenError(NO_TASK);
  }
  async function mayChangeMeeting(viewer: Viewer, meetingId: string): Promise<void> {
    if (!(await meetingService.canEditMeeting(viewer.userId, viewer.roles, meetingId))) throw new ForbiddenError(NO_MEETING);
  }

  async function taskState(taskId: string): Promise<ActionTaskState | null> {
    const t = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } },
      select: {
        id: true,
        key: true,
        title: true,
        projectId: true,
        columnId: true,
        priority: true,
        dueDate: true,
        version: true,
        createdById: true,
        project: { select: { name: true } },
        column: { select: { name: true, category: true } },
        assignees: { select: { userId: true } },
        _count: { select: { activities: true, tags: true, watchers: true, dependencies: true, dependedOnBy: true } },
      },
    });
    if (!t) return null;
    // A repeating task's next copy points back at it (deleted copies count: the copy was made).
    const next = await prisma.task.findFirst({ where: { recurrenceSourceId: taskId }, select: { key: true } });
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      projectId: t.projectId,
      projectName: t.project.name,
      columnId: t.columnId,
      columnName: t.column?.name ?? '',
      category: t.column?.category ?? 'TODO',
      priority: t.priority as Priority,
      due: dueDayKey(t.dueDate, timeZone),
      assigneeIds: t.assignees.map((a) => a.userId).sort(),
      version: t.version,
      activity: t._count.activities,
      tags: t._count.tags,
      watchers: t._count.watchers,
      links: t._count.dependencies + t._count.dependedOnBy,
      createdById: t.createdById,
      nextCopyKey: next?.key ?? null,
    };
  }

  async function meetingStamp(meetingId: string): Promise<ActionMeetingStamp | null> {
    const m = await prisma.meeting.findFirst({
      where: { id: meetingId, deletedAt: null },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startAt: true,
        endAt: true,
        status: true,
        invitesSentAt: true,
        updatedAt: true,
        attendees: { select: { id: true, userId: true, externalEmail: true, role: true }, orderBy: { id: 'asc' } },
        agendaItems: { select: { id: true, title: true, ownerId: true, expectedMinutes: true, position: true, completed: true }, orderBy: { id: 'asc' } },
        notes: { select: { id: true, body: true, type: true, highlighted: true, editedAt: true, deletedAt: true }, orderBy: { id: 'asc' } },
        actionItems: { select: { id: true, description: true, status: true, assigneeId: true, dueDate: true, updatedAt: true }, orderBy: { id: 'asc' } },
        decisions: { select: { id: true, title: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } },
      },
    });
    if (!m) return null;
    // Anything about the meeting, its people, agenda, notes, action items or decisions changing changes the stamp.
    const { id, title, startAt, status, invitesSentAt, ...rest } = m;
    const stamp = createHash('sha1').update(JSON.stringify({ title, startAt, status, ...rest })).digest('hex');
    return { id, title, startAt, status, invitesSentAt, stamp };
  }

  const changedMinutes = (meetingId: string) => {
    try {
      deps.onFinalMinutesChanged?.(meetingId);
    } catch (err) {
      log('MICO AI: the minutes’ live update failed', err, { meetingId });
    }
  };

  return {
    taskState,
    async changedBy(taskId, after) {
      const rows = await prisma.activity.findMany({
        where: { taskId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: Math.max(0, after),
        take: 200,
        select: { userId: true, meta: true, user: { select: { firstName: true, lastName: true, username: true } } },
      });
      return rows.reverse().map((r) => ({ userId: r.userId, name: nameOf(r.user), via: (r.meta as { via?: unknown } | null)?.via === 'mico-ai' }));
    },
    async columns(projectId) {
      return prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, name: true, category: true, position: true, enabled: true }, orderBy: { position: 'asc' } });
    },
    eligibleAssignees: (projectId, userIds) => assigneeService.eligibleAssignees(projectId, userIds),
    async projectOwner(projectId) {
      return (await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { ownerId: true } }))?.ownerId ?? null;
    },
    canViewTask: (viewer, taskId) => projectAccess.canViewTask(viewer.userId, viewer.roles, taskId),
    canUseProject,
    canEditMeeting: (viewer, meetingId) => meetingService.canEditMeeting(viewer.userId, viewer.roles, meetingId),
    meetingStamp,
    minutes: (meetingId) => finalMinutes.get(meetingId),
    workingDays: () => deps.workingDays(),

    async draftMinutes(viewer, meetingId, signal) {
      await mayChangeMeeting(viewer, meetingId);
      const facts = await deps.minutesFacts(viewer, meetingId);
      return normalizeFinalMinutes(await deps.draftMinutesWithAi(facts, { userId: viewer.userId, roles: viewer.roles }, { signal }));
    },

    // As POST /tasks: the project must be one of the person's; the people must be its active members.
    // The task and its people are one write; telling them (announceTask) comes after.
    async createTask(viewer, input) {
      if (!(await canUseProject(viewer, input.projectId))) throw new ForbiddenError(NO_PROJECT);
      const assignees = await assigneeService.assertAssignable(input.projectId, input.assigneeIds);
      const created = await taskService.createTask({
        title: input.title,
        description: input.description || null,
        projectId: input.projectId,
        columnId: input.columnId,
        priority: input.priority,
        dueDate: day(input.due),
        createdById: viewer.userId,
        tagNames: [],
        assigneeIds: assignees,
      });
      return (await taskState(created.id))!;
    },
    async announceTask(viewer, taskId, assigneeIds) {
      if (assigneeIds.length) await assigneeService.notifyAssigned(taskId, assigneeIds, viewer.userId);
      const task = await taskService.getTask(taskId);
      announce(task.projectId, 'task:created', task);
    },

    // As PUT /tasks/:id: someone who can see the task, from the version they saw. Once the edit is
    // saved, a step after it that fails (a notice, the next copy of a repeating task) is a warning.
    async updateTask(viewer, taskId, change, expectedVersion) {
      await mayChangeTask(viewer, taskId);
      const patch: Parameters<TaskService['updateTask']>[1] = {};
      if (change.due !== undefined) patch.dueDate = day(change.due);
      if (change.priority !== undefined) patch.priority = change.priority;
      if (change.columnId !== undefined) patch.columnId = change.columnId;
      let warning: string | null = null;
      try {
        const task = await taskService.updateTask(taskId, patch, expectedVersion, 'one', viewer.userId);
        announce(task.projectId, 'task:updated', task);
      } catch (err) {
        const now0 = isConflict(err) ? null : await taskState(taskId);
        if (!now0 || now0.version !== expectedVersion + 1) throw err;
        log('MICO AI: a step after a task change failed', err, { taskId });
        warning = 'The change was saved, but a follow-up step (such as the usual notices) failed.';
      }
      return { state: (await taskState(taskId))!, warning };
    },

    // As the assignee routes: the people added must be the project's active members.
    async setAssignees(viewer, taskId, add, remove) {
      await mayChangeTask(viewer, taskId);
      if (add.length) await assigneeService.assignUsers(taskId, add, viewer.userId);
      for (const userId of remove) await assigneeService.unassignUser(taskId, userId, viewer.userId);
      const t = await prisma.task.findFirst({ where: { id: taskId }, select: { projectId: true } });
      if (t) announce(t.projectId, 'task:assignees', { taskId, assignees: await assigneeService.listAssignees(taskId) });
    },

    // Undo only: its creator, the person; one statement that removes it only while it is exactly as
    // Undo last saw it — a tag, a watcher, a blocker, a history line or an edit since keeps it.
    async deleteCreatedTask(viewer, taskId, touch) {
      if (!(await projectAccess.canViewTask(viewer.userId, viewer.roles, taskId))) return false;
      const people = touch.assigneeIds.length ? touch.assigneeIds : ['\u0000'];
      const removed = await prisma.$executeRaw`
        UPDATE tasks SET deletedAt = ${new Date()}
        WHERE id = ${taskId} AND createdById = ${viewer.userId} AND deletedAt IS NULL AND version = ${touch.version}
          AND (SELECT COUNT(*) FROM task_activity WHERE taskId = ${taskId}) = ${touch.activity}
          AND (SELECT COUNT(*) FROM task_tags WHERE taskId = ${taskId}) = ${touch.tags}
          AND (SELECT COUNT(*) FROM task_watchers WHERE taskId = ${taskId}) = ${touch.watchers}
          AND (SELECT COUNT(*) FROM task_dependencies WHERE taskId = ${taskId} OR dependsOnTaskId = ${taskId}) = ${touch.links}
          AND (SELECT COUNT(*) FROM task_assignees WHERE taskId = ${taskId}) = ${touch.assigneeIds.length}
          AND (SELECT COUNT(*) FROM task_assignees WHERE taskId = ${taskId} AND userId IN (${Prisma.join(people)})) = ${touch.assigneeIds.length}`;
      if (removed !== 1) return false;
      const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
      if (t) announce(t.projectId, 'task:deleted', { id: taskId });
      return true;
    },

    // As POST /meetings: the person organizes it; a project meeting needs the project; everyone
    // invited must be active; people and agenda are saved with it, all or nothing.
    async createMeeting(viewer, input) {
      if (input.projectId && !(await canUseProject(viewer, input.projectId))) throw new ForbiddenError(NO_PROJECT);
      for (const userId of input.attendeeIds) if (!(await deps.isActiveUser(userId))) throw new ForbiddenError('Everyone invited must be an active user.');
      const meeting = await meetingService.createMeeting({
        title: input.title,
        description: input.description || null,
        projectId: input.projectId,
        organizerId: viewer.userId,
        createdById: viewer.userId,
        startAt: input.startAt,
        endAt: input.endAt,
        timeZone,
        status: 'SCHEDULED',
      });
      try {
        for (const userId of input.attendeeIds) await deps.attendeeService.addAttendee(meeting.id, { userId, role: 'REQUIRED' });
        for (const title of input.agenda) await deps.agendaService.addItem(meeting.id, { title, ownerId: null, expectedMinutes: null });
      } catch (err) {
        await meetingService.deleteMeeting(meeting.id).catch((e) => log('MICO AI: could not remove a half-made meeting', e, { meetingId: meeting.id }));
        throw err;
      }
      return (await meetingStamp(meeting.id))!;
    },

    async sendInvites(viewer, meetingId) {
      await mayChangeMeeting(viewer, meetingId);
      const r = await meetingNotify.sendInvites(meetingId);
      return { sent: r.sent, failed: r.failed };
    },

    // As the meeting page: invited people hear it is cancelled; a meeting nobody heard of is deleted.
    async removeMeeting(viewer, meetingId, invited) {
      await mayChangeMeeting(viewer, meetingId);
      if (invited) {
        await meetingService.cancelMeeting(meetingId);
        await meetingNotify.sendCancellation(meetingId).catch((err) => log('MICO AI: the meeting’s cancellation notice failed', err, { meetingId }));
        return 'cancelled';
      }
      await meetingService.deleteMeeting(meetingId);
      return 'deleted';
    },

    // As PUT /meetings/:id/final-minutes (a draft): never approved, never emailed.
    async saveMinutes(viewer, meetingId, minutes) {
      await mayChangeMeeting(viewer, meetingId);
      const saved = await finalMinutes.save(meetingId, minutes);
      changedMinutes(meetingId);
      return saved;
    },
    async clearMinutes(viewer, meetingId) {
      await mayChangeMeeting(viewer, meetingId);
      await finalMinutes.remove(meetingId);
      changedMinutes(meetingId);
    },

    async audit(entry) {
      try {
        await deps.audit.record({ ...entry, module: 'mico-ai' });
      } catch (err) {
        log('MICO AI could not write the audit log', err);
      }
    },
    asMicoAi: (fn) => actingVia('mico-ai', fn),
  };
}
