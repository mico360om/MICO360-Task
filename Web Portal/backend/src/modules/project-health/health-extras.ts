/**
 * 1.23.5 Project overview & health — one project's health extras from its rows (pure): weighted
 * completion and the time used, its hold-ups, milestones late or at risk (with their linked work), one
 * person holding too much, overdue and unassigned work, the automatic risks with who is accountable, the
 * open milestones' owners, and the candidates for its Next actions. The one health rule (projectRag) takes
 * `ragFacts`; the Projects page cards, the project page and the Management page all read these.
 */
import { dueDayKey, shiftDayKey, zonedDayKey } from '../../lib/due-date';
import { workingDaysLate, type WorkCalendar } from '../../lib/working-days';
import { daysBetween } from '../planning/timeline';
import type { HealthFacts } from '../management/management-rules';
import { completionOf, type Completion, type CompletionFigures } from './completion';
import { holdUpOf, isLongHoldUp, milestoneRisk, timeUsedPct, workloadOf, type HoldUp } from './health-facts';
import type { TaskActionCandidate } from './next-actions';
import { accountableManagerId, projectRisks, UNASSIGNED_SOON_DAYS, type Risk, type RiskFacts } from './risks';
import type { AttentionTask, DueGroupRow, HealthProjectRow, LinkRow, OpenLoadRow, ProjectFiguresRow } from './health-source';

export interface ExtrasInput {
  project: HealthProjectRow;
  figures?: ProjectFiguresRow;
  load?: OpenLoadRow;
  /** This project's attention tasks. */
  tasks: AttentionTask[];
  /** Links touching these tasks (either way). */
  links: LinkRow[];
  /** The latest column change of a task. */
  moves: ReadonlyMap<string, Date>;
  /** This project's tasks by due date (a milestone's linked work when it waits on nothing). */
  dueGroups: DueGroupRow[];
  /** People's names. */
  names: ReadonlyMap<string, string>;
}

/** A next action's candidate, with the task it came from. */
export type ActionTask = TaskActionCandidate & { task: AttentionTask };

export interface HealthExtras {
  projectId: string;
  project: HealthProjectRow;
  completion: Completion & CompletionFigures;
  timeUsedPct: number | null;
  lastActivityAt: Date;
  /** What the one rule (projectRag) adds from these. */
  ragFacts: Pick<HealthFacts, 'progress' | 'blockedLong' | 'milestonesAtRisk' | 'workload'>;
  risks: Risk[];
  /** The project manager (accountable for most risks). */
  managerId: string | null;
  /** Its open milestones (by date, undated last), each with its owners (its assignees). */
  milestones: { id: string; key: string; title: string; due: string | null; ownerIds: string[] }[];
  /** Next actions' candidates (open tasks not waiting for approval). */
  actions: ActionTask[];
  /** Hold-ups by task (any length). */
  holdUps: ReadonlyMap<string, HoldUp>;
}

const EMPTY: CompletionFigures = { total: 0, done: 0, weightTotal: 0, weightDone: 0 };

