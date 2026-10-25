import { company, NOW, type MemoryData } from './mico-ai-data.fixture';
import { createMemoryMicoAiData } from './mico-ai-data.fixture';
import type { FinalMinutesContent } from '../meetings/final-minutes';
import type { FinalMinutesRecord } from '../meetings/final-minutes-repository';
import type { ActionColumn, ActionMeetingStamp, ActionTaskState, MicoAiWritePort } from './mico-ai-actions';
import type { AiMeetingDetail, Viewer } from './mico-ai-data';
import type { Priority } from './mico-ai-actions-types';

/**
 * An in-memory company for MICO AI's actions (on the same data the read tools use): its tasks with
 * versions and history counts, columns, meetings and final minutes, following the app's rules — a
 * project's tasks for its people (admins: all), meetings changed by their organizer, creator or
 * project manager. Every write is recorded with whether it ran "via MICO AI".
 */
export interface FakeWorld {
  data: MemoryData;
  read: ReturnType<typeof createMemoryMicoAiData>;
  port: MicoAiWritePort;
  /** "createTask t:RIG-22 via" … in order. */
  calls: string[];
  audits: Array<Record<string, unknown>>;
  invites: string[];
  /** A colleague changes a task (its version and history move on). */
  touchTask(taskId: string, by?: string, change?: Partial<{ due: string | null; priority: Priority }>): void;
  touchMeeting(meetingId: string): void;
  minutes: Map<string, FinalMinutesRecord>;
  /** The next write of this kind throws (a database hiccup). */
  failNext(what: 'createTask' | 'updateTask' | 'createMeeting' | 'sendInvites'): void;
  /** The AI's draft of the final minutes (default: a short draft from the meeting's notes). */
  draft: (meetingId: string) => FinalMinutesContent;
}

const DAY = (key: string) => new Date(`${key}T00:00:00.000Z`);
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const COLUMNS: Array<Omit<ActionColumn, 'id'> & { key: string }> = [
  { key: 'backlog', name: 'Backlog', category: 'BACKLOG', position: 0, enabled: true },
  { key: 'todo', name: 'To do', category: 'TODO', position: 1, enabled: true },
  { key: 'doing', name: 'In progress', category: 'IN_PROGRESS', position: 2, enabled: true },
  { key: 'blocked', name: 'Blocked', category: 'BLOCKED', position: 3, enabled: true },
  { key: 'review', name: 'Review', category: 'REVIEW', position: 4, enabled: true },
  { key: 'done', name: 'Done', category: 'DONE', position: 5, enabled: true },
  { key: 'qa', name: 'QA (switched off)', category: 'REVIEW', position: 6, enabled: false },
];

