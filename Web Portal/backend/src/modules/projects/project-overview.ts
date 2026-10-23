import { dueDayKey, todayKey } from '../../lib/due-date';
import type { ProjectRecord } from './project-repository';

/** A person as the projects list shows them: a face and a name. */
export interface OverviewPerson {
  id: string;
  /** Full name, else the username. */
  name: string;
  avatarUrl: string | null;
}

/** Every live task of a project, counted, with the time the latest one changed. */
export interface ProjectTaskTotals {
  projectId: string;
  total: number;
  lastTaskUpdate: Date | null;
}

/** A project's open (not done) tasks that share one due date (null: no due date), counted. */
export interface OpenTasksByDue {
  projectId: string;
  dueDate: Date | null;
  count: number;
}

/** What the database hands back for a whole list of projects — grouped rows, never one query per project. */
export interface ProjectOverviewRows {
  totals: ProjectTaskTotals[];
  openByDue: OpenTasksByDue[];
  members: { projectId: string; person: OverviewPerson }[];
  owners: OverviewPerson[];
}

export interface ProjectOverviewSource {
  /** Figures for these projects in a fixed number of queries, however many projects there are. */
  load(projectIds: string[], ownerIds: string[]): Promise<ProjectOverviewRows>;
}

/** A project's card figures. */
export interface ProjectFigures {
  total: number;
  done: number;
  open: number;
  /** Open tasks whose due day is before today in the company time zone. */
  overdue: number;
  /** The nearest due day ('YYYY-MM-DD') of an open task, today or later; null when there is none. */
  nextDue: string | null;
  /** The later of the project's own last change and its latest task change. */
  lastActivityAt: Date;
}

export type ProjectOverviewItem = ProjectRecord & { stats: ProjectFigures; owner: OverviewPerson | null; team: OverviewPerson[] };

/**
 * The projects list with each project's figures, owner and team. "Done" is the shared rule (a DONE
 * column or a completion time — the source counts the open ones), and overdue / today are decided
 * by the shared due-date rules in the company time zone, exactly as the dashboard and reports do.
 */
export function buildProjectOverview(
  projects: ProjectRecord[],
  rows: ProjectOverviewRows,
  { timeZone, now = new Date() }: { timeZone: string; now?: Date },
): ProjectOverviewItem[] {
  const today = todayKey(timeZone, now);
  const totals = new Map(rows.totals.map((t) => [t.projectId, t]));
  const owners = new Map(rows.owners.map((o) => [o.id, o]));
  const teams = new Map<string, OverviewPerson[]>();
  for (const m of rows.members) teams.set(m.projectId, [...(teams.get(m.projectId) ?? []), m.person]);
  const open = new Map<string, { open: number; overdue: number; nextDue: string | null }>();
  for (const g of rows.openByDue) {
    const s = open.get(g.projectId) ?? { open: 0, overdue: 0, nextDue: null };
    s.open += g.count;
    const day = dueDayKey(g.dueDate, timeZone);
    if (day !== null && day < today) s.overdue += g.count;
    else if (day !== null && (s.nextDue === null || day < s.nextDue)) s.nextDue = day;
    open.set(g.projectId, s);
  }

  return projects.map((p) => {
    const t = totals.get(p.id);
    const o = open.get(p.id) ?? { open: 0, overdue: 0, nextDue: null };
    const total = t?.total ?? 0;
    const lastTask = t?.lastTaskUpdate ?? null;
    return {
      ...p,
      stats: {
        total,
        done: Math.max(0, total - o.open),
        open: o.open,
        overdue: o.overdue,
        nextDue: o.nextDue,
        lastActivityAt: lastTask && lastTask > p.updatedAt ? lastTask : p.updatedAt,
      },
      owner: p.ownerId ? owners.get(p.ownerId) ?? null : null,
      team: teams.get(p.id) ?? [],
    };
  });
}
