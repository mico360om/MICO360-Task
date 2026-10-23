import { dueDayKey, shiftDayKey, todayKey } from '../../lib/due-date';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** A person on the Workload page: a face and a name. */
export interface WorkloadPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** A project the page may be narrowed to. */
export interface WorkloadProject {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

/** An open task the table shows, with a due date in the shown week. */
export interface WorkloadTaskRow {
  id: string;
  key: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
  priority: Priority;
  isMilestone: boolean;
  version: number;
  /** Everyone it is assigned to (also people not shown). */
  assigneeIds: string[];
  /** The rows it shows on, when not every shown assignee's (a manager's own task in a project they don't manage). */
  rowsFor?: string[];
}

/** What the service hands the builder for one week — read in a fixed number of queries, never one per person. */
export interface WorkloadRows {
  /** The people the asker may see. */
  people: WorkloadPerson[];
  /** The projects the page may be narrowed to. */
  projects: WorkloadProject[];
  /** The tasks the table shows (already narrowed to a project when the page is). */
  tasks: WorkloadTaskRow[];
  /** Each person's overdue tasks (already narrowed to a project when the page is). */
  overdue: { userId: string; count: number }[];
  /** Who is on each project's team (active members, its owner and its manager). */
  teams: { projectId: string; userId: string }[];
  /**
   * Everyone's whole load: one row per person and open task due in the weighed days, in every
   * project — what suggestions weigh. Never sent to the page.
   */
  loads: { userId: string; dueDate: Date | null }[];
}

/**
 * Who the asker may see: an administrator everyone (all projects); a project manager the people on
 * the projects they manage (only those projects' tasks) and their own tasks in every project they
 * can see; anyone else only themselves (in the projects they can see).
 */
export type WorkloadScope =
  | { kind: 'everyone'; projectIds: null }
  | { kind: 'teams'; projectIds: string[]; ownProjectIds: string[] }
  | { kind: 'self'; projectIds: string[] };

/**
 * One way to lighten a day: give the task to a teammate with room (their number that day only for
 * an administrator, who sees all their tasks), or move it to a working day with room for everyone on it.
 */
export type WorkloadSuggestion =
  | { kind: 'reassign'; to: { id: string; name: string }; count: number | null }
  | { kind: 'move'; date: string };

export interface WorkloadCellTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  priority: Priority;
  version: number;
  suggestion: WorkloadSuggestion | null;
}

export interface WorkloadCell {
  date: string;
  count: number;
  /** The limit on this day: the daily limit on a working day, 0 on a day off. */
  limit: number;
  over: number;
  /** Suggested ones first, in the order of the plan; then the rest, most urgent first. */
  tasks: WorkloadCellTask[];
}

export interface WorkloadRow extends WorkloadPerson {
  me: boolean;
  overdue: number;
  /** Open tasks due in the week. */
  total: number;
  /** The daily limit times the week's working days. */
  weekLimit: number;
  days: WorkloadCell[];
}

export interface WorkloadData {
  week: string;
  today: string;
  days: { date: string; working: boolean }[];
  limit: number;
  canChangeLimit: boolean;
  scope: WorkloadScope['kind'];
  projectId: string | null;
  projects: WorkloadProject[];
  people: WorkloadRow[];
}

/** How far after the week (or today) a lighter day is looked for. */
export const MOVE_LOOKAHEAD_DAYS = 21;

const weekdayOf = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();
const later = (a: string, b: string) => (a > b ? a : b);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const RANK: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };
/** The easiest to hand on first: lowest priority, milestones last. */
const movableFirst = (a: WorkloadTaskRow, b: WorkloadTaskRow) =>
  RANK[a.priority] - RANK[b.priority] || Number(a.isMilestone) - Number(b.isMilestone) || collator.compare(a.key, b.key);
/** The ones left: most urgent first. */
const urgentFirst = (a: WorkloadTaskRow, b: WorkloadTaskRow) => RANK[b.priority] - RANK[a.priority] || collator.compare(a.key, b.key);

export function resolveWorkloadScope(
  viewer: { id: string; roles: string[] },
  facts: { managedProjectIds: string[]; visibleProjectIds: string[] | null },
): WorkloadScope {
  if (viewer.roles.includes('ADMIN')) return { kind: 'everyone', projectIds: null };
  if (facts.managedProjectIds.length > 0) return { kind: 'teams', projectIds: [...facts.managedProjectIds], ownProjectIds: facts.visibleProjectIds ?? [] };
  return { kind: 'self', projectIds: facts.visibleProjectIds ?? [] };
}

/**
 * The days the page reads: the week it shows, and the days it weighs — the week and up to three
 * weeks on, where "Move to" looks (from today for a past week, never everything in between).
 */
export function workloadWindows(week: string, today: string): { show: { from: string; to: string }; load: { from: string; to: string }[]; searchUntil: string } {
  const weekEnd = shiftDayKey(week, 6);
  const searchUntil = shiftDayKey(later(weekEnd, today), MOVE_LOOKAHEAD_DAYS);
  const load = today > weekEnd ? [{ from: week, to: weekEnd }, { from: today, to: searchUntil }] : [{ from: week, to: searchUntil }];
  return { show: { from: week, to: weekEnd }, load, searchUntil };
}

/**
 * The Workload table: each person's open tasks due each day of the week against the daily limit (0
 * on a day off), their overdue tasks, and for every day over the limit a plan to bring it down —
 * as many tasks as it is over, each given to the least-busy teammate on its project who has room
 * that day, or moved to the next working day with room for everyone on the task. Days and teammates
 * are weighed by everyone's whole load (every project, also people and projects the asker can't
 * see), each suggestion counts towards the next, and only an administrator is told numbers.
 */