export function createFakeWorld(data: MemoryData = company()): FakeWorld {
  const read = createMemoryMicoAiData(data);
  const calls: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const invites: string[] = [];
  let via = false;
  let failing: string | null = null;
  let counter = 100;
  const meta = new Map<string, { version: number; activity: number; lastActor: string | null; deleted: boolean }>();
  const metaOf = (id: string) => {
    if (!meta.has(id)) meta.set(id, { version: 3, activity: 2, lastActor: 'u-admin', deleted: false });
    return meta.get(id)!;
  };
  const stamps = new Map<string, number>();
  const minutes = new Map<string, FinalMinutesRecord>();
  for (const m of data.meetings ?? []) {
    if (m.finalMinutes) {
      const { status, ...content } = m.finalMinutes;
      minutes.set(m.id, { content, status, approvedById: status === 'APPROVED' ? 'u-admin' : null, approvedAt: status === 'APPROVED' ? NOW : null, savedAt: new Date('2026-10-22T10:00:00Z') });
    }
  }
  const nameOf = (id: string | null) => {
    const p = data.people.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : null;
  };
  const isAdmin = (v: Viewer) => v.roles.includes('ADMIN');
  const sees = async (v: Viewer, projectId: string) => {
    const ids = await read.accessibleProjectIds(v);
    return ids === null || ids.includes(projectId);
  };
  const columnsOf = (projectId: string): ActionColumn[] => COLUMNS.map(({ key, ...c }) => ({ id: `${projectId}:${key}`, ...c }));
  const fail = (what: string) => {
    if (failing === what) {
      failing = null;
      throw new Error(`${what} failed: database unavailable`);
    }
  };
  const record = (what: string) => calls.push(`${what}${via ? ' via' : ''}`);
  const live = (id: string) => data.tasks.find((t) => t.id === id && !metaOf(t.id).deleted) ?? null;
  const state = (id: string): ActionTaskState | null => {
    const t = live(id);
    if (!t) return null;
    const m = metaOf(id);
    const column = columnsOf(t.projectId).find((c) => c.category === t.category && c.enabled) ?? columnsOf(t.projectId)[1]!;
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      projectId: t.projectId,
      projectName: t.projectName,
      columnId: column.id,
      columnName: column.name,
      category: t.category,
      priority: t.priority as Priority,
      due: dayOf(t.dueDate),
      assigneeIds: [...t.assigneeIds],
      version: m.version,
      activity: m.activity,
      lastActor: nameOf(m.lastActor),
    };
  };
  const meetingOf = (id: string) => (data.meetings ?? []).find((m) => m.id === id && m.status !== 'DELETED') ?? null;
  const stampOf = (id: string): ActionMeetingStamp | null => {
    const m = meetingOf(id);
    if (!m) return null;
    return { id: m.id, title: m.title, startAt: m.startAt, status: m.status, invitesSentAt: invites.includes(m.id) ? NOW : null, stamp: `${m.id}#${stamps.get(m.id) ?? 0}` };
  };
  const bump = (id: string, actor: string, rows = 1) => {
    const m = metaOf(id);
    m.version++;
    m.activity += rows;
    m.lastActor = actor;
  };

  const port: MicoAiWritePort = {
    async taskState(id) {
      return state(id);
    },
    async columns(projectId) {
      return columnsOf(projectId);
    },
    async eligibleAssignees(projectId, userIds) {
      const p = data.projects.find((x) => x.id === projectId);
      if (!p) return [];
      const team = new Set([p.ownerId, p.managerId, ...data.members.filter((m) => m.projectId === projectId).map((m) => m.userId)].filter(Boolean));
      return userIds.filter((id) => team.has(id) && data.people.find((x) => x.id === id)?.active);
    },
    async projectOwner(projectId) {
      return data.projects.find((p) => p.id === projectId)?.ownerId ?? null;
    },
    async canViewTask(v, taskId) {
      const t = live(taskId);
      return !!t && (isAdmin(v) || (await sees(v, t.projectId)));
    },
    async canUseProject(v, projectId) {
      return sees(v, projectId);
    },
    async canEditMeeting(v, meetingId) {
      return read.canEditMeeting(v, meetingId);
    },
    async meetingStamp(id) {
      return stampOf(id);
    },
    async minutes(meetingId) {
      const m = minutes.get(meetingId);
      return m ? structuredClone(m) : null;
    },
    async workingDays() {
      return [0, 1, 2, 3, 4];
    },
    async draftMinutes(v, meetingId) {
      record(`draftMinutes ${meetingId}`);
      if (!(await read.canEditMeeting(v, meetingId))) throw new Error('not allowed');
      return world.draft(meetingId);
    },
    async createTask(v, input) {
      fail('createTask');
      if (!(await sees(v, input.projectId))) throw Object.assign(new Error('You do not have access to this project.'), { status: 403 });
      const p = data.projects.find((x) => x.id === input.projectId)!;
      const id = `t-new-${++counter}`;
      const n = data.tasks.filter((t) => t.projectId === p.id).length + 30;
      const column = columnsOf(p.id).find((c) => c.id === input.columnId)!;
      data.tasks.push({
        id, key: `${p.code}-${n}`, title: input.title, projectId: p.id, projectName: p.name, columnName: column.name, category: column.category,
        priority: input.priority, startDate: null, dueDate: input.due ? DAY(input.due) : null, completedAt: null, createdAt: NOW, updatedAt: NOW,
        progress: 0, isMilestone: false, assigneeIds: [...input.assigneeIds],
      });
      meta.set(id, { version: 1, activity: 1 + input.assigneeIds.length, lastActor: v.userId, deleted: false });
      record(`createTask ${p.code}-${n}`);
      return state(id)!;
    },
    async updateTask(v, taskId, change, expectedVersion) {
      fail('updateTask');
      const t = live(taskId);
      if (!t) throw Object.assign(new Error('Task not found.'), { status: 404 });
      if (!(await port.canViewTask(v, taskId))) throw Object.assign(new Error('You do not have permission to do that.'), { status: 403 });
      if (metaOf(taskId).version !== expectedVersion) throw Object.assign(new Error('This task was changed by someone else. Reload and try again.'), { status: 409, code: 'VERSION_CONFLICT' });
      if (change.due !== undefined) t.dueDate = change.due ? DAY(change.due) : null;
      if (change.priority) t.priority = change.priority;
      if (change.columnId) {
        const c = columnsOf(t.projectId).find((x) => x.id === change.columnId)!;
        t.category = c.category;
        t.columnName = c.name;
        t.completedAt = c.category === 'DONE' ? NOW : null;
      }
      bump(taskId, v.userId);
      record(`updateTask ${t.key}`);
      return state(taskId)!;
    },
    async setAssignees(v, taskId, add, remove) {
      const t = live(taskId)!;
      t.assigneeIds = [...t.assigneeIds.filter((id) => !remove.includes(id)), ...add.filter((id) => !t.assigneeIds.includes(id))];
      const m = metaOf(taskId);
      m.activity += add.length + remove.length;
      m.lastActor = v.userId;
      record(`setAssignees ${t.key} +${add.join(',')} -${remove.join(',')}`);
    },
    async deleteTask(_v, taskId) {
      metaOf(taskId).deleted = true;
      record(`deleteTask ${data.tasks.find((t) => t.id === taskId)?.key}`);
    },
    async createMeeting(v, input) {
      fail('createMeeting');
      if (input.projectId && !(await sees(v, input.projectId))) throw Object.assign(new Error('You do not have access to this project.'), { status: 403 });
      const id = `m-new-${++counter}`;
      const m: AiMeetingDetail = {
        id, title: input.title, projectId: input.projectId, organizerId: v.userId, createdById: v.userId, attendeeUserIds: [...input.attendeeIds],
        startAt: input.startAt, endAt: input.endAt, status: 'SCHEDULED', location: null, decisions: 0, openActionItems: 0, description: input.description || null,
        timeZone: 'Asia/Muscat', attendees: input.attendeeIds.map((u) => ({ userId: u, name: null, response: 'PENDING', attendance: 'INVITED' })),
        agenda: input.agenda.map((title) => ({ title, ownerId: null, minutes: null, completed: false })), notes: [], actionItems: [], decisionsList: [], finalMinutes: null,
      };
      (data.meetings ??= []).push(m);
      record(`createMeeting ${input.title}`);
      return stampOf(id)!;
    },
    async sendInvites(_v, meetingId) {
      fail('sendInvites');
      invites.push(meetingId);
      stamps.set(meetingId, (stamps.get(meetingId) ?? 0) + 1);
      record(`sendInvites ${meetingId}`);
      const m = meetingOf(meetingId)!;
      return { sent: m.attendeeUserIds.length + 1, failed: 0 };
    },
    async removeMeeting(_v, meetingId, invited) {
      const m = meetingOf(meetingId)!;
      m.status = invited ? 'CANCELLED' : 'DELETED';
      record(`${invited ? 'cancelMeeting' : 'deleteMeeting'} ${m.title}`);
      return invited ? 'cancelled' : 'deleted';
    },
    async saveMinutes(_v, meetingId, rec) {
      const saved = { ...structuredClone(rec), savedAt: new Date(NOW.getTime() + ++counter * 1000) };
      minutes.set(meetingId, saved);
      record(`saveMinutes ${meetingId} ${rec.status}`);
      return structuredClone(saved);
    },
    async clearMinutes(_v, meetingId) {
      minutes.delete(meetingId);
      record(`clearMinutes ${meetingId}`);
    },
    async audit(entry) {
      audits.push({ ...entry, via });
    },
    async asMicoAi(fn) {
      via = true;
      try {
        return await fn();
      } finally {
        via = false;
      }
    },
  };

  const world: FakeWorld = {
    data,
    read,
    port,
    calls,
    audits,
    invites,
    minutes,
    touchTask(taskId, by = 'u-omar', change = {}) {
      const t = data.tasks.find((x) => x.id === taskId)!;
      if (change.due !== undefined) t.dueDate = change.due ? DAY(change.due) : null;
      if (change.priority) t.priority = change.priority;
      bump(taskId, by);
    },
    touchMeeting(meetingId) {
      stamps.set(meetingId, (stamps.get(meetingId) ?? 0) + 1);
    },
    failNext(what) {
      failing = what;
    },
    draft: (meetingId) => ({
      summary: `Draft for ${meetingOf(meetingId)?.title}.`,
      discussion: [{ topic: 'RIG-14', text: 'The pressure test moves to rig 3.' }],
      decisions: ['Finish the pressure test after calibration'],
      risks: [],
      nextSteps: ['Sara: vendor certificate by 25 Oct'],
    }),
  };
  return world;
}
