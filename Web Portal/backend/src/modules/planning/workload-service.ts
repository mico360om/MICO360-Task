import { dueDayKey, shiftDayKey, zonedStartOfDay } from '../../lib/due-date';
import { workloadWindows, type WorkloadPerson, type WorkloadProject, type WorkloadRows, type WorkloadScope, type WorkloadTaskRow } from './workload';

/**
 * Plain reads for the Workload page, each one grouped query. Who may see what is decided by
 * loadWorkload, never here. "Open" is the shared rule (not in a Done column, no completion time);
 * "live" projects are neither deleted, completed nor archived.
 */
export interface WorkloadStore {
  /** Live projects the person manages: they are its manager or owner, or a MANAGER member. */
  managedProjectIds(userId: string): Promise<string[]>;
  /** Live projects: all of them (null), or these. */
  liveProjects(ids: string[] | null): Promise<(WorkloadProject & { ownerId: string | null; managerId: string | null })[]>;
  /** The active members of these projects. */
  members(projectIds: string[]): Promise<{ projectId: string; userId: string }[]>;
  /** Active people: everyone (null), or these. */
  activeUsers(ids: string[] | null): Promise<WorkloadPerson[]>;
  /** Open tasks of these projects due in [from, to) that any of these people are on. */
  openTasks(q: { projectIds: string[]; assigneeIds: string[]; from: Date; to: Date }): Promise<WorkloadTaskRow[]>;
  /** Per person, their open tasks of these projects due before `before`, counted. */
  overdueCounts(q: { projectIds: string[]; userIds: string[]; before: Date }): Promise<{ userId: string; count: number }[]>;
  /** One row per active person and open task due in any window, in these projects (null: every live project). */
  openDue(q: { projectIds: string[] | null; userIds: string[]; windows: { from: Date; to: Date }[] }): Promise<{ userId: string; dueDate: Date | null }[]>;
}

const utcDay = (key: string) => new Date(`${key}T00:00:00.000Z`);
/** A due date is a day (UTC midnight) or a moment read in company time: a day either side covers both. */
const around = (w: { from: string; to: string }) => ({ from: utcDay(shiftDayKey(w.from, -1)), to: utcDay(shiftDayKey(w.to, 2)) });
const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];

/**
 * The Workload page's rows for one asker, in a fixed number of store reads:
 * - an administrator: every active person, the tasks of every live project;
 * - a project manager: the teams of the projects they manage, only those projects' tasks — plus
 *   their own tasks in every other live project they can see, on their own row only;
 * - anyone else: themselves, in the live projects they can see.
 * Everyone's whole load (every live project) is read too, for suggestions to weigh — also people
 * the asker can't see (the others on a task), whose numbers never leave the server.
 */
export async function loadWorkload(
  store: WorkloadStore,
  q: { scope: WorkloadScope; viewerId: string; projectId: string | null; week: string; today: string; timeZone: string },
): Promise<{ rows: WorkloadRows; projectId: string | null }> {
  const { scope, viewerId, week, today, timeZone } = q;
  const windows = workloadWindows(week, today);
  const projects = await store.liveProjects(scope.projectIds);
  const projectIds = projects.map((p) => p.id);
  const projectId = q.projectId && projectIds.includes(q.projectId) ? q.projectId : null;
  const mainProjects = projectId ? [projectId] : projectIds;
  // A manager's own tasks in the other projects they can see (not when the page is narrowed to one project).
  const ownExtra =
    scope.kind === 'teams' && !projectId ? (await store.liveProjects(scope.ownProjectIds)).map((p) => p.id).filter((id) => !projectIds.includes(id)) : [];

  const members = projectIds.length ? await store.members(projectIds) : [];
  const leads = projects.flatMap((p) => unique([p.ownerId, p.managerId]).map((userId) => ({ projectId: p.id, userId })));
  const people =
    scope.kind === 'everyone'
      ? await store.activeUsers(null)
      : await store.activeUsers(scope.kind === 'teams' ? unique([viewerId, ...members.map((m) => m.userId), ...leads.map((l) => l.userId)]) : [viewerId]);
  const peopleIds = people.map((p) => p.id);
  const shown = new Set(peopleIds);
  const teams = [...members, ...leads].filter((m) => shown.has(m.userId));
  const assignees = scope.kind === 'self' ? peopleIds.filter((id) => id === viewerId) : peopleIds;
  const ownRow = shown.has(viewerId) ? [viewerId] : [];

  const show = around(windows.show);
  const [main, own] = await Promise.all([
    mainProjects.length && assignees.length ? store.openTasks({ projectIds: mainProjects, assigneeIds: assignees, ...show }) : Promise.resolve([]),
    ownExtra.length && ownRow.length ? store.openTasks({ projectIds: ownExtra, assigneeIds: ownRow, ...show }) : Promise.resolve([]),
  ]);
  const tasks: WorkloadTaskRow[] = [...main, ...own.map((t) => ({ ...t, rowsFor: ownRow }))];

  // Overdue: due before today's company day. Counted in the database up to the earlier of today's
  // UTC and company-time midnight; the few due in between are read and judged one by one.
  const [a, b] = [utcDay(today), zonedStartOfDay(today, timeZone)];
  const [before, bandTo] = a < b ? [a, b] : [b, a];
  const overdueOf = async (ids: string[], userIds: string[]) => {
    if (!ids.length || !userIds.length) return [];
    const [counts, band] = await Promise.all([
      store.overdueCounts({ projectIds: ids, userIds, before }),
      bandTo > before ? store.openDue({ projectIds: ids, userIds, windows: [{ from: before, to: bandTo }] }) : Promise.resolve([]),
    ]);
    return [...counts, ...band.filter((r) => (dueDayKey(r.dueDate, timeZone) ?? today) < today).map((r) => ({ userId: r.userId, count: 1 }))];
  };
  const overdue = new Map<string, number>();
  for (const r of [...(await overdueOf(mainProjects, assignees)), ...(await overdueOf(ownExtra, ownRow))]) overdue.set(r.userId, (overdue.get(r.userId) ?? 0) + r.count);

  const weighed = unique([...peopleIds, ...tasks.flatMap((t) => t.assigneeIds)]);
  const loads = weighed.length ? await store.openDue({ projectIds: null, userIds: weighed, windows: windows.load.map(around) }) : [];

  return {
    rows: {
      people,
      projects: projects.map(({ ownerId: _o, managerId: _m, ...p }) => p),
      tasks,
      overdue: [...overdue].map(([userId, count]) => ({ userId, count })),
      teams,
      loads,
    },
    projectId,
  };
}
