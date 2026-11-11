import { shiftDayKey } from '../../lib/due-date';
import type { CalendarStore } from './calendar-store';
import { blockShown } from './work-blocks';
import { reminderState, type ReminderAnchor, type ReminderClock } from './task-reminders';

/**
 * What GET /calendar adds for calendar scheduling: the person's work blocks (and, with the Team view, the
 * blocks of people on projects they run), their own reminders at their times, and whether they have the
 * Team view at all. Instants are sent with a day's margin either side of the range (the page places them
 * in the person's own time zone).
 */

export interface CalendarExtrasDeps {
  store: CalendarStore;
  names(userIds: string[]): Promise<Map<string, string>>;
  clock(): Promise<ReminderClock>;
  /**
   * The projects whose people's blocks the Team view shows: those this person runs, inside `list` (an
   * administrator: `list` itself, null = every project). Empty: no Team view.
   */
  teamProjects(viewer: { id: string; roles: string[] }, list: string[] | null): Promise<string[] | null>;
  now?: () => Date;
}

export interface CalendarBlockView {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
  userId: string;
  userName: string;
  plannedById: string;
  plannedByName: string;
  startAt: string;
  endAt: string;
  /** The person's own time. */
  mine: boolean;
  /** May the person move, resize or remove it. */
  canChange: boolean;
  /** Its task is done (a past block kept as history). */
  done: boolean;
}

export interface CalendarReminderView {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
  fireAt: string;
  at: string | null;
  anchor: ReminderAnchor | null;
  offsetMinutes: number | null;
  setById: string;
  /** Who set it, when someone else did. */
  setByName: string | null;
  state: 'wait' | 'send' | 'sent' | 'missed' | 'muted';
  snoozedUntil: string | null;
}

const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);

export function createCalendarExtras(deps: CalendarExtrasDeps) {
  return async function extras(q: {
    viewer: { id: string; roles: string[] };
    from: string;
    to: string;
    own: string[] | null;
    list: string[] | null;
    team: boolean;
  }): Promise<{ workBlocks: CalendarBlockView[]; reminders: CalendarReminderView[]; team: { available: boolean; on: boolean } }> {
    const now = (deps.now ?? (() => new Date()))();
    const window = { from: dayStart(shiftDayKey(q.from, -1)), to: dayStart(shiftDayKey(q.to, 2)) };
    const me = q.viewer.id;
    const ownScope = (projectId: string) => !q.own || q.own.includes(projectId);

    const teamIds = await deps.teamProjects(q.viewer, q.list);
    const available = teamIds === null || teamIds.length > 0;
    const runs = (projectId: string) => teamIds === null || teamIds.includes(projectId);
    const mine = (await deps.store.blocksBetween({ ...window, userId: me })).filter((b) => ownScope(b.task.projectId));
    const others =
      q.team && available
        ? (await deps.store.blocksBetween({ ...window, projectIds: teamIds })).filter((b) => b.userId !== me && (!q.list || q.list.includes(b.task.projectId)))
        : [];
    const blocks = [...mine, ...others]
      .filter((b) => !b.task.deletedAt && blockShown(b, b.task, now))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id, 'en'));

    const clock = await deps.clock();
    const reminders = (await deps.store.remindersForCalendar({ userId: me, ...window }))
      // An archived project's reminders are not sent (as the planner's): not shown either.
      .filter((r) => ownScope(r.task.projectId) && !r.task.projectArchived)
      .map((r) => ({ r, s: reminderState(r, r.task, now, clock) }))
      .filter(({ s }) => s.fireAt && s.state !== 'hidden' && s.state !== 'none' && s.fireAt >= window.from && s.fireAt < window.to)
      .sort((a, b) => a.s.fireAt!.getTime() - b.s.fireAt!.getTime() || a.r.id.localeCompare(b.r.id, 'en'));

    const names = await deps.names([...new Set([...blocks.flatMap((b) => [b.userId, b.plannedById]), ...reminders.filter(({ r }) => r.setById !== me).map(({ r }) => r.setById)])]);
    const nameOf = (id: string) => names.get(id) ?? 'Someone';
    return {
      workBlocks: blocks.map((b) => ({
        id: b.id,
        taskId: b.taskId,
        taskKey: b.task.key,
        taskTitle: b.task.title,
        projectId: b.task.projectId,
        userId: b.userId,
        userName: nameOf(b.userId),
        plannedById: b.plannedById,
        plannedByName: nameOf(b.plannedById),
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        mine: b.userId === me,
        // A done task's (past) block is history and an archived project is read-only: neither changes here.
        canChange: !b.task.completedAt && !b.task.projectArchived && (b.userId === me || b.plannedById === me || runs(b.task.projectId)),
        done: !!b.task.completedAt,
      })),
      reminders: reminders.map(({ r, s }) => ({
        id: r.id,
        taskId: r.taskId,
        taskKey: r.task.key,
        taskTitle: r.task.title,
        projectId: r.task.projectId,
        fireAt: s.fireAt!.toISOString(),
        at: r.at?.toISOString() ?? null,
        anchor: r.anchor,
        offsetMinutes: r.offsetMinutes,
        setById: r.setById,
        setByName: r.setById !== me ? nameOf(r.setById) : null,
        state: s.state as CalendarReminderView['state'],
        snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      })),
      team: { available, on: q.team && available },
    };
  };
}
