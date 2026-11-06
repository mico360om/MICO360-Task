/**
 * 1.23.5 Project overview & health — automatic risks (owner answer 2): spotted from the project's data,
 * each with a short explanation and who is accountable. Pure. The hand-kept risk register (1.25.0) will
 * show beside these.
 *
 *   MILESTONE_LATE     a milestone past its day, not finished           its assignees, else the project manager
 *   MILESTONE_AT_RISK  due within 7 days, half its linked work open     its assignees, else the project manager
 *   WORKLOAD           one person holds 40%+ of the open work           the project manager
 *   BLOCKED            tasks blocked for over 7 days                    their assignees, else the project manager
 *   OVERDUE            3+ tasks overdue by 7 days or more               their assignees, and the manager
 *   UNASSIGNED         tasks due within 7 days with no one assigned     the project manager
 *   NO_ACTIVITY        nothing changed for 10+ days                     the project owner
 *
 * Worst first: red (a late milestone, 5+ blocked, the overdue cluster), then amber, each in that order.
 */
import { formatDay } from '../../lib/export-format';
import { BLOCKED_RED } from './health-facts';
import type { ProjectStatus } from '../management/management-rules';

/** No activity for this many days is a risk (the health rule's amber mark waits 14 days, ACTIVE projects only). */
export const RISK_IDLE_DAYS = 10;
/** The overdue cluster: at least this many tasks… */
export const OVERDUE_CLUSTER_MIN = 3;
/** …each at least this many days late. */
export const OVERDUE_CLUSTER_DAYS = 7;
/** Unassigned tasks due within this many days (late ones too). */
export const UNASSIGNED_SOON_DAYS = 7;
/** The Overview tab shows this many, then "Show all". */
export const RISKS_SHOWN = 5;

export type RiskCode = 'MILESTONE_LATE' | 'MILESTONE_AT_RISK' | 'WORKLOAD' | 'BLOCKED' | 'OVERDUE' | 'UNASSIGNED' | 'NO_ACTIVITY';

export interface RiskTask {
  id: string;
  key: string;
  title: string;
  assigneeIds: string[];
}

export interface RiskFacts {
  /** Its status (archived when it or all its companies are): only an ACTIVE project is expected to move. */
  status: ProjectStatus;
  ownerId: string | null;
  /** The named manager. */
  managerId: string | null;
  /** MANAGER members of its team, the earliest to join first. */
  managerMemberIds: string[];
  lateMilestones: (RiskTask & { daysLate: number; due: string })[];
  milestonesAtRisk: (RiskTask & { daysLeft: number; open: number; total: number })[];
  workload: { userId: string; count: number; openTotal: number; pct: number } | null;
  /** Tasks held up over 7 days. */
  blockedLong: (RiskTask & { days: number })[];
  /** Open tasks (not waiting for approval) past their due day. */
  overdue: (RiskTask & { daysLate: number })[];
  /** Open tasks with no one assigned, due within 7 days (late ones too). */
  unassignedSoon: (RiskTask & { daysLeft: number })[];
  /** Company days since the project's last change (its own, or a task's), and that day. */
  idleDays: number;
  lastActivityDay: string;
}

export interface Risk {
  code: RiskCode;
  level: 'RED' | 'AMBER';
  title: string;
  detail: string;
  /** Who is accountable: people's ids (the service names them). */
  accountable: string[];
  /** The tasks it is about (most pressing first). */
  taskIds: string[];
}

/** The project manager: the named manager, else the first MANAGER member, else the owner. */
export function accountableManagerId(f: Pick<RiskFacts, 'ownerId' | 'managerId' | 'managerMemberIds'>): string | null {
  return f.managerId ?? f.managerMemberIds[0] ?? f.ownerId ?? null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))];
const dueWords = (daysLeft: number) => (daysLeft < 0 ? `is ${plural(-daysLeft, 'day')} late` : daysLeft === 0 ? 'is due today' : daysLeft === 1 ? 'is due tomorrow' : `is due in ${daysLeft} days`);
const RANK = { RED: 0, AMBER: 1 } as const;

