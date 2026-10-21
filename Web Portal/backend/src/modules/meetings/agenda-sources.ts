import { isOverdue } from '../../lib/due-date';

/** A project task Draft agenda may bring up, and why. */
export interface AgendaTask {
  key: string;
  title: string;
  reason: 'overdue' | 'blocked' | 'due';
}

/** What an earlier meeting left open: an action item, or an agenda item it didn't finish. */
export interface AgendaLeftover {
  title: string;
  kind: 'action' | 'agenda';
}

/** Where Draft agenda's tasks and leftovers are read from (see prisma-agenda-sources.ts). */
export interface AgendaSourceStore {
  /** The project's open (not done) tasks that are blocked, or due by `dueBy` — overdue ones included. */
  openTasks(projectId: string, dueBy: Date): Promise<Array<{ key: string; title: string; dueDate: Date | null; blocked: boolean }>>;
  /** The meeting before this one in its series (not cancelled or deleted), or null. */
  previousInSeries(meetingId: string): Promise<string | null>;
  /** The project's last meeting before `before` (not cancelled or deleted, never `excludeId`), or null. */
  lastProjectMeetingBefore(projectId: string, before: Date, excludeId?: string): Promise<string | null>;
  /** A meeting's open action items and unfinished agenda items. */
  leftovers(meetingId: string): Promise<AgendaLeftover[]>;
}

export interface AgendaSourceDeps {
  store: AgendaSourceStore;
  canUseProject(user: { id: string; roles: string[] }, projectId: string): Promise<boolean>;
  canViewMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean>;
  /** Company time zone: "overdue" is a due day before today there. */
  timeZone: string;
  now?: () => Date;
}

const WEEK_MS = 7 * 86_400_000;
const MAX_TASKS = 30;
const MAX_LEFTOVERS = 30;
const ORDER: Record<AgendaTask['reason'], number> = { overdue: 0, blocked: 1, due: 2 };

/**
 * What Draft agenda draws on besides what was typed: the project's open tasks (overdue, blocked, or
 * due up to 7 days after the meeting) and the leftovers of the previous meeting in the series, else
 * of the project's last meeting before this one. Nothing from a project the person can't use or a
 * meeting they can't see.
 */
export async function gatherAgendaSources(
  deps: AgendaSourceDeps,
  input: { requester: { userId: string; roles: string[] }; projectId: string | null; startAt: Date; meetingId?: string },
): Promise<{ tasks: AgendaTask[]; leftovers: AgendaLeftover[] }> {
  const { store } = deps;
  const { userId, roles } = input.requester;
  const now = deps.now?.() ?? new Date();
  const project = input.projectId && (await deps.canUseProject({ id: userId, roles }, input.projectId)) ? input.projectId : null;

  const tasks = project
    ? (await store.openTasks(project, new Date(input.startAt.getTime() + WEEK_MS)))
        .map((t): AgendaTask => ({ key: t.key, title: t.title, reason: t.dueDate && isOverdue(t.dueDate, deps.timeZone, now) ? 'overdue' : t.blocked ? 'blocked' : 'due' }))
        .sort((a, b) => ORDER[a.reason] - ORDER[b.reason])
        .slice(0, MAX_TASKS)
    : [];

  let source = input.meetingId ? await store.previousInSeries(input.meetingId) : null;
  if (!source && project) source = await store.lastProjectMeetingBefore(project, input.startAt, input.meetingId);
  const leftovers = source && (await deps.canViewMeeting(userId, roles, source)) ? (await store.leftovers(source)).slice(0, MAX_LEFTOVERS) : [];
  return { tasks, leftovers };
}