export function buildHealthExtras(input: ExtrasInput, ctx: { today: string; timeZone: string; calendar?: WorkCalendar }): HealthExtras {
  const { project: p, tasks } = input;
  const { today, timeZone } = ctx;
  /** Notification & Scheduling: days late in the project's company's working days (calendar days without it). */
  const lateBy = (dueKey: string, days: number) => (ctx.calendar ? workingDaysLate(dueKey, today, ctx.calendar) : -days);
  const figures = input.figures ?? { ...EMPTY, projectId: p.id, lastTaskUpdate: null };
  const completion = { ...completionOf(figures, p.completionMode), total: figures.total, done: figures.done, weightTotal: figures.weightTotal, weightDone: figures.weightDone };
  const lastActivityAt = figures.lastTaskUpdate && figures.lastTaskUpdate > p.updatedAt ? figures.lastTaskUpdate : p.updatedAt;
  const lastActivityDay = zonedDayKey(lastActivityAt, timeZone);
  const used = timeUsedPct(p.startDate, p.targetDate, today, timeZone);

  // Links inside the project only (ruling 4): a blocker elsewhere neither holds a task up nor is named.
  const blockersOf = new Map<string, LinkRow['blocker'][]>();
  const dependents = new Map<string, number>();
  for (const l of input.links) {
    if (l.blocker.projectId === p.id && l.waiting.projectId === p.id) {
      blockersOf.set(l.taskId, [...(blockersOf.get(l.taskId) ?? []), l.blocker]);
      if (l.waiting.open) dependents.set(l.dependsOnTaskId, (dependents.get(l.dependsOnTaskId) ?? 0) + 1);
    }
  }
  const openBlockers = (id: string) => (blockersOf.get(id) ?? []).filter((b) => b.open).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  const daysTo = (d: Date | null) => {
    const key = dueDayKey(d, timeZone);
    return key ? daysBetween(today, key) : null;
  };
  const ref = (t: AttentionTask) => ({ id: t.id, key: t.key, title: t.title, assigneeIds: t.assignees.map((a) => a.id) });

  const holdUps = new Map<string, HoldUp>();
  const actions: ActionTask[] = [];
  const blockedLong: RiskFacts['blockedLong'] = [];
  const overdue: RiskFacts['overdue'] = [];
  const unassignedSoon: RiskFacts['unassignedSoon'] = [];
  const lateMilestones: RiskFacts['lateMilestones'] = [];
  const atRisk: RiskFacts['milestonesAtRisk'] = [];
  const milestones: HealthExtras['milestones'] = [];

  for (const t of tasks) {
    if (t.isMilestone) milestones.push({ id: t.id, key: t.key, title: t.title, due: dueDayKey(t.dueDate, timeZone), ownerIds: t.assignees.map((a) => a.id) });
    // A task waiting for approval is handed in: no hold-up, no late work, no next action (owner, 30 Oct).
    if (t.waiting) continue;
    const open = openBlockers(t.id);
    const base = { movedAt: input.moves.get(t.id) ?? null, updatedAt: t.updatedAt, startDate: t.startDate, dueDate: t.dueDate, openBlockerDues: open.map((b) => b.dueDate) };
    const held = holdUpOf({ ...base, columnCategory: t.columnCategory }, ctx);
    if (held) holdUps.set(t.id, held);
    if (isLongHoldUp(held)) blockedLong.push({ ...ref(t), days: held!.days });
    const days = daysTo(t.dueDate);
    if (days !== null && days < 0) overdue.push({ ...ref(t), daysLate: lateBy(dueDayKey(t.dueDate, timeZone)!, days) });
    if (days !== null && days <= UNASSIGNED_SOON_DAYS && t.assignees.length === 0) unassignedSoon.push({ ...ref(t), daysLeft: days });
    if (t.isMilestone && days !== null) {
      const due = dueDayKey(t.dueDate, timeZone)!;
      if (days < 0) lateMilestones.push({ ...ref(t), daysLate: lateBy(due, days), due });
      else {
        const risk = milestoneRisk({ dueDate: t.dueDate, waiting: false, linked: linkedWork(t, due) }, ctx);
        if (risk) atRisk.push({ ...ref(t), ...risk });
      }
    }
    actions.push({
      kind: 'task',
      id: t.id,
      key: t.key,
      priority: t.priority,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      columnCategory: t.columnCategory,
      assigneeIds: t.assignees.map((a) => a.id),
      heldByBlockers: open.length > 0 && holdUpOf({ ...base, columnCategory: null }, ctx) !== null,
      blockers: open.map((b) => ({ id: b.id, key: b.key })),
      dependents: dependents.get(t.id) ?? 0,
      task: t,
    });
  }

  /** Call 1: the tasks it waits on when it has any; else the project's other tasks due on or before its day. */
  function linkedWork(m: AttentionTask, due: string): { total: number; open: number } {
    const blockers = blockersOf.get(m.id) ?? [];
    if (blockers.length) return { total: blockers.length, open: blockers.filter((b) => b.open).length };
    let total = 0;
    let open = 0;
    for (const g of input.dueGroups) {
      const day = dueDayKey(g.dueDate, timeZone);
      if (day === null || day > due) continue;
      total += g.total;
      open += g.open;
    }
    // Not the milestone itself (it is open, due on its own day).
    return { total: Math.max(0, total - 1), open: Math.max(0, open - 1) };
  }

  const load = input.load ?? { projectId: p.id, open: 0, people: [] };
  const busy = workloadOf(load.open, load.people);
  const nameOf = (id: string) => input.names.get(id) ?? 'Someone';
  const riskFacts: RiskFacts = {
    status: p.archived ? 'ARCHIVED' : p.status,
    ownerId: p.ownerId,
    managerId: p.managerId,
    managerMemberIds: p.managerMemberIds,
    lateMilestones,
    milestonesAtRisk: atRisk,
    workload: busy,
    blockedLong,
    overdue,
    unassignedSoon,
    idleDays: Math.max(0, daysBetween(lastActivityDay, today)),
    lastActivityDay,
    ...(ctx.calendar ? { workingDays: true } : {}),
  };
  milestones.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'en'));
  return {
    projectId: p.id,
    project: p,
    completion,
    timeUsedPct: used,
    lastActivityAt,
    ragFacts: {
      progress: used !== null && figures.total > 0 ? { donePct: completion.pct, timeUsedPct: used } : null,
      blockedLong: blockedLong.length,
      milestonesAtRisk: atRisk.map((m) => ({ title: m.title, daysLeft: m.daysLeft, open: m.open, total: m.total })),
      workload: busy ? { name: nameOf(busy.userId), count: busy.count, openTotal: busy.openTotal, pct: busy.pct } : null,
    },
    risks: projectRisks(riskFacts, nameOf),
    managerId: accountableManagerId(riskFacts),
    milestones,
    actions,
    holdUps,
  };
}

/** The loose "due soon" edge the attention read uses (a stored moment may sit a day either side of its company day). */
export const attentionEdge = (today: string): Date => new Date(`${shiftDayKey(today, UNASSIGNED_SOON_DAYS + 2)}T00:00:00.000Z`);