export function buildWorkload(
  rows: WorkloadRows,
  opts: {
    week: string;
    timeZone: string;
    now?: Date;
    limit: number;
    workingDays: number[];
    viewerId: string;
    scope: WorkloadScope;
    projectId?: string | null;
    canChangeLimit: boolean;
  },
): WorkloadData {
  const { week, timeZone, limit, viewerId, scope } = opts;
  const today = todayKey(timeZone, opts.now ?? new Date());
  const days = Array.from({ length: 7 }, (_, i) => shiftDayKey(week, i));
  const weekEnd = days[6]!;
  const working = new Set(opts.workingDays);
  const isWorking = (day: string) => working.has(weekdayOf(day));
  const { searchUntil } = workloadWindows(week, today);
  const projectId = opts.projectId && rows.projects.some((p) => p.id === opts.projectId) ? opts.projectId : null;
  const shown = new Set(rows.people.map((p) => p.id));
  const nameOf = new Map(rows.people.map((p) => [p.id, p.name]));
  const team = new Map<string, Set<string>>();
  for (const m of rows.teams) team.set(m.projectId, (team.get(m.projectId) ?? new Set<string>()).add(m.userId));

  // Everyone's whole load per day: what suggestions weigh.
  const load = new Map<string, number>();
  const at = (userId: string, day: string) => `${userId} ${day}`;
  const loadOf = (userId: string, day: string) => load.get(at(userId, day)) ?? 0;
  const bump = (userId: string, day: string, by: number) => load.set(at(userId, day), loadOf(userId, day) + by);
  for (const l of rows.loads) {
    const day = dueDayKey(l.dueDate, timeZone);
    if (day) bump(l.userId, day, 1);
  }

  // The week's cells: what the table shows.
  const cells = new Map<string, WorkloadTaskRow[]>();
  const withWork = new Set<string>();
  for (const t of rows.tasks) {
    const day = dueDayKey(t.dueDate, timeZone);
    if (!day || day < week || day > weekEnd) continue;
    for (const userId of t.rowsFor ?? t.assigneeIds) {
      if (!shown.has(userId)) continue;
      cells.set(at(userId, day), [...(cells.get(at(userId, day)) ?? []), t]);
      withWork.add(userId);
    }
  }
  const overdue = new Map(rows.overdue.map((o) => [o.userId, o.count]));
  for (const o of rows.overdue) if (o.count > 0) withWork.add(o.userId);

  // Narrowed to a project: its team, and whoever has its tasks.
  const keep = projectId ? new Set([...(team.get(projectId) ?? []), ...withWork]) : null;
  const people = rows.people.filter((p) => !keep || keep.has(p.id)).sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  const canReassign = scope.kind !== 'self';
  // Only an administrator sees all of a teammate's tasks, so only they are told the teammate's number.
  const tellCounts = scope.kind === 'everyone';
  const dayLimit = (day: string) => (isWorking(day) ? limit : 0);

  function suggest(t: WorkloadTaskRow, userId: string, day: string): WorkloadSuggestion | null {
    if (canReassign && isWorking(day) && day >= today) {
      const best = [...(team.get(t.projectId) ?? [])]
        .filter((id) => id !== userId && shown.has(id) && !t.assigneeIds.includes(id))
        .map((id) => ({ id, count: loadOf(id, day) }))
        .filter((m) => m.count < limit)
        .sort((a, b) => a.count - b.count || collator.compare(nameOf.get(a.id) ?? '', nameOf.get(b.id) ?? ''))[0];
      if (best) {
        bump(best.id, day, 1);
        bump(userId, day, -1);
        return { kind: 'reassign', to: { id: best.id, name: nameOf.get(best.id) ?? '' }, count: tellCounts ? best.count : null };
      }
    }
    // Moving the due date moves it for everyone on the task: the day must have room for them all.
    const everyone = [...new Set([userId, ...t.assigneeIds])];
    for (let next = later(shiftDayKey(day, 1), today); next <= searchUntil; next = shiftDayKey(next, 1)) {
      if (!isWorking(next) || everyone.some((id) => loadOf(id, next) >= limit)) continue;
      for (const id of everyone) {
        bump(id, next, 1);
        bump(id, day, -1);
      }
      return { kind: 'move', date: next };
    }
    return null;
  }

  const toTask = (t: WorkloadTaskRow, suggestion: WorkloadSuggestion | null): WorkloadCellTask => ({
    id: t.id,
    key: t.key,
    title: t.title,
    projectId: t.projectId,
    priority: t.priority,
    version: t.version,
    suggestion,
  });

  return {
    week,
    today,
    days: days.map((date) => ({ date, working: isWorking(date) })),
    limit,
    canChangeLimit: opts.canChangeLimit,
    scope: scope.kind,
    projectId,
    projects: rows.projects,
    people: people.map((p): WorkloadRow => {
      const row = days.map((date): WorkloadCell => {
        const list = cells.get(at(p.id, date)) ?? [];
        const max = dayLimit(date);
        const over = Math.max(0, list.length - max);
        const plan: WorkloadCellTask[] = [];
        if (over > 0) {
          for (const t of [...list].sort(movableFirst)) {
            if (plan.length >= over) break;
            const s = suggest(t, p.id, date);
            if (s) plan.push(toTask(t, s));
          }
        }
        const planned = new Set(plan.map((x) => x.id));
        const rest = list.filter((t) => !planned.has(t.id)).sort(urgentFirst).map((t) => toTask(t, null));
        return { date, count: list.length, limit: max, over, tasks: [...plan, ...rest] };
      });
      return {
        ...p,
        me: p.id === viewerId,
        overdue: overdue.get(p.id) ?? 0,
        total: row.reduce((n, c) => n + c.count, 0),
        weekLimit: limit * days.filter(isWorking).length,
        days: row,
      };
    }),
  };
}