/** Every risk the facts show, worst first. `nameOf` names a person (the workload risk says who). */
export function projectRisks(f: RiskFacts, nameOf: (userId: string) => string = (id) => id): Risk[] {
  const pm = accountableManagerId(f);
  const pmOnly = unique([pm]);
  const assigneesOr = (tasks: RiskTask[]) => {
    const people = unique(tasks.flatMap((t) => t.assigneeIds));
    return people.length ? people : pmOnly;
  };
  const risks: Risk[] = [];

  for (const m of f.lateMilestones) {
    risks.push({
      code: 'MILESTONE_LATE',
      level: 'RED',
      title: `Milestone “${m.title}” is ${plural(m.daysLate, 'day')} late`,
      detail: `It was due ${formatDay(m.due, { year: false })} and isn’t finished.`,
      accountable: assigneesOr([m]),
      taskIds: [m.id],
    });
  }
  for (const m of f.milestonesAtRisk) {
    const when = m.daysLeft <= 0 ? 'Due today' : m.daysLeft === 1 ? 'Due tomorrow' : `Due in ${m.daysLeft} days`;
    risks.push({
      code: 'MILESTONE_AT_RISK',
      level: 'AMBER',
      title: `Milestone “${m.title}” is at risk`,
      detail: `${when} with ${m.open} of ${plural(m.total, 'linked task')} still open.`,
      accountable: assigneesOr([m]),
      taskIds: [m.id],
    });
  }
  if (f.workload) {
    const w = f.workload;
    risks.push({
      code: 'WORKLOAD',
      level: 'AMBER',
      title: `${nameOf(w.userId)} holds ${w.pct}% of the open work`,
      detail: `${w.count} of ${w.openTotal} open tasks are assigned to them.`,
      accountable: pmOnly,
      taskIds: [],
    });
  }
  if (f.blockedLong.length) {
    const tasks = [...f.blockedLong].sort((a, b) => b.days - a.days || a.key.localeCompare(b.key, 'en', { numeric: true }));
    const first = tasks[0]!;
    risks.push({
      code: 'BLOCKED',
      level: tasks.length >= BLOCKED_RED ? 'RED' : 'AMBER',
      title: `${plural(tasks.length, 'task')} blocked for over 7 days`,
      detail: tasks.length === 1 ? `${first.key} has been held up ${plural(first.days, 'day')}.` : `The longest, ${first.key}, has been held up ${plural(first.days, 'day')}.`,
      accountable: assigneesOr(tasks),
      taskIds: tasks.map((t) => t.id),
    });
  }
  const longLate = f.overdue.filter((t) => t.daysLate >= OVERDUE_CLUSTER_DAYS).sort((a, b) => b.daysLate - a.daysLate || a.key.localeCompare(b.key, 'en', { numeric: true }));
  if (longLate.length >= OVERDUE_CLUSTER_MIN) {
    const first = longLate[0]!;
    risks.push({
      code: 'OVERDUE',
      level: 'RED',
      title: `${longLate.length} tasks overdue by ${OVERDUE_CLUSTER_DAYS} days or more`,
      detail: `The oldest, ${first.key}, is ${plural(first.daysLate, 'day')} late.`,
      accountable: unique([...longLate.flatMap((t) => t.assigneeIds), pm]),
      taskIds: longLate.map((t) => t.id),
    });
  }
  if (f.unassignedSoon.length) {
    const tasks = [...f.unassignedSoon].sort((a, b) => a.daysLeft - b.daysLeft || a.key.localeCompare(b.key, 'en', { numeric: true }));
    const named = tasks.slice(0, 2).map((t) => `${t.key} ${dueWords(t.daysLeft)}`);
    const more = tasks.length > 2 ? `; and ${tasks.length - 2} more` : '';
    risks.push({
      code: 'UNASSIGNED',
      level: 'AMBER',
      title: `${plural(tasks.length, 'task')} due within ${UNASSIGNED_SOON_DAYS} days ${tasks.length === 1 ? 'has' : 'have'} no one assigned`,
      detail: `${named.join('; ')}${more}.`,
      accountable: pmOnly,
      taskIds: tasks.map((t) => t.id),
    });
  }
  // Review I2: as the health rule's own "No activity", for ACTIVE projects only (a finished one is quiet by design).
  if (f.status === 'ACTIVE' && f.idleDays >= RISK_IDLE_DAYS) {
    risks.push({
      code: 'NO_ACTIVITY',
      level: 'AMBER',
      title: `No activity for ${f.idleDays} days`,
      detail: `Nothing in the project has changed since ${formatDay(f.lastActivityDay, { year: false })}.`,
      accountable: f.ownerId ? [f.ownerId] : pmOnly,
      taskIds: [],
    });
  }
  return risks.map((r, i) => ({ r, i })).sort((a, b) => RANK[a.r.level] - RANK[b.r.level] || a.i - b.i).map((x) => x.r);
}
